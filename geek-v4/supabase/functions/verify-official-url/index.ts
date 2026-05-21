// ============================================================
// verify-official-url: 公式申請の URL 所有確認
// ============================================================
// 申請者が `applicant_url` を本当に所有しているかをサーバ側で検証する。
//
// 検証方式 (順に試行):
//   1. well-known   : GET {origin}/.well-known/geek-verify.txt にトークンが含まれているか
//   2. meta-tag     : GET {applicant_url} の <head> に <meta name="geek-verify" content="<token>"> があるか
//   3. dns-txt      : (今はスキップ — Edge runtime での DNS は信頼性が低いため)
//
// 防御:
//   - http(s) のみ許可
//   - private/loopback/link-local IP を block (SSRF 対策)
//   - 5 秒タイムアウト
//   - 500 KB までしか読まない
//
// 戻り値: { status: 'verified' | 'failed'; method?: 'well-known' | 'meta-tag' }
//
// ------------------------------------------------------------
// デプロイ手順 (ユーザー側):
//   1. Supabase CLI で:
//        supabase functions deploy verify-official-url --project-ref <YOUR_REF>
//   2. 環境変数は不要 (service role key は内部 secret で自動注入される)
//   3. RLS により本人 + admin のみ申請を SELECT できるため、
//      この関数は service role で更新を行う必要がある。
// ------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 500 * 1024; // 500 KB

// --- SSRF 対策: private IP / loopback / link-local を block ---------
function isBlockedHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === 'localhost') return true;
  // IPv6 loopback / private
  if (lower === '::1' || lower === '[::1]') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('fe80')) return true; // link-local
  // IPv4 dotted-quad check
  const m = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;          // link-local
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

// --- 制限付き fetch (timeout + body サイズ上限) ---------------------
async function safeFetchText(target: URL): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': 'GeekVerifier/1.0 (+https://geek.app)',
        accept: 'text/html, text/plain;q=0.9, */*;q=0.5',
      },
    });
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
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c.subarray(0, Math.min(c.byteLength, MAX_BYTES - offset)), offset);
      offset += c.byteLength;
      if (offset >= MAX_BYTES) break;
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(merged.subarray(0, Math.min(total, MAX_BYTES)));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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
  // <meta name="geek-verify" content="<token>"> (属性順は問わない)
  // - 大文字小文字無視
  // - シングル / ダブルクオート両対応
  // - 属性間の空白は \s+
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
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({ status: 'failed', error: 'server-misconfigured' }, 500);
    }

    // 認証: 呼び出し元のユーザートークンを伝播してチェック
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return jsonResponse({ status: 'failed', error: 'unauthorized' }, 401);
    }
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const applicationId: string | undefined = body?.application_id;
    if (!applicationId || typeof applicationId !== 'string') {
      return jsonResponse({ status: 'failed', error: 'bad-request' }, 400);
    }

    // service role でロード (RLS バイパス) — 申請者本人 or admin かは下でチェック
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: app, error: appErr } = await adminClient
      .from('official_community_applications')
      .select('id, applicant_user_id, applicant_url, verification_token, verification_status')
      .eq('id', applicationId)
      .maybeSingle();

    if (appErr || !app) {
      return jsonResponse({ status: 'failed', error: 'not-found' }, 404);
    }

    // 申請者本人のみ (admin override は別フロー)
    if (app.applicant_user_id !== userId) {
      // admin かどうかチェック
      const { data: isAdminRow } = await adminClient.rpc('is_admin');
      if (!isAdminRow) {
        return jsonResponse({ status: 'failed', error: 'forbidden' }, 403);
      }
    }

    if (!app.applicant_url || !app.verification_token) {
      // URL or token がない申請は検証不可
      await adminClient
        .from('official_community_applications')
        .update({
          verification_status: 'failed',
          verification_attempted_at: new Date().toISOString(),
        })
        .eq('id', applicationId);
      return jsonResponse({ status: 'failed', error: 'no-url-or-token' });
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
      return jsonResponse({ status: 'failed', error: 'invalid-url' });
    }

    // 1) well-known
    let method: 'well-known' | 'meta-tag' | null = null;
    if (await tryWellKnown(target, app.verification_token)) {
      method = 'well-known';
    } else if (await tryMetaTag(target, app.verification_token)) {
      // 2) meta-tag
      method = 'meta-tag';
    }
    // 3) dns-txt: 現状は実装しない (Edge で DNS lookup が信頼できないため)

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
      return jsonResponse({ status: 'verified', method });
    } else {
      await adminClient
        .from('official_community_applications')
        .update({
          verification_status: 'failed',
          verification_attempted_at: nowIso,
        })
        .eq('id', applicationId);
      return jsonResponse({ status: 'failed' });
    }
  } catch (e) {
    return jsonResponse(
      { status: 'failed', error: e instanceof Error ? e.message : 'unknown' },
      500,
    );
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
