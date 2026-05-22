// ============================================================
// verify-official-url: 公式申請の URL 所有確認
// ============================================================
// 申請者が `applicant_url` を本当に所有しているかをサーバ側で検証する。
//
// 検証方式 (順に試行):
//   1. well-known   : GET {origin}/.well-known/geek-verify.txt にトークンが含まれているか
//   2. meta-tag     : GET {applicant_url} の <head> に <meta name="geek-verify" content="<token>">
//
// 防御 (security_critical_fixes 0036 反映):
//   - http(s) のみ許可 + HTTPS 推奨
//   - private/loopback/link-local IP を block (SSRF 対策)
//   - DNS リバインディング対策: 事前に Deno.resolveDns で IP を解決して検証
//   - リダイレクト追跡: redirect: 'manual' で 3xx の Location を再検証 (最大 3 hop)
//   - 5 秒タイムアウト + 500 KB body 上限
//   - CORS allowlist 方式 (`*` 廃止)
//   - エラー詳細は production では返さない
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { buildCorsHeaders, jsonResponse, isProduction } from '../_shared/cors.ts';

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 500 * 1024; // 500 KB
const MAX_REDIRECTS = 3;

// --- SSRF 対策: private IP / loopback / link-local を block ---------
function isBlockedHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === 'localhost') return true;
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('fe80')) return true; // link-local
  const m = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;          // link-local (AWS metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true;          // 192.168/16
    if (a >= 224) return true;                         // multicast / reserved
  }
  return false;
}

function safeParseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    if (isBlockedHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

// --- DNS 解決して全 IP が安全か検証 ---------------------------------
async function resolveHostnameSafe(hostname: string): Promise<boolean> {
  // 既に IP リテラルなら isBlockedHost が処理済み
  const ipv4Lit = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(hostname);
  const ipv6Lit = hostname.includes(':');
  if (ipv4Lit || ipv6Lit) return !isBlockedHost(hostname);

  try {
    // A + AAAA を並列解決し、どれか 1 つでも private/loopback/link-local なら拒否
    const [a, aaaa] = await Promise.allSettled([
      Deno.resolveDns(hostname, 'A'),
      Deno.resolveDns(hostname, 'AAAA'),
    ]);
    const ips: string[] = [];
    if (a.status === 'fulfilled') ips.push(...a.value);
    if (aaaa.status === 'fulfilled') ips.push(...aaaa.value);

    if (ips.length === 0) return false;
    for (const ip of ips) {
      if (isBlockedHost(ip)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// --- 制限付き fetch (manual redirect + 検証 + 500KB 上限) ------------
async function safeFetchText(target: URL): Promise<string | null> {
  let currentUrl: URL = target;
  let redirectCount = 0;

  while (true) {
    // 各 hop ごとに URL 形式と hostname を再検証
    const safe = safeParseUrl(currentUrl.toString());
    if (!safe) return null;

    const dnsSafe = await resolveHostnameSafe(safe.hostname);
    if (!dnsSafe) return null;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(safe.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'user-agent': 'GeekVerifier/1.0 (+https://geek.app)',
          accept: 'text/html, text/plain;q=0.9, */*;q=0.5',
        },
      });

      // 3xx は手動で Location を取得して再検証
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location || redirectCount >= MAX_REDIRECTS) return null;
        let next: URL;
        try {
          next = new URL(location, safe);
        } catch {
          return null;
        }
        currentUrl = next;
        redirectCount++;
        continue;
      }

      if (!res.ok || !res.body) return null;

      // ストリームを読みつつ MAX_BYTES で打ち切る
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
          if (total >= MAX_BYTES) {
            try { await reader.cancel(); } catch { /* ignore */ }
            break;
          }
        }
      }
      const merged = new Uint8Array(Math.min(total, MAX_BYTES));
      let offset = 0;
      for (const c of chunks) {
        const space = MAX_BYTES - offset;
        if (space <= 0) break;
        merged.set(c.subarray(0, Math.min(c.byteLength, space)), offset);
        offset += Math.min(c.byteLength, space);
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(merged);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

// --- 検証方式 1: well-known -----------------------------------------
async function tryWellKnown(applicantUrl: URL, token: string): Promise<boolean> {
  const wk = new URL('/.well-known/geek-verify.txt', applicantUrl.origin);
  const safe = safeParseUrl(wk.toString());
  if (!safe) return false;
  const body = await safeFetchText(safe);
  if (!body) return false;
  return body.includes(token);
}

// --- 検証方式 2: meta-tag -------------------------------------------
function metaTagHasToken(html: string, token: string): boolean {
  const escToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+name\\s*=\\s*["']geek-verify["'][^>]+content\\s*=\\s*["']${escToken}["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']${escToken}["'][^>]+name\\s*=\\s*["']geek-verify["']`, 'i'),
  ];
  return patterns.some((p) => p.test(html));
}

async function tryMetaTag(applicantUrl: URL, token: string): Promise<boolean> {
  const body = await safeFetchText(applicantUrl);
  if (!body) return false;
  return metaTagHasToken(body, token);
}

// ====================================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(req) });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse(req, { status: 'failed', error: 'server-misconfigured' }, 500);
    }

    // 認証
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return jsonResponse(req, { status: 'failed', error: 'unauthorized' }, 401);
    }
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const applicationId: string | undefined = body?.application_id;
    if (!applicationId || typeof applicationId !== 'string' || applicationId.length > 64) {
      return jsonResponse(req, { status: 'failed', error: 'bad-request' }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: app, error: appErr } = await adminClient
      .from('official_community_applications')
      .select('id, applicant_user_id, applicant_url, verification_token, verification_status, status, verification_attempted_at')
      .eq('id', applicationId)
      .maybeSingle();

    if (appErr || !app) {
      return jsonResponse(req, { status: 'failed', error: 'not-found' }, 404);
    }

    // 申請者本人 or admin
    if (app.applicant_user_id !== userId) {
      const { data: isAdminRow } = await adminClient.rpc('is_admin');
      if (!isAdminRow) {
        return jsonResponse(req, { status: 'failed', error: 'forbidden' }, 403);
      }
    }

    // 監査指摘: 旧実装は申請 status を見ず、rejected/approved/cancelled の
    // 申請でも verification_status を勝手に書き換えていた。
    // pending のみ受け付ける。
    if (app.status !== 'pending') {
      return jsonResponse(req, { status: 'failed', error: 'application-not-pending' }, 409);
    }

    // クールダウン: 60 秒以内の連続検証は弾く (DDoS / 課金抑制)
    if (app.verification_attempted_at) {
      const lastMs = Date.parse(app.verification_attempted_at);
      if (Number.isFinite(lastMs) && Date.now() - lastMs < 60_000) {
        return jsonResponse(req, { status: 'failed', error: 'cooldown' }, 429);
      }
    }

    if (!app.applicant_url || !app.verification_token) {
      await adminClient
        .from('official_community_applications')
        .update({
          verification_status: 'failed',
          verification_attempted_at: new Date().toISOString(),
        })
        .eq('id', applicationId);
      return jsonResponse(req, { status: 'failed', error: 'no-url-or-token' });
    }

    const target = safeParseUrl(app.applicant_url);
    if (!target) {
      await adminClient
        .from('official_community_applications')
        .update({
          verification_status: 'failed',
          verification_attempted_at: new Date().toISOString(),
        })
        .eq('id', applicationId);
      return jsonResponse(req, { status: 'failed', error: 'invalid-url' });
    }

    let method: 'well-known' | 'meta-tag' | null = null;
    if (await tryWellKnown(target, app.verification_token)) {
      method = 'well-known';
    } else if (await tryMetaTag(target, app.verification_token)) {
      method = 'meta-tag';
    }

    const nowIso = new Date().toISOString();
    if (method) {
      await adminClient
        .from('official_community_applications')
        .update({
          verification_status: 'verified',
          verification_method: method,
          verification_attempted_at: nowIso,
        })
        .eq('id', applicationId);
      return jsonResponse(req, { status: 'verified', method });
    } else {
      await adminClient
        .from('official_community_applications')
        .update({
          verification_status: 'failed',
          verification_attempted_at: nowIso,
        })
        .eq('id', applicationId);
      return jsonResponse(req, { status: 'failed' });
    }
  } catch (e) {
    // production では詳細エラーを返さない
    if (isProduction()) {
      return jsonResponse(req, { status: 'failed', error: 'internal' }, 500);
    }
    return jsonResponse(
      req,
      { status: 'failed', error: e instanceof Error ? e.message : 'unknown' },
      500,
    );
  }
});
