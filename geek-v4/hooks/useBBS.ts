import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchThreads, createThread, fetchMyJoinedCommunityThreads, fetchReplies } from '../lib/api/bbs';
import { attachChannel } from '../lib/realtime';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// スレ一覧 → スレ詳細タップ時に「即座に開く」UX のため上位 N 件の replies を背景 prefetch する。
// - 5 件: 大半のユーザーが一覧の最初に出てくる上位スレを開く統計を想定 (=ヒット率高い)
// - 過剰な数は network / cache を圧迫するので低めに置く
// - prefetchQuery は staleTime 内なら no-op (再リクエストしない) のため副作用無し
const PREFETCH_TOP_N = 5;

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

  // ★ Prefetch: スレ一覧が解決したら、上位 PREFETCH_TOP_N スレの replies を背景取得する。
  //   ユーザーが一覧上位スレを開いたとき、['bbs-replies', id] cache が既に温まっているため
  //   詳細画面で即座に内容が出る (=画面遷移時のローディングフラッシュが消える)。
  //   staleTime 15s 内なら useBBSThread 側で同じ key を使うので no-op。
  useEffect(() => {
    if (!data || data.length === 0) return;
    const topIds = data.slice(0, PREFETCH_TOP_N).map((t) => t.id).filter(Boolean);
    for (const id of topIds) {
      qc.prefetchQuery({
        queryKey: ['bbs-replies', id],
        queryFn: () => fetchReplies(id),
        staleTime: 15_000,
      }).catch(() => {
        // prefetch 失敗は silent: 実際の遷移時に通常の fetch が走るので UX に影響なし
      });
    }
  }, [data, qc]);

  const { mutateAsync: create } = useMutation({
    mutationFn: ({ title, category }: { title: string; category: string }) =>
      createThread(title, category),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bbs-threads'] }),
    onError: (e) => {
      // 既存 caller (app/bbs/create.tsx) は createThread を直接呼んでいて useBBS().create
      // 経由ではない。この onError は将来の caller 用 safety-net。
      const msg = e instanceof Error ? e.message : '';
      useToastStore.getState().show(
        msg ? `スレッドの作成に失敗しました: ${msg}` : 'スレッドの作成に失敗しました',
        'error',
      );
    },
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

  // ★ Prefetch: コミュニティスコープでも同じく上位 N スレの replies を背景取得。
  //   useBBS と独立の effect (data shape が異なるため)。
  useEffect(() => {
    const threads = data?.threads;
    if (!threads || threads.length === 0) return;
    const topIds = threads.slice(0, PREFETCH_TOP_N).map((t) => t.id).filter(Boolean);
    for (const id of topIds) {
      qc.prefetchQuery({
        queryKey: ['bbs-replies', id],
        queryFn: () => fetchReplies(id),
        staleTime: 15_000,
      }).catch(() => {
        // prefetch 失敗は silent
      });
    }
  }, [data, qc]);

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
