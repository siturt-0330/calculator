// ============================================================
// calculate-trust-score: ユーザーの信頼スコアを再計算
// ============================================================
// 監査修正:
//   - Authorization ヘッダから user を取得し、本人 or admin のみ実行可能
//   - 任意の user_id を POST して他人のスコアを書き換えられる脆弱性を修正
//   - CORS allowlist 方式
//   - 入力バリデーション (user_id が UUID 形式かチェック)
// ============================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { buildCorsHeaders, jsonResponse } from '../_shared/cors.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(req) });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse(req, { error: 'server-misconfigured' }, 500);
  }

  // 認証: caller の user を確認
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) {
    return jsonResponse(req, { error: 'unauthorized' }, 401);
  }
  const authClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return jsonResponse(req, { error: 'unauthorized' }, 401);
  }
  const callerId = userRes.user.id;

  // 入力 parse
  let body: { user_id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'bad-json' }, 400);
  }
  const targetUserId = typeof body.user_id === 'string' ? body.user_id : callerId;
  if (!UUID_RE.test(targetUserId)) {
    return jsonResponse(req, { error: 'bad-user-id' }, 400);
  }

  // 認可: 本人 or admin のみ
  if (targetUserId !== callerId) {
    const { data: isAdmin } = await authClient.rpc('is_admin');
    if (!isAdmin) {
      return jsonResponse(req, { error: 'forbidden' }, 403);
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('post_count, comment_count, like_received_count, created_at')
      .eq('id', targetUserId)
      .maybeSingle();

    if (!profile) {
      return jsonResponse(req, { error: 'not-found' }, 404);
    }

    const daysSince = Math.floor(
      (Date.now() - new Date(profile.created_at as string).getTime()) / (1000 * 60 * 60 * 24)
    );
    const accountAgeFactor = Math.min(daysSince / 30, 1) * 20;
    const postFactor = Math.min((profile.post_count as number) / 10, 1) * 30;
    const likeFactor = Math.min((profile.like_received_count as number) / 20, 1) * 30;
    const commentFactor = Math.min((profile.comment_count as number) / 20, 1) * 20;
    const score = Math.max(0, Math.min(100, Math.round(
      accountAgeFactor + postFactor + likeFactor + commentFactor
    )));

    // 0036 の guard_profile_update は admin の UPDATE は許可するため、
    // service role で実行する本関数からは trust_score を更新可能。
    await admin.from('profiles').update({ trust_score: score }).eq('id', targetUserId);

    return jsonResponse(req, { score });
  } catch {
    // fail-secure: エラー時はスコア変更せず 500
    return jsonResponse(req, { error: 'internal' }, 500);
  }
});
