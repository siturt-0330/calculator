// ============================================================
// useCommunityStamps / useCommunityStampReactions
// ============================================================
// コミュスタンプ一覧 + リアクション集計を React Query で管理。
// 既存 useReactions.ts と同じパターン (realtime + optimistic + 連打ガード)。
// ============================================================
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  listCommunityStamps,
  fetchCommunityStampReactionsForPosts,
  toggleCommunityStampReaction,
  createCommunityStamp,
  deleteCommunityStamp,
  type CommunityStamp,
  type CommunityStampAgg,
  type CommunityStampReactionsByPost,
} from '../lib/api/communityStamps';
import { attachChannel } from '../lib/realtime';
import { useToastStore } from '../stores/toastStore';
import { stableKeyFor } from '../lib/utils/queryKey';

// ============================================================
// 1) コミュスタンプ一覧
// ============================================================
export function useCommunityStamps(communityId: string | undefined) {
  const qc = useQueryClient();
  const key = ['community-stamps', communityId];

  const q = useQuery({
    queryKey: key,
    queryFn: () => listCommunityStamps(communityId!),
    enabled: !!communityId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // Realtime: スタンプの追加 / 削除 / use_count 更新で invalidate
  // 同一 community 内のみを購読 (server-side filter)
  useEffect(() => {
    if (!communityId) return;
    const detach = attachChannel(
      `community-stamps:${communityId}`,
      (ch) =>
        ch.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'community_stamps',
            filter: `community_id=eq.${communityId}`,
          },
          () => qc.invalidateQueries({ queryKey: key }),
        ),
    );
    return () => { try { detach(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, qc]);

  return q;
}

// ============================================================
// 2) 作成 / 削除 mutation
// ============================================================
export function useCreateCommunityStamp(communityId: string | undefined) {
  const qc = useQueryClient();
  const { show } = useToastStore();
  return useMutation({
    mutationFn: async (input: { label: string; image_url?: string | null }) => {
      if (!communityId) throw new Error('community_id not set');
      const { data, error } = await createCommunityStamp({
        community_id: communityId,
        label: input.label,
        image_url: input.image_url ?? null,
      });
      if (error || !data) throw new Error(error ?? '作成に失敗しました');
      return data;
    },
    onSuccess: () => {
      if (communityId) qc.invalidateQueries({ queryKey: ['community-stamps', communityId] });
      show('スタンプを作成しました', 'success');
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '作成に失敗しました';
      show(msg, 'error');
    },
  });
}

// 削除 — 楽観削除 + 失敗時 revert。
// 一覧 (community-stamps) と 各 post の reactions (community-stamp-reactions) の
// 両キャッシュから即座に消すことで「タップ → 確認 → 確定」の待ち時間を体感ゼロに。
export function useDeleteCommunityStamp(communityId: string | undefined) {
  const qc = useQueryClient();
  const { show } = useToastStore();

  type Ctx = {
    listSnap: CommunityStamp[] | undefined;
    reactionsSnap: Array<[readonly unknown[], CommunityStampReactionsByPost | undefined]>;
  };

  return useMutation<void, Error, string, Ctx>({
    mutationFn: async (stampId: string) => {
      const { error } = await deleteCommunityStamp(stampId);
      if (error) throw new Error(error);
    },
    onMutate: async (stampId) => {
      await qc.cancelQueries({ queryKey: ['community-stamps'] });
      await qc.cancelQueries({ queryKey: ['community-stamp-reactions'] });

      const listKey = ['community-stamps', communityId];
      const listSnap = qc.getQueryData<CommunityStamp[]>(listKey);
      const reactionsSnap = qc.getQueriesData<CommunityStampReactionsByPost | undefined>({
        queryKey: ['community-stamp-reactions'],
      }) as Ctx['reactionsSnap'];

      // 1) 一覧から削除
      if (communityId) {
        qc.setQueryData<CommunityStamp[]>(listKey, (old) =>
          (old ?? []).filter((s) => s.id !== stampId),
        );
      }
      // 2) 各 post の reactions からも除外 (孤児表示を防ぐ)
      //    ★ CLAUDE.md § 5.2 対策: partial-match `setQueriesData` 廃止 → exact-key 書き戻し。
      //    useCommunityStampReactionToggle と同じ pattern。
      const allReactionEntries = qc.getQueriesData<CommunityStampReactionsByPost | undefined>({
        queryKey: ['community-stamp-reactions'],
      });
      for (const [exactKey, old] of allReactionEntries) {
        if (!old) continue;
        const next: CommunityStampReactionsByPost = {};
        for (const [pid, list] of Object.entries(old)) {
          next[pid] = list.filter((r) => r.stamp.id !== stampId);
        }
        qc.setQueryData(exactKey, next);
      }

      return { listSnap, reactionsSnap };
    },
    onSuccess: () => {
      show('スタンプを削除しました', 'success');
    },
    onError: (e, _id, ctx) => {
      if (ctx) {
        if (communityId && ctx.listSnap) {
          qc.setQueryData(['community-stamps', communityId], ctx.listSnap);
        }
        for (const [key, data] of ctx.reactionsSnap) qc.setQueryData(key, data);
      }
      const msg = e instanceof Error ? e.message : '削除に失敗しました';
      show(msg, 'error');
    },
    onSettled: () => {
      if (communityId) qc.invalidateQueries({ queryKey: ['community-stamps', communityId] });
      qc.invalidateQueries({ queryKey: ['community-stamp-reactions'] });
    },
  });
}

// ============================================================
// 3) 投稿群のコミュスタンプリアクション集計
// ============================================================
export function useCommunityStampReactions(postIds: string[]) {
  const qc = useQueryClient();
  // sorted key で安定化 (useReactions と同じ手法)
  const sortedIds = useMemo(() => [...postIds].sort(), [postIds]);
  const idSet = useMemo(() => new Set(sortedIds), [sortedIds]);
  const sortedKey = useMemo(() => stableKeyFor(sortedIds), [sortedIds]);

  const q = useQuery({
    queryKey: ['community-stamp-reactions', sortedKey],
    queryFn: () => fetchCommunityStampReactionsForPosts(sortedIds),
    enabled: sortedIds.length > 0,
    staleTime: 30_000,
  });

  // realtime: 当該 post 群への INSERT/DELETE で invalidate
  // PostgREST in.(...) フィルタは長すぎると 414 になるので 30 件で打ち切り
  useEffect(() => {
    if (sortedIds.length === 0) return;
    const watchIds = sortedIds.slice(0, 30);
    const detach = attachChannel(
      `community-stamp-reactions:${sortedKey.slice(0, 100)}`,
      (ch) =>
        ch.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'community_stamp_reactions',
            filter: `post_id=in.(${watchIds.join(',')})`,
          },
          (payload: { new?: { post_id?: string }; old?: { post_id?: string } }) => {
            const pid = payload.new?.post_id ?? payload.old?.post_id;
            if (pid && idSet.has(pid)) {
              qc.invalidateQueries({ queryKey: ['community-stamp-reactions', sortedKey] });
            }
          },
        ),
    );
    return () => { try { detach(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKey, qc]);

  return q;
}

// ============================================================
// 4) リアクションのトグル (楽観更新 + snapshot revert + 連打ガード)
// ============================================================
// 改訂理由:
//   1. 連打 (同一 postId+stampId への連続 tap) で server-side toggle が
//      DELETE×2 と並走し use_count が二重消費される critical bug を防ぐ
//      → in-flight (postId+stampId) を Set で握って 2 回目以降は無視。
//      `toggle()` を返すので呼び出し側は mutate() ではなく toggle() を使う。
//   2. snapshot は setQueriesData の前 (= mutation 適用前の真の値) で取って
//      onError で確実に revert。
//   3. communityId を caches から解決して INSERT 前の追加 fetch を排除。
// ============================================================
export function useCommunityStampReactionToggle() {
  const qc = useQueryClient();
  const { show } = useToastStore();
  const inFlight = useRef<Set<string>>(new Set());

  type ToggleVars = { postId: string; stampId: string };
  type Snapshot = Array<[readonly unknown[], CommunityStampReactionsByPost | undefined]>;

  const mutation = useMutation<boolean, Error, ToggleVars, { snapshot: Snapshot }>({
    mutationFn: async ({ postId, stampId }) => {
      // communityId をキャッシュから解決して余分な RTT を排除。
      // reactions キャッシュ → stamps キャッシュの順で探索。
      let cachedCommunityId: string | undefined;
      const allReactionsCaches = qc.getQueriesData<CommunityStampReactionsByPost>({
        queryKey: ['community-stamp-reactions'],
      });
      outer: for (const [, byPost] of allReactionsCaches) {
        if (!byPost) continue;
        for (const reactions of Object.values(byPost)) {
          const hit = reactions.find((r) => r.stamp.id === stampId);
          if (hit) { cachedCommunityId = hit.stamp.community_id; break outer; }
        }
      }
      if (!cachedCommunityId) {
        const allStampsCaches = qc.getQueriesData<CommunityStamp[]>({ queryKey: ['community-stamps'] });
        for (const [, stamps] of allStampsCaches) {
          const hit = stamps?.find((s) => s.id === stampId);
          if (hit) { cachedCommunityId = hit.community_id; break; }
        }
      }
      const { on, error } = await toggleCommunityStampReaction(postId, stampId, cachedCommunityId);
      if (error) throw new Error(error);
      return on;
    },
    onMutate: async ({ postId, stampId }) => {
      // ★ await を復活: in-flight refetch のキャンセル完了を待ってから
      //   optimistic を書き込む。これをしないと refetch のレスポンスが
      //   optimistic 値を上書きして「タップしても反映されない」現象が起きる。
      //   useReactionToggle 側で同じ修正が入っているのに、こちらは旧コメントの
      //   「体感速度優先 (fire-and-forget)」のまま放置されていた。symptom 報告:
      //   「テキストスタンプを押した瞬間は反映されず、いいねを押すと反映される」
      //   (いいね側は await 復活済 → cache が正しく更新 → AnonPostCard re-render
      //    → ついでに stamp 表示も最新の楽観値で描画される、という traversal)。
      await qc.cancelQueries({ queryKey: ['community-stamp-reactions'] }).catch(() => {});

      // ★ setQueriesData の前にスナップショットを取る (mutation 後に取ると更新済みの値が入り revert できない)
      const snapshot: Snapshot = qc.getQueriesData<CommunityStampReactionsByPost | undefined>({
        queryKey: ['community-stamp-reactions'],
      }) as Snapshot;

      // 該当スタンプの実体を community-stamps キャッシュから取得 (全 community を総当たり)。
      let stampEntry: CommunityStamp | undefined;
      const allStampsCaches = qc.getQueriesData<CommunityStamp[]>({ queryKey: ['community-stamps'] });
      for (const [, stamps] of allStampsCaches) {
        if (!stamps) continue;
        const hit = stamps.find((s) => s.id === stampId);
        if (hit) { stampEntry = hit; break; }
      }

      // 全 community-stamp-reactions キャッシュを総当たりして楽観更新。
      // ★ CLAUDE.md § 5.2 にある「partial-match の setQueriesData が散発的に
      //   伝播しない react-query v5 issue」対策: getQueriesData で exact key を
      //   列挙して setQueryData (exact-key) で逐次書き戻す。
      //   useReactionToggle / patchFeedPagePost と同じ pattern。
      const allReactionEntries = qc.getQueriesData<CommunityStampReactionsByPost | undefined>({
        queryKey: ['community-stamp-reactions'],
      });
      for (const [exactKey, old] of allReactionEntries) {
        if (!old) continue;
        if (!(postId in old)) continue;
        const next: CommunityStampReactionsByPost = { ...old };
        const list = (next[postId] ?? []).slice();
        const idx = list.findIndex((r) => r.stamp.id === stampId);
        if (idx >= 0) {
          const cur = list[idx];
          if (!cur) continue;
          if (cur.mine) {
            const newCount = cur.count - 1;
            if (newCount <= 0) list.splice(idx, 1);
            else list[idx] = { stamp: cur.stamp, count: newCount, mine: false };
          } else {
            list[idx] = { stamp: cur.stamp, count: cur.count + 1, mine: true };
          }
        } else if (stampEntry) {
          list.push({ stamp: stampEntry, count: 1, mine: true });
        }
        list.sort((a, b) => b.count - a.count);
        next[postId] = list;
        qc.setQueryData(exactKey, next);
      }

      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      // revert: snapshot をそのまま戻す
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) {
          qc.setQueryData(key, data);
        }
      }
      qc.invalidateQueries({ queryKey: ['community-stamp-reactions'] });
      const msg = e instanceof Error ? e.message : 'リアクションに失敗しました';
      show(msg, 'error');
    },
    onSettled: () => {
      // realtime と楽観の二重反映を server truth で整合
      qc.invalidateQueries({ queryKey: ['community-stamp-reactions'] });
      // use_count も変わるので community-stamps も更新
      qc.invalidateQueries({ queryKey: ['community-stamps'] });
    },
  });

  // 連打 (同一 postId+stampId が in-flight 中の追加 tap) を吸収。
  // 親 (CommunityStampRow) には pendingStampIds を渡して chip を disabled 化するが、
  // pending state が parent に伝わる前に再 tap される race を hook 層で確実に潰す。
  const toggle = useCallback((vars: ToggleVars) => {
    const k = `${vars.postId}:${vars.stampId}`;
    if (inFlight.current.has(k)) return;
    inFlight.current.add(k);
    mutation.mutate(vars, {
      onSettled: () => { inFlight.current.delete(k); },
    });
  }, [mutation]);

  return Object.assign(mutation, { toggle });
}

// 型 re-export
export type { CommunityStamp, CommunityStampAgg, CommunityStampReactionsByPost };
