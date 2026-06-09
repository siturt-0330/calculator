// ============================================================
// lib/safety/contentFilter — AI コンテンツモデレーション (クライアント側スタブ)
// ============================================================
//
// Edge Function 'moderate-content' は未実装 (scaffold のみ)。
// 実装時は Supabase Edge Functions + Anthropic API (claude-haiku-4-5) で:
// 1. 投稿本文を受け取り有害コンテンツを分類
// 2. 結果を post_moderation_queue テーブルに保存
// 3. 高リスクなら自動非表示 + 管理者通知
//
// このファイルはクライアント側のエントリポイント。
// 実際の AI 判定は Edge Function 側で行われるため、
// ANTHROPIC_API_KEY はクライアントバンドルに含まれない。
// ============================================================

import { supabase } from '../supabase';

// ============================================================
// 型定義
// ============================================================

export type ContentReportType =
  | 'spam'
  | 'harmful_image'
  | 'harassment'
  | 'misinformation'
  | 'other';

export type ModerationStatus = {
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
};

// ============================================================
// reportContentForAIReview
// — 投稿を AI モデレーションキューに登録する
// ============================================================
// Edge Function 'moderate-content' を呼び出してレビュー依頼を送る。
// 通信エラー / Edge Function 未デプロイの場合は false を返して握りつぶす
// (ユーザー体験を壊さず、管理者が後から対処できる設計)。
// ============================================================
export async function reportContentForAIReview(
  postId: string,
  reportType: ContentReportType,
): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke('moderate-content', {
      body: { post_id: postId, report_type: reportType },
    });
    if (error) {
      console.warn('[contentFilter] moderate-content invoke error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[contentFilter] reportContentForAIReview 予期しないエラー:', e);
    return false;
  }
}

// ============================================================
// getModerationStatus
// — 投稿のモデレーション結果を取得する
// ============================================================
// post_moderation_queue テーブルが未作成 (migration 未適用) の場合は
// PGRST エラー (42P01 / PGRST116 等) を捕捉して null を返す。
// テーブルが存在しても該当 row がない場合も null を返す (maybeSingle)。
// ============================================================
export async function getModerationStatus(
  postId: string,
): Promise<ModerationStatus | null> {
  try {
    const { data, error } = await supabase
      .from('post_moderation_queue')
      .select('status,reason')
      .eq('post_id', postId)
      .maybeSingle();

    if (error) {
      // テーブル未存在 (PGRST116 / PostgreSQL 42P01) は graceful に null を返す
      if (
        error.code === 'PGRST116' ||
        error.code === '42P01' ||
        error.message?.includes('relation') ||
        error.message?.includes('does not exist')
      ) {
        return null;
      }
      console.warn('[contentFilter] getModerationStatus error:', error.message);
      return null;
    }

    if (!data) return null;

    return {
      status: data.status as ModerationStatus['status'],
      reason: data.reason ?? undefined,
    };
  } catch (e) {
    console.warn('[contentFilter] getModerationStatus 予期しないエラー:', e);
    return null;
  }
}
