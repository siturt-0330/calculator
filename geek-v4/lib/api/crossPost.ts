// ============================================================
// クロスポスト (既存投稿を追加コミュニティへシェア) の API 層
//
// post_communities ジャンクションテーブルを操作する。
// Reddit 的な「同一投稿を複数コミュニティへ転載」機能。
// ============================================================

import { supabase } from '../supabase';
import { swallow } from '../swallow';

/** クロスポスト先コミュニティの参照型 */
export type CommunityRef = {
  id: string;
  name: string;
  icon_emoji: string | null;
};

// ============================================================
// クロスポスト追加
// ============================================================

/**
 * 既存投稿を指定コミュニティへクロスポストする。
 *
 * @returns 成功時 true / 重複 or エラー時 false
 */
export async function crossPostToCommunity(
  postId: string,
  communityId: string,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('post_communities')
      .insert({ post_id: postId, community_id: communityId });

    if (error) {
      // 一意制約違反 (code 23505) = 既に存在 → false を返すだけ
      if (error.code === '23505') return false;
      swallow('crossPost.add', error);
      return false;
    }

    return true;
  } catch (e) {
    swallow('crossPost.add.unexpected', e);
    return false;
  }
}

// ============================================================
// クロスポスト先一覧取得
// ============================================================

/**
 * 指定投稿がクロスポストされているコミュニティの一覧を返す。
 *
 * @returns コミュニティの配列 (エラー時は空配列)
 */
export async function getCrossPostCommunities(
  postId: string,
): Promise<CommunityRef[]> {
  try {
    const { data, error } = await supabase
      .from('post_communities')
      .select('community_id, communities(id, name, icon_emoji)')
      .eq('post_id', postId);

    if (error) {
      swallow('crossPost.getCommunities', error);
      return [];
    }

    if (!data) return [];

    // PostgREST のネスト select は communities が object で返る
    return data
      .map((row) => {
        const community = (row.communities as unknown) as
          | { id: string; name: string; icon_emoji: string | null }
          | null
          | undefined;
        if (!community) return null;
        return {
          id: community.id,
          name: community.name,
          icon_emoji: community.icon_emoji ?? null,
        } satisfies CommunityRef;
      })
      .filter((c): c is CommunityRef => c !== null);
  } catch (e) {
    swallow('crossPost.getCommunities.unexpected', e);
    return [];
  }
}

// ============================================================
// クロスポスト削除
// ============================================================

/**
 * 指定投稿のクロスポストを解除する。
 * RLS により、現在のユーザーが投稿の所有者でない場合は削除が無視される。
 *
 * @returns 成功時 true / エラー時 false
 */
export async function removeCrossPost(
  postId: string,
  communityId: string,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('post_communities')
      .delete()
      .eq('post_id', postId)
      .eq('community_id', communityId);

    if (error) {
      swallow('crossPost.remove', error);
      return false;
    }

    return true;
  } catch (e) {
    swallow('crossPost.remove.unexpected', e);
    return false;
  }
}
