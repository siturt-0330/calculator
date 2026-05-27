import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl, useWindowDimensions, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getLastViewed, setLastViewed } from '../../lib/utils/lastViewed';
import { fetchPostById, fetchCommunitiesForPosts } from '../../lib/api/posts';
import { fetchSimilarPosts } from '../../lib/api/similarPosts';
import { fetchComments, createComment } from '../../lib/api/comments';
import { fetchPostAddedTags, addPostTag } from '../../lib/api/tags';
import { attachChannel } from '../../lib/realtime';
import { useFeedPage } from '../../hooks/useFeedPage';
import { useReactionToggle } from '../../hooks/useReactions';
import { invalidateFeedPage } from '../../lib/cacheUpdates/feedPagePatcher';
import { MemeReactionPicker } from '../../components/feed/MemeReactionPicker';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { TagPill } from '../../components/tag/TagPill';
import { AddTagInline } from '../../components/tag/AddTagInline';
import { ProgressiveImage } from '../../components/ui/ProgressiveImage';
import { Spinner } from '../../components/ui/Spinner';
import { useToastStore } from '../../stores/toastStore';
import { formatRelative } from '../../lib/utils/date';
import type { Comment } from '../../types/models';
import { Icon } from '../../constants/icons';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { postToObsidianNote } from '../../hooks/useObsidian';
import { CommentThreadItem } from '../../components/post/CommentThreadItem';
import { CollapsedComment } from '../../components/post/CollapsedComment';
import { buildCommentTree } from '../../lib/utils/commentTree';
import {
  shouldCollapseComment,
  groupConsecutiveCollapsed,
} from '../../lib/utils/commentCollapse';
import { getThreadUserId } from '../../lib/utils/threadUserId';
import * as Haptics from 'expo-haptics';
import { isValidUuid } from '../../lib/validation';

function safeHaptic(type: Haptics.NotificationFeedbackType) {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(type).catch(() => {});
}

const MAX_W = 720;

export default function PostDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  // route param を UUID validation して cache DoS を防ぐ (詳細は lib/validation.ts)
  const id = isValidUuid(rawId) ? rawId : null;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [text, setText] = useState('');
  const SendIcon = Icon.send;
  const BackIcon = Icon.arrowL;

  // ============================================================
  // 既読/未読ハイライト (issue #18)
  // ------------------------------------------------------------
  // - mount 時に保存済の lastViewed を snapshot として state に持つ
  //   (render 中に setLastViewed → 同 effect で再読み込みすると
  //    画面表示中に「未読」が次々消える挙動になり UX 上紛らわしいため、
  //    開いた瞬間の値を画面開放中は固定する)
  // - 開いた 3 秒後と unmount 時に setLastViewed で更新
  //   (3 秒は誤タップ・誤遷移で「既読」扱いになるのを防ぐ猶予)
  // ============================================================
  const [lastViewedSnapshot, setLastViewedSnapshot] = useState<number | null>(null);
  // 連続 setLastViewed を避けるためのフラグ
  const lastViewedSavedRef = useRef(false);
  // 新着までのスクロール用 ref (タップで scroll する用)
  const scrollRef = useRef<ScrollView>(null);

  // ============================================================
  // 返信モード (migration 0059)
  // ------------------------------------------------------------
  // 「このコメントに返信」をタップしたら replyTo に Comment をセットする。
  //   - 送信時: parentId = replyTo.id, replyToId = replyTo.id を attach
  //   - draft 先頭に「↳ #<rootIndex> さんへ」を自動挿入
  //   - キャンセル ✕ ボタンで replyTo を null に戻す
  // ============================================================
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  const { data: post, isLoading: postLoading, isError: postError } = useQuery({
    queryKey: ['post', id],
    queryFn: () => fetchPostById(id!),
    enabled: !!id,
    // 投稿本文は immutable に近い (counter のみ Realtime で invalidate される)
    // 同じ投稿を 30 秒以内に再オープン → 再 fetch しない
    staleTime: 60_000,
  });

  // ★ 投稿詳細でも reactions / my_like 等を表示するため、feed と同じ RPC
  // 経路 (useFeedPage) で 1 件分の周辺データを取得する。
  // フィードで使ってる useFeedPage と同じ cache prefix `[FEED_PAGE_KEY]` を共有
  // するので、useReactionToggle.onMutate の patchFeedPagePost が
  // 詳細画面の cache も自動で更新する (= 楽観 update が UI に即時反映される)。
  const postIdsForFeedPage = useMemo(() => (id ? [id] : []), [id]);
  const { fullPosts } = useFeedPage(postIdsForFeedPage);
  const fullPost = id ? fullPosts.get(id) : undefined;
  const reactions = fullPost?.reactions ?? [];
  const myMemes = useMemo(
    () => reactions.filter((r) => r.mine).map((r) => r.meme),
    [reactions],
  );
  const { toggle: toggleReact } = useReactionToggle();
  const [memePickerOpen, setMemePickerOpen] = useState(false);

  const { data: replies = [], isLoading: repliesLoading, refetch, isRefetching } = useQuery({
    queryKey: ['post-comments', id],
    queryFn: () => fetchComments(id!),
    enabled: !!id,
    // Realtime で INSERT 即時 invalidate される — 通常時の polling は抑える
    staleTime: 30_000,
  });

  const { data: addedTags = [] } = useQuery({
    queryKey: ['post-added-tags', id],
    queryFn: () => fetchPostAddedTags(id!),
    enabled: !!id,
    // タグ追加は明示 invalidate される — それ以外は 2 分信用
    staleTime: 2 * 60_000,
  });

  // 似た投稿
  const { data: similarPosts = [] } = useQuery({
    queryKey: ['similar-posts', id, post?.tag_names ?? []],
    queryFn: () => fetchSimilarPosts(id!, post?.tag_names ?? [], 3),
    enabled: !!id && !!post && (post?.tag_names?.length ?? 0) > 0,
    staleTime: 60_000,
  });

  // 紐付いたコミュニティ (cross-post / community_only / community_public)
  // 監査指摘: 投稿詳細から community への遷移経路が存在しなかった。
  // 旧版はフィードカード (AnonPostCard) でだけピル表示していたが、直リンク
  // やシェアから来たユーザーが community に戻れない問題があった。
  const { data: communitiesByPost = {} } = useQuery({
    queryKey: ['post-communities-of', id],
    queryFn: () => fetchCommunitiesForPosts([id!]),
    enabled: !!id,
    staleTime: 60_000,
  });
  const postCommunities = id ? (communitiesByPost[id] ?? []) : [];

  const { show } = useToastStore();

  const { mutateAsync: submitReply, isPending } = useMutation({
    // 返信モード時は parent_comment_id / reply_to_comment_id をセット
    mutationFn: (args: { content: string; parentId?: string; replyToId?: string }) =>
      createComment(id!, args.content, {
        parentId: args.parentId ?? null,
        replyToId: args.replyToId ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post-comments', id] });
      setText('');
      setReplyTo(null);
      safeHaptic(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: unknown) => {
      // 失敗時は haptic だけだとユーザーには無反応に見える — トーストでも明示
      safeHaptic(Haptics.NotificationFeedbackType.Error);
      const msg = e instanceof Error ? e.message : '';
      show(msg ? `送信に失敗しました: ${msg}` : '送信に失敗しました', 'error');
    },
  });

  // lastViewed: post を開いた瞬間の snapshot を取り、3 秒後 + unmount 時に save。
  // - mount 時 1 回だけ snapshot を読む (id 変更で reset)
  // - 3 秒以内に画面を離れた場合は unmount で確実に save される
  useEffect(() => {
    if (!id) return undefined;
    // 開いた瞬間の保存済値を snapshot (render 中はこれを使って未読判定)
    setLastViewedSnapshot(getLastViewed('post', id));
    lastViewedSavedRef.current = false;
    const t = setTimeout(() => {
      setLastViewed('post', id);
      lastViewedSavedRef.current = true;
    }, 3000);
    return () => {
      clearTimeout(t);
      // 3 秒経過前に離脱 → unmount で書き込む (重複でも害は無いが、無駄を避ける)
      if (!lastViewedSavedRef.current) {
        setLastViewed('post', id);
      }
    };
  }, [id]);

  // 未読コメント (snapshot 基準 + 自分の post-comments 結果) の id 集合と先頭 index
  const { unreadIds, firstUnreadIndex } = useMemo(() => {
    if (lastViewedSnapshot === null) return { unreadIds: new Set<string>(), firstUnreadIndex: -1 };
    const set = new Set<string>();
    let firstIdx = -1;
    for (let i = 0; i < replies.length; i++) {
      const c = replies[i];
      if (!c) continue;
      const created = Date.parse(c.created_at);
      if (Number.isFinite(created) && created > lastViewedSnapshot) {
        set.add(c.id);
        if (firstIdx === -1) firstIdx = i;
      }
    }
    return { unreadIds: set, firstUnreadIndex: firstIdx };
  }, [replies, lastViewedSnapshot]);

  // ============================================================
  // コメントツリー化 (migration 0059)
  // ------------------------------------------------------------
  // - commentTree: buildCommentTree で組み立てた root[] (各 root に children/depth)
  // - rootIndexById: id → root の index (#1, #2, ...)。root 自身 + 子孫すべてに
  //   同じ index を貼って表示に使う。 _rootOfId は子孫 id → root id を引く逆引き map。
  // ============================================================
  const commentTree = useMemo(() => buildCommentTree(replies), [replies]);

  const { rootIndexById, rootOfId } = useMemo(() => {
    const idx = new Map<string, number>();
    const rootOf = new Map<string, string>();
    commentTree.forEach((root, i) => {
      idx.set(root.id, i);
      rootOf.set(root.id, root.id);
      const visit = (nodes: Comment[]) => {
        for (const n of nodes) {
          rootOf.set(n.id, root.id);
          if (n.children && n.children.length > 0) visit(n.children);
        }
      };
      if (root.children && root.children.length > 0) visit(root.children);
    });
    return { rootIndexById: idx, rootOfId: rootOf };
  }, [commentTree]);

  const rootOfCommentId = (cid: string): string => rootOfId.get(cid) ?? cid;

  // Realtime: 同じ投稿への新規コメント + 投稿カウンター更新 + リアクション
  //
  // ★ 1 channel / 1 table パターン (旧版は 1 channel に 3 table を chain して
  //   いたが、publication 未登録 table が混ざると CHANNEL_ERROR で全死する
  //   既知不具合があるため分離する。詳細は hooks/useFeedRealtime.ts のコメント)。
  //
  // 注: 旧 reactions invalidate は ['reactions'] (legacy cache key) を叩いて
  //     いたが、投稿詳細では useFeedPage 経由で [FEED_PAGE_KEY] cache を使う。
  //     正しい target は invalidateFeedPage(qc) (= [FEED_PAGE_KEY] 全 cache)。
  useEffect(() => {
    if (!id) return;
    const detachers: Array<() => void> = [];
    detachers.push(
      attachChannel(`post-detail-comments:${id}`, (ch) =>
        ch.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${id}` },
          () => qc.invalidateQueries({ queryKey: ['post-comments', id] }),
        ),
      ),
    );
    detachers.push(
      attachChannel(`post-detail-post:${id}`, (ch) =>
        ch.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'posts', filter: `id=eq.${id}` },
          () => qc.invalidateQueries({ queryKey: ['post', id] }),
        ),
      ),
    );
    detachers.push(
      attachChannel(`post-detail-reactions:${id}`, (ch) =>
        ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'post_reactions', filter: `post_id=eq.${id}` },
          () => invalidateFeedPage(qc),
        ),
      ),
    );
    return () => {
      for (const d of detachers) d();
    };
  }, [id, qc]);

  const handleAddTag = async (tag: string) => {
    if (!id) return;
    try {
      await addPostTag(id, tag);
      qc.invalidateQueries({ queryKey: ['post-added-tags', id] });
      show(`#${tag} を追加しました`, 'success');
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : '') || '';
      if (msg.includes('duplicate')) show('そのタグは既に追加されています', 'warn');
      else show('追加に失敗しました', 'error');
    }
  };

  const handleSend = async () => {
    if (!text.trim() || isPending) return;
    // 返信モードなら parent_comment_id / reply_to_comment_id を attach
    const args = replyTo
      ? { content: text.trim(), parentId: replyTo.id, replyToId: replyTo.id }
      : { content: text.trim() };
    // mutateAsync は失敗時に reject するが、onError でトーストを出すので
    // ここでは握り潰して UI を壊さない (unhandled rejection 防止)
    await submitReply(args).catch((e: unknown) => {
      console.warn('[post/handleSend] submit failed:', e);
    });
  };

  // 返信ボタン押下: replyTo セット + draft に「↳ #N さんへ」を挿入
  // (UI 上は人間に読めるラベル / DB 上は reply_to_comment_id の uuid で正規化)
  const handleReply = (c: Comment) => {
    setReplyTo(c);
    // root index は flat 順 (replies の index + 1) を使う — buildCommentTree の
    // root だけ index 付与してるので、 reply 対象が child の場合は親 root の番号
    // を表示したい。ここでは comment id から root index を逆引きする。
    const idx = rootIndexById.get(rootOfCommentId(c.id)) ?? 0;
    const hash = getThreadUserId(c.id, id ?? '');
    const prefix = `↳ #${idx + 1} (${hash}) さんへ `;
    // 既に prefix がある場合は重複させない
    setText((cur) => (cur.startsWith('↳ ') ? cur : prefix + cur));
  };

  // route param validation 失敗 → cache 汚染を防ぐため早期 return
  if (!id) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: SP['6'] }}>
        <Text style={[T.body, { color: C.text2 }]}>無効な URL です</Text>
      </View>
    );
  }

  if (postLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </View>
    );
  }

  if (postError || !post) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: SP['6'], gap: SP['3'] }}>
        {/* 装飾絵文字 (📭) を撤去 — テキストだけで十分意味は通る */}
        <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>投稿を取得できませんでした</Text>
        <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
          通信エラーまたは削除された投稿の可能性があります
        </Text>
        <PressableScale
          onPress={() => router.back()}
          haptic="tap"
          hitSlop={10}
          style={{
            marginTop: SP['2'],
            paddingHorizontal: SP['5'], paddingVertical: SP['3'],
            backgroundColor: C.bg3, borderRadius: R.full,
            borderWidth: 1, borderColor: C.border,
          }}
        >
          <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>戻る</Text>
        </PressableScale>
      </View>
    );
  }

  // renderReply は CommentThreadItem に切り出した (migration 0059)。
  // ツリー化されたコメント (commentTree) を再帰的に描画する。

  const ListHeader = () => (
    <View style={{ alignItems: 'center' }}>
      {/* ヘッダー */}
      <View style={{ width: '100%', maxWidth: MAX_W }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP['3'], paddingTop: insets.top + SP['2'], paddingBottom: SP['2'] }}>
          <PressableScale
            onPress={() => router.back()}
            haptic="tap"
            hitSlop={12}
            accessibilityLabel="戻る"
            style={{ padding: SP['2'] }}
          >
            <BackIcon size={22} color={C.text} strokeWidth={2.2} />
          </PressableScale>
          <Text style={[T.smallM, { color: C.text3, marginLeft: SP['2'] }]}>📝 投稿</Text>
        </View>
        {/* 投稿本体カード */}
        <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['3'] }}>
          <View style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1, borderColor: C.border,
            gap: SP['3'],
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Avatar size={36} anonymous />
              <Text style={[T.caption, { color: C.text3, flex: 1 }]}>{formatRelative(post.created_at)}</Text>
              <ObsidianSaveButton note={postToObsidianNote(post)} size={18} />
            </View>
            <Text style={[T.body, { color: C.text, lineHeight: 24 }]}>{post.content}</Text>
            {/* コミュニティピル (cross-post / community_*) — タップで該当コミュへ */}
            {postCommunities.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <Text style={[T.caption, { color: C.text3 }]}>📍 投稿先:</Text>
                {postCommunities.map((c) => (
                  <PressableScale
                    key={c.community_id}
                    onPress={() => router.push(`/community/${c.community_id}` as never)}
                    haptic="tap"
                    hitSlop={6}
                    accessibilityLabel={`${c.name} コミュニティへ移動`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: SP['2'],
                      paddingVertical: 3,
                      backgroundColor: c.is_official ? C.accentBg : C.bg3,
                      borderWidth: 1,
                      borderColor: c.is_official ? C.accent : C.border,
                      borderRadius: R.full,
                    }}
                  >
                    {c.icon_url ? null : <Text style={{ fontSize: 11 }}>{c.icon_emoji}</Text>}
                    <Text style={[T.caption, {
                      color: c.is_official ? C.accent : C.text2,
                      fontWeight: '700',
                    }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'], alignItems: 'center' }}>
              {Array.from(new Set(post.tag_names)).map((tag) => (
                <TagPill key={tag} name={tag} state="normal" onPress={() => router.push(`/tag/${encodeURIComponent(tag)}` as never)} />
              ))}
              {addedTags.map((t) => (
                <TagPill key={t.id} name={t.tag_name} state="added" onPress={() => router.push(`/tag/${encodeURIComponent(t.tag_name)}` as never)} />
              ))}
              <AddTagInline onSubmit={handleAddTag} />
            </View>
            {addedTags.length > 0 && (
              <Text style={[T.caption, { color: C.sameGenre }]}>
                オレンジ色のタグは他のユーザーが追加したタグです
              </Text>
            )}

            {/* ============================================================
                リアクション (テキストスタンプ)
                ------------------------------------------------------------
                useFeedPage([id]) で取得した reactions を表示。タップで toggle。
                useReactionToggle が patchFeedPagePost 経由で [FEED_PAGE_KEY]
                cache を即時更新するので、ピル数値も即時反映される。
                ============================================================ */}
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 6,
                alignItems: 'center',
                marginTop: 2,
              }}
            >
              {reactions.slice(0, 12).map((r) => {
                const mine = r.mine;
                return (
                  <PressableScale
                    key={r.meme}
                    onPress={() => toggleReact(id, r.meme)}
                    haptic="tap"
                    hitSlop={6}
                    accessibilityLabel={`${r.meme} ${r.count} 件 ${mine ? '(押下済み)' : ''}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      paddingHorizontal: SP['3'],
                      paddingVertical: 5,
                      borderRadius: R.full,
                      backgroundColor: mine ? C.accent : C.bg3,
                      borderWidth: 1.5,
                      borderColor: mine ? C.accent : C.border,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: mine ? '#fff' : C.text,
                        fontWeight: '700',
                      }}
                    >
                      {r.meme}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: mine ? '#fff' : C.text2,
                        fontWeight: '700',
                      }}
                    >
                      {r.count}
                    </Text>
                  </PressableScale>
                );
              })}
              <PressableScale
                onPress={() => setMemePickerOpen(true)}
                haptic="tap"
                hitSlop={6}
                accessibilityLabel="テキストスタンプを追加"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: SP['3'],
                  paddingVertical: 5,
                  borderRadius: R.full,
                  backgroundColor: C.bg3,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderStyle: 'dashed',
                }}
              >
                <Icon.plus size={12} color={C.accent} strokeWidth={2.6} />
                <Text style={{ fontSize: 11, color: C.accent, fontWeight: '700' }}>
                  {reactions.length === 0 ? 'テキストスタンプを送る' : 'スタンプ'}
                </Text>
              </PressableScale>
            </View>
          </View>
        </View>

        {/* 似たような投稿 (V4 タグマッチング) */}
        {similarPosts.length > 0 && (
          <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['3'], gap: SP['2'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14 }}>🔗</Text>
              <Text style={[T.smallM, { color: C.text, fontWeight: '700', flex: 1 }]}>
                似たような投稿
              </Text>
              <Text style={[T.caption, { color: C.text3 }]}>
                {similarPosts.length}件
              </Text>
            </View>
            <View style={{ gap: SP['2'] }}>
              {similarPosts.map((p) => {
                // 写真付きの投稿は先頭の media_urls[0] を 64px サムネで表示。
                // (ユーザー要望: 似た投稿に写真が載っていても見れない問題の修正)
                const thumb = p.media_urls?.[0];
                const thumbBh = p.media_blurhashes?.[0];
                return (
                  <PressableScale
                    key={p.id}
                    onPress={() => router.push(`/post/${p.id}` as never)}
                    haptic="tap"
                    hitSlop={6}
                    accessibilityLabel={`似た投稿: ${p.content?.slice(0, 30) ?? ''} を開く`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SP['3'],
                      padding: SP['3'],
                      backgroundColor: C.bg3,
                      borderRadius: R.md,
                      borderWidth: 1, borderColor: C.border,
                    }}
                  >
                    {thumb && (
                      <View
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: R.sm,
                          overflow: 'hidden',
                          backgroundColor: C.bg2,
                          flexShrink: 0,
                        }}
                      >
                        <ProgressiveImage
                          uri={thumb}
                          blurhash={thumbBh ?? undefined}
                          width={64}
                          height={64}
                          radius={R.sm}
                        />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[T.small, { color: C.text, lineHeight: 18 }]} numberOfLines={2}>
                        {p.content}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
                        <Text style={[T.caption, { color: C.accent }]}>
                          #{p.tag_names[0] ?? '雑談'}
                        </Text>
                        <Text style={[T.caption, { color: C.text3 }]}>
                          · 💛 {p.likes_count ?? 0}
                        </Text>
                        <Text style={[T.caption, { color: C.text3 }]}>
                          · {formatRelative(p.created_at)}
                        </Text>
                        {p.media_urls && p.media_urls.length > 1 && (
                          <Text style={[T.caption, { color: C.text3 }]}>
                            · 📷 {p.media_urls.length}
                          </Text>
                        )}
                      </View>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        )}

        {replies.length > 0 && (
          <Text style={[T.smallM, { color: C.text2, paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['1'], fontWeight: '700' }]}>
            💬 {replies.length}件のコメント
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* ============================================================
          コメントツリー (migration 0059)
          ------------------------------------------------------------
          - FlashList から ScrollView に切替: 階層描画では item の高さが
            可変かつ再帰なので flash list の recycler は活かしづらい。
            投稿あたりのコメント数は通常 50 件以下 (1 root + 子孫合計でも
            ~200 件程度) なので ScrollView で十分。
          - ListHeader (投稿本体カード + 類似投稿 + コメント件数) はそのまま。
          - 各 root を CommentThreadItem に渡して再帰描画。
          ============================================================ */}
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: SP['8'] }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.accent} />
        }
      >
        <ListHeader />
        {repliesLoading ? (
          <View style={{ padding: SP['6'], alignItems: 'center' }}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : commentTree.length === 0 ? (
          <View style={{ padding: SP['6'], alignItems: 'center' }}>
            <Text style={[T.small, { color: C.text3 }]}>コメントはまだありません</Text>
          </View>
        ) : (
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: '100%', maxWidth: MAX_W, paddingHorizontal: SP['4'] }}>
              {/* ============================================================
                  自動 collapse (migration 0063 / Reddit ガイド 5.3 / 5.10)
                  ------------------------------------------------------------
                  - root レベルの comment を walk して shouldCollapseComment で
                    annotate → groupConsecutiveCollapsed で連続 collapse を 1
                    グループにまとめる。
                  - 2 件以上連続 collapse → <CollapsedComment> でラップ。
                  - 単体 (collapse 1 件 or 通常) は今までどおり <CommentThreadItem>。
                  - 未読 (unread) になっている collapse 対象は誤判定の可能性が
                    高いので、ここでは展開済の single として扱う (UX 優先)。
                  ============================================================ */}
              {(() => {
                const annotated = commentTree.map((root, idx) => {
                  const counts = root as typeof root & {
                    concern_count?: number;
                    likes_count?: number;
                    is_hidden_by_author?: boolean;
                  };
                  const collapsed =
                    !unreadIds.has(root.id) && shouldCollapseComment(counts);
                  return { root, idx, id: root.id, collapsed };
                });
                const grouped = groupConsecutiveCollapsed(annotated);
                return grouped.map((item, gIdx) => {
                  if (item.kind === 'single') {
                    const { root, idx } = item.comment;
                    return (
                      <CommentThreadItem
                        key={root.id}
                        comment={root}
                        rootIndex={idx + 1}
                        unread={unreadIds.has(root.id)}
                        postContent={post.content}
                        postId={post.id}
                        onReply={handleReply}
                      />
                    );
                  }
                  // group: 連続する collapse 対象を 1 chip に集約
                  return (
                    <CollapsedComment key={`grp-${gIdx}-${item.comments[0]?.id ?? ''}`} count={item.count}>
                      {item.comments.map(({ root, idx }) => (
                        <CommentThreadItem
                          key={root.id}
                          comment={root}
                          rootIndex={idx + 1}
                          unread={unreadIds.has(root.id)}
                          postContent={post.content}
                          postId={post.id}
                          onReply={handleReply}
                        />
                      ))}
                    </CollapsedComment>
                  );
                });
              })()}
            </View>
          </View>
        )}
      </ScrollView>

      {/* 新着 N 件アンカー (issue #18) — 未読が 1 件以上ある時のみ表示。
          tap で最初の未読までスクロール。Modal ではないので入力欄の上に
          浮かぶ floating pill として配置 (pointerEvents は box-none で
          周辺のタップを邪魔しない)。 */}
      {unreadIds.size > 0 && firstUnreadIndex >= 0 && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            // 入力欄の上に配置 (insets.bottom + 入力欄高さ ~60 + 余白)
            bottom: insets.bottom + 76,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <PressableScale
            onPress={() => {
              try {
                // ScrollView では index 指定の scroll が無い。コメントツリー化で
                // 各 row の高さが不定なので、ここでは end まで飛ばす近似 (best-effort)。
                // FlashList 時代の scrollToIndex に比べ精度は落ちるが、未読 UX
                // 自体は維持できる (画面下に新着のはず)。
                scrollRef.current?.scrollToEnd({ animated: true });
              } catch {
                /* swallow — scroll は best-effort */
              }
            }}
            haptic="tap"
            hitSlop={8}
            accessibilityLabel={`新着コメント ${unreadIds.size} 件へスクロール`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              backgroundColor: C.accent,
              borderRadius: R.full,
              borderWidth: 1.5,
              borderColor: C.accentLight,
              shadowColor: C.accent,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.4,
              shadowRadius: 10,
              elevation: 6,
            }}
          >
            <Icon.chevronD size={14} color="#fff" strokeWidth={2.6} />
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
              新着 {unreadIds.size} 件
            </Text>
          </PressableScale>
        </View>
      )}
      <View style={{ width: '100%', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg2 }}>
        {/* 返信モードバナー (migration 0059) — replyTo がセットされてる時のみ */}
        {replyTo && (
          <View style={{
            width: '100%', maxWidth: MAX_W,
            paddingHorizontal: SP['3'], paddingTop: SP['2'],
          }}>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              paddingHorizontal: SP['3'],
              paddingVertical: 6,
              backgroundColor: C.accentBg,
              borderRadius: R.md,
              borderWidth: 1, borderColor: C.accent,
            }}>
              <Icon.arrowUL size={14} color={C.accent} strokeWidth={2.4} />
              <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]} numberOfLines={1}>
                #{(rootIndexById.get(rootOfCommentId(replyTo.id)) ?? 0) + 1} さんに返信中
              </Text>
              <View style={{ flex: 1 }} />
              <PressableScale
                onPress={() => {
                  setReplyTo(null);
                  // prefix を text から取り除く (1 行目だけ消す素朴な実装)
                  setText((cur) => cur.replace(/^↳[^\n]*\n?/, ''));
                }}
                haptic="tap"
                hitSlop={8}
                accessibilityLabel="返信モードを解除"
                style={{ padding: 2 }}
              >
                <Icon.close size={14} color={C.accent} strokeWidth={2.4} />
              </PressableScale>
            </View>
          </View>
        )}
        <View style={{
          width: '100%', maxWidth: MAX_W,
          paddingHorizontal: SP['3'],
          paddingTop: SP['2'],
          paddingBottom: insets.bottom + SP['2'],
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: SP['2'],
        }}>
          <View style={{
            flex: 1,
            backgroundColor: C.bg3,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: text.trim() ? C.accent : C.border,
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
          }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={replyTo ? '返信内容を入力…' : 'コメントを入力…'}
              placeholderTextColor={C.text3}
              multiline
              maxLength={500}
              keyboardAppearance="dark"
              selectionColor={C.accent}
              style={[T.body, { color: C.text, maxHeight: 100, minHeight: 24, paddingVertical: 0 }]}
            />
            {text.length > 0 && (
              <Text style={{ fontSize: 10, color: text.length > 450 ? C.amber : C.text3, textAlign: 'right' }}>
                {text.length} / 500
              </Text>
            )}
          </View>
          <PressableScale
            onPress={handleSend}
            disabled={!text.trim() || isPending}
            haptic="confirm"
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: text.trim() && !isPending ? C.accent : C.bg4,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 2, borderColor: text.trim() && !isPending ? C.accent : C.border,
            }}
          >
            {isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <SendIcon size={20} color={text.trim() ? '#fff' : C.text3} strokeWidth={2.4} />
            )}
          </PressableScale>
        </View>
      </View>

      {/* テキストスタンプ Picker — フィードカードと同じ component を再利用 */}
      <MemeReactionPicker
        visible={memePickerOpen}
        onClose={() => setMemePickerOpen(false)}
        onPick={(meme) => toggleReact(id, meme)}
        picked={myMemes}
      />
    </KeyboardAvoidingView>
  );
}
