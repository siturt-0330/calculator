import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { addPostTag, fetchAddedTagsForPosts, removePostTag } from '../lib/api/tags';
import { useToastStore } from '../stores/toastStore';

const KEY_PREFIX = 'post-added-tags-batch';

function keyForIds(postIds: string[]) {
  return [KEY_PREFIX, postIds.slice().sort().join(',')];
}

export function useAddedTags(postIds: string[]) {
  const qc = useQueryClient();
  const sortedKey = postIds.slice().sort().join(',');

  const q = useQuery({
    queryKey: keyForIds(postIds),
    queryFn: () => fetchAddedTagsForPosts(postIds),
    enabled: postIds.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (postIds.length === 0) return;
    // O(1) lookup
    const idSet = new Set(postIds);
    // server-side filter で現在表示中の post の追加タグ変更だけを受信。
    // 全フィードユーザーに全タグ追加イベントを fanout するのは無駄。
    const serverIds = postIds.slice(0, 30);
    return attachChannel(`post-added-tags:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'post_added_tags',
          filter: `post_id=in.(${serverIds.join(',')})`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as { post_id?: string } | null;
          // 「全 prefix を invalidate」ではなく、今の sortedKey の query だけを再 fetch
          // 他のフィードビュー (例: 検索結果) の query は影響を受けない
          if (row?.post_id && idSet.has(row.post_id)) {
            qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
          }
        },
      ),
    );
    // ★ deps を sortedKey + qc に限定 (postIds は配列参照で毎 render 変わるため
    //   含めると channel が無限に detach/attach され Supabase pool を枯渇させる).
    //   postIds の中身は sortedKey に含意されているので sortedKey 一致中は
    //   closure 内の postIds は安定 (slice(0,30) も同じ結果になる).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKey, qc]);

  return { data: (q.data ?? {}) as Record<string, string[]>, isLoading: q.isLoading };
}

export function useAddTag() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  type Ctx = {
    snapshot: Array<[readonly unknown[], Record<string, string[]> | undefined]>;
  };
  const { mutateAsync } = useMutation<unknown, Error, { postId: string; tag: string }, Ctx>({
    mutationFn: ({ postId, tag }) => addPostTag(postId, tag),
    onMutate: async ({ postId, tag }) => {
      await qc.cancelQueries({ queryKey: [KEY_PREFIX] }).catch(() => {});
      // ★ CLAUDE.md § 5.2 対策: partial-match `setQueriesData` 廃止 → exact-key 書き戻し。
      //   `[KEY_PREFIX, sortedIdsJoinString]` 派生キーが複数あるケースで
      //   一部だけ更新されない問題を回避する。
      const entries = qc.getQueriesData<Record<string, string[]> | undefined>({
        queryKey: [KEY_PREFIX],
      });
      // snapshot は patch 前 (= mutation 適用前の真の値) で取る — onError で revert する
      const snapshot: Ctx['snapshot'] = entries as Ctx['snapshot'];
      for (const [exactKey, old] of entries) {
        if (!old) continue;
        const next = { ...old };
        const arr = (next[postId] ?? []).slice();
        if (!arr.includes(tag)) arr.push(tag);
        next[postId] = arr;
        qc.setQueryData(exactKey, next);
      }
      // 個別 queryKey もある (post detail)
      qc.invalidateQueries({ queryKey: ['post-added-tags', postId] });
      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      // 楽観更新を snapshot から revert (失敗時に「タグが付いた状態」が UI に残るのを防ぐ)
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
      const msg = err instanceof Error ? err.message : '';
      show(msg ? `タグの追加に失敗しました: ${msg}` : 'タグの追加に失敗しました', 'error');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
    },
  });
  return {
    addTag: (postId: string, tag: string) => mutateAsync({ postId, tag }),
  };
}

// ★ 2026-05 修正: 失敗を catch(() => {}) で握りつぶしていたのを onError 通知に変更。
// ★ 2026-05-28 追加: optimistic remove + snapshot revert を追加 (useAddTag と対称化)。
//   旧版は楽観更新なし → server RTT 後にだけ UI が更新されていて、削除ボタンを押しても
//   しばらくタグが残って見える違和感があった。
// onSettled は cache 整合性のため成功 / 失敗関わらず invalidate を継続。
// 戻り値の signature (removeTag(postId, tag) → Promise) は変更しない。
export function useRemoveTag() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  type Ctx = {
    snapshot: Array<[readonly unknown[], Record<string, string[]> | undefined]>;
  };
  const { mutateAsync } = useMutation<unknown, Error, { postId: string; tag: string }, Ctx>({
    mutationFn: ({ postId, tag }) => removePostTag(postId, tag),
    onMutate: async ({ postId, tag }) => {
      await qc.cancelQueries({ queryKey: [KEY_PREFIX] }).catch(() => {});
      const entries = qc.getQueriesData<Record<string, string[]> | undefined>({
        queryKey: [KEY_PREFIX],
      });
      const snapshot: Ctx['snapshot'] = entries as Ctx['snapshot'];
      for (const [exactKey, old] of entries) {
        if (!old) continue;
        const next = { ...old };
        const arr = (next[postId] ?? []).filter((t) => t !== tag);
        next[postId] = arr;
        qc.setQueryData(exactKey, next);
      }
      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
      console.warn('[removeTag] error:', err);
      show('タグの削除に失敗しました', 'error');
    },
    onSettled: () => {
      // invalidate は成功 / 失敗 関係なく走る (cache整合性のため)
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
      qc.invalidateQueries({ queryKey: ['post-added-tags'] });
    },
  });
  return {
    removeTag: (postId: string, tag: string) => mutateAsync({ postId, tag }),
  };
}
