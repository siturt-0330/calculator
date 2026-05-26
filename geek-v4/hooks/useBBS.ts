import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchThreads, createThread, fetchMyJoinedCommunityThreads } from '../lib/api/bbs';
import { attachChannel } from '../lib/realtime';
import { useAuthStore } from '../stores/authStore';

export function useBBS() {
  const qc = useQueryClient();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['bbs-threads'],
    queryFn: fetchThreads,
    staleTime: 30_000,
    // パフォーマンス監査: 'always' は staleTime を無視して毎マウント refetch するため
    // タブ切替時に必ず網絡 RTT 発生。staleTime 30s に従う default 動作に変更。
    // 新規スレッド検知は realtime subscription (下の attachChannel) でカバー済み。
  });

  const { mutateAsync: create } = useMutation({
    mutationFn: ({ title, category }: { title: string; category: string }) =>
      createThread(title, category),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bbs-threads'] }),
  });

  // Realtime: スレッド新規/更新 + 返信があったら一覧を更新 (replies_count, last_reply_at)
  // - visibility='public' のスレッドだけが一覧に出るので server-side で絞る
  // - bbs_replies の INSERT は filter できない (どの thread の reply かは payload を
  //   見ないと分からない) ので、3s debounce で fanout を集約する
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const invalidate = (delay = 1500) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['bbs-threads'] });
      }, delay);
    };
    // ★ CLAUDE.md § 5.3 / § 11: 1 channel に複数 table を chain しない。
    //   publication 未登録 table が 1 つでも binding に含まれると channel
    //   全体が CHANNEL_ERROR で死ぬ。bbs_threads / bbs_replies を別 channel に分離。
    const detachThreads = attachChannel('bbs-threads-list-threads', (ch) =>
      ch.on('postgres_changes', {
        event: '*', schema: 'public', table: 'bbs_threads',
        filter: 'visibility=eq.public',
      }, () => invalidate(1500)),
    );
    // 返信は filter できないが、3s debounce で集約 (返信量が多いコミュニティでも
    // 重い fanout を吸収)
    const detachReplies = attachChannel('bbs-threads-list-replies', (ch) =>
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bbs_replies' },
        () => invalidate(3000)),
    );
    return () => {
      detachThreads();
      detachReplies();
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [qc]);

  return {
    threads: data ?? [],
    loading: isLoading,
    refreshing: isRefetching,
    refresh: refetch,
    create,
  };
}

// ============================================================
// useMyCommunityBBS — 「コミュニティ」スコープ用
// ============================================================
// useBBS と同じ shape を返すが、自分が参加しているコミュニティの
// bbs_threads だけを取得する。realtime も community_id IN フィルタが
// PostgreSQL で書きづらい (in 句は postgres_changes filter で未サポート) ので
// 全 bbs 変更を購読しつつ debounce で invalidate (= useBBS と同じ debounce)。
//
// hasJoinedCommunities フラグも追加返却 — empty state の出し分けに使う:
//   - false → 「コミュニティに参加しよう」CTA を出す
//   - true & threads=[] → 「まだスレがありません」案内
// ============================================================
export function useMyCommunityBBS() {
  const qc = useQueryClient();
  // user.id が変わったら自動で query key が変わって stale 化される
  const userId = useAuthStore((s) => s.user?.id);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['bbs-threads', 'my-communities', userId ?? 'anon'],
    queryFn: () => fetchMyJoinedCommunityThreads(80),
    staleTime: 30_000,
    enabled: !!userId,
  });

  // useBBS と同じ realtime: bbs_threads / bbs_replies 変更で debounce invalidate
  // ('my-communities' クエリだけ無効化 — useBBS の 'bbs-threads' base key も
  //  下位 key として hit するので両方再 fetch される)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!userId) return;
    const invalidate = (delay = 1500) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['bbs-threads', 'my-communities', userId] });
      }, delay);
    };
    // ★ § 5.3: 1 channel / 1 table。bbs_threads と bbs_replies を別 channel に分離。
    const detachThreads = attachChannel('bbs-threads-my-communities-threads', (ch) =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'bbs_threads' },
        () => invalidate(1500)),
    );
    const detachReplies = attachChannel('bbs-threads-my-communities-replies', (ch) =>
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bbs_replies' },
        () => invalidate(3000)),
    );
    return () => {
      detachThreads();
      detachReplies();
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [qc, userId]);

  return {
    threads: data?.threads ?? [],
    hasJoinedCommunities: data?.hasJoinedCommunities ?? false,
    loading: isLoading,
    refreshing: isRefetching,
    refresh: refetch,
  };
}
