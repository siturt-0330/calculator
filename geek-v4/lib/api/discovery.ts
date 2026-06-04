// ============================================================
// lib/api/discovery.ts — 検索タブ Discovery(特集) を 1 RTT で集約
// ------------------------------------------------------------
// get_discovery_payload(p_user_id) RPC (migration 0113) を 1 ラウンドトリップで叩き、
//   - hot:         hot 共有プール (HotPostsRow=上位10 / ForYouShelf=端末ローカル再ランク)
//   - recommended / rising / official: コミュ 3 種
//   - myCommunityIds: 参加済み判定用
// を取得する。RPC 未適用 (migration 未実行) / 失敗 / timeout 時は、従来の per-shelf
// クエリ群へ自動 fallback して挙動を完全維持する (pre-migration でも壊れない)。
//
// kill-switch: EXPO_PUBLIC_DISCOVERY_RPC=0 で RPC を無効化し fallback 経路に固定できる
//   (Expo は静的参照のみ inline するため process.env を直接比較する — CLAUDE.md §14)。
// ============================================================
import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import {
  discoverCommunities,
  fetchRisingCommunities,
  fetchOfficialCommunities,
  fetchMyCommunities,
  type Community,
} from './communities';
import { fetchPosts } from './posts';
import type { Post } from '../../types/models';

// hot 共有プール件数 (Hot 上位10 + ForYou 再ランク用の余白)。RPC / fallback で一致させる。
export const DISCOVERY_HOT_POOL = 18;
export const DISCOVERY_RECOMMENDED_LIMIT = 8;
export const DISCOVERY_RISING_LIMIT = 10;
export const DISCOVERY_OFFICIAL_LIMIT = 10;

const DISCOVERY_RPC_ENABLED = process.env.EXPO_PUBLIC_DISCOVERY_RPC !== '0';

export type DiscoveryPayload = {
  hot: Post[];
  recommended: Community[];
  rising: Community[];
  official: Community[];
  myCommunityIds: string[];
};

// 0113 RPC が返す json shape (snake_case)。
type RpcShape = {
  hot?: Post[] | null;
  recommended?: Community[] | null;
  rising?: Community[] | null;
  official?: Community[] | null;
  my_community_ids?: string[] | null;
};

function normalize(raw: RpcShape | null | undefined): DiscoveryPayload {
  const r = raw ?? {};
  return {
    hot: Array.isArray(r.hot) ? r.hot : [],
    recommended: Array.isArray(r.recommended) ? r.recommended : [],
    rising: Array.isArray(r.rising) ? r.rising : [],
    official: Array.isArray(r.official) ? r.official : [],
    myCommunityIds: Array.isArray(r.my_community_ids) ? r.my_community_ids : [],
  };
}

/**
 * Discovery 全セクションを 1 RPC で取得。RPC 不在/エラー時は per-shelf に fallback。
 * fallback でも throw しない (各 fetcher が空配列 fallback を持つ + allSettled)。
 */
export async function fetchDiscoveryPayload(userId: string | null): Promise<DiscoveryPayload> {
  if (DISCOVERY_RPC_ENABLED) {
    try {
      const { data, error } = await withApiTimeout(
        supabase.rpc('get_discovery_payload', {
          p_user_id: userId,
          p_hot_limit: DISCOVERY_HOT_POOL,
          p_recommended_limit: DISCOVERY_RECOMMENDED_LIMIT,
          p_rising_limit: DISCOVERY_RISING_LIMIT,
          p_official_limit: DISCOVERY_OFFICIAL_LIMIT,
        }),
        'discovery.payload',
        8000,
      );
      if (error) throw error;
      return normalize(data as RpcShape);
    } catch (rpcErr) {
      // RPC 未適用 (PGRST202 等) / timeout → 従来の per-shelf へ fallback。
      console.warn(
        '[discovery] get_discovery_payload RPC unavailable, falling back to per-shelf queries:',
        rpcErr instanceof Error ? rpcErr.message : String(rpcErr),
      );
    }
  }
  return fetchDiscoveryPayloadFallback(userId);
}

// fallback: 現行 per-shelf クエリを並列。hot は単一プール (Hot+ForYou 共有) なので
// 旧来の hot + for-you の 2 フェッチを 1 つに統合してある (RTT を 1 本削減)。
async function fetchDiscoveryPayloadFallback(userId: string | null): Promise<DiscoveryPayload> {
  const [hotR, recR, risR, offR, myR] = await Promise.allSettled([
    fetchPosts({ sort: 'hot', likedTags: [], blockedTags: [], limit: DISCOVERY_HOT_POOL, home: true }),
    discoverCommunities({ limit: DISCOVERY_RECOMMENDED_LIMIT }),
    fetchRisingCommunities(DISCOVERY_RISING_LIMIT),
    fetchOfficialCommunities(DISCOVERY_OFFICIAL_LIMIT),
    userId ? fetchMyCommunities() : Promise.resolve([] as Community[]),
  ]);
  const listOf = <T,>(r: PromiseSettledResult<T[]>): T[] => (r.status === 'fulfilled' ? r.value : []);
  return {
    hot: hotR.status === 'fulfilled' ? hotR.value.posts : [],
    recommended: listOf(recR as PromiseSettledResult<Community[]>),
    rising: listOf(risR as PromiseSettledResult<Community[]>),
    official: listOf(offR as PromiseSettledResult<Community[]>),
    myCommunityIds: listOf(myR as PromiseSettledResult<Community[]>).map((c) => c.id),
  };
}
