import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { fetchPostById, fetchCommunitiesForPosts } from '../../lib/api/posts';
import { fetchSimilarPosts } from '../../lib/api/similarPosts';
import { fetchComments, createComment } from '../../lib/api/bbs';
import { fetchPostAddedTags, addPostTag } from '../../lib/api/tags';
import { supabase } from '../../lib/supabase';
import { attachChannel } from '../../lib/realtime';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { TagPill } from '../../components/tag/TagPill';
import { AddTagInline } from '../../components/tag/AddTagInline';
import { Spinner } from '../../components/ui/Spinner';
import { TrustBadge } from '../../components/ui/TrustBadge';
import { useToastStore } from '../../stores/toastStore';
import { formatRelative } from '../../lib/utils/date';
import type { Comment } from '../../types/models';
import { Icon } from '../../constants/icons';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { postToObsidianNote, commentToObsidianNote } from '../../hooks/useObsidian';
import * as Haptics from 'expo-haptics';

function safeHaptic(type: Haptics.NotificationFeedbackType) {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(type).catch(() => {});
}

const MAX_W = 720;

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [text, setText] = useState('');
  const SendIcon = Icon.send;
  const BackIcon = Icon.arrowL;

  const { data: post, isLoading: postLoading, isError: postError } = useQuery({
    queryKey: ['post', id],
    queryFn: () => fetchPostById(id),
    enabled: !!id,
    // 投稿本文は immutable に近い (counter のみ Realtime で invalidate される)
    // 同じ投稿を 30 秒以内に再オープン → 再 fetch しない
    staleTime: 60_000,
  });

  const { data: replies = [], isLoading: repliesLoading, refetch, isRefetching } = useQuery({
    queryKey: ['post-comments', id],
    queryFn: () => fetchComments(id),
    enabled: !!id,
    // Realtime で INSERT 即時 invalidate される — 通常時の polling は抑える
    staleTime: 30_000,
  });

  const { data: addedTags = [] } = useQuery({
    queryKey: ['post-added-tags', id],
    queryFn: () => fetchPostAddedTags(id),
    enabled: !!id,
    // タグ追加は明示 invalidate される — それ以外は 2 分信用
    staleTime: 2 * 60_000,
  });

  // 似た投稿
  const { data: similarPosts = [] } = useQuery({
    queryKey: ['similar-posts', id, post?.tag_names ?? []],
    queryFn: () => fetchSimilarPosts(id, post?.tag_names ?? [], 6),
    enabled: !!id && !!post && (post?.tag_names?.length ?? 0) > 0,
    staleTime: 60_000,
  });

  // 紐付いたコミュニティ (cross-post / community_only / community_public)
  // 監査指摘: 投稿詳細から community への遷移経路が存在しなかった。
  // 旧版はフィードカード (AnonPostCard) でだけピル表示していたが、直リンク
  // やシェアから来たユーザーが community に戻れない問題があった。
  const { data: communitiesByPost = {} } = useQuery({
    queryKey: ['post-communities-of', id],
    queryFn: () => fetchCommunitiesForPosts([id]),
    enabled: !!id,
    staleTime: 60_000,
  });
  const postCommunities = communitiesByPost[id] ?? [];

  const { show } = useToastStore();

  const { mutateAsync: submitReply, isPending } = useMutation({
    mutationFn: (content: string) => createComment(id, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post-comments', id] });
      setText('');
      safeHaptic(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: unknown) => {
      // 失敗時は haptic だけだとユーザーには無反応に見える — トーストでも明示
      safeHaptic(Haptics.NotificationFeedbackType.Error);
      const msg = e instanceof Error ? e.message : '';
      show(msg ? `送信に失敗しました: ${msg}` : '送信に失敗しました', 'error');
    },
  });

  // Realtime: 同じ投稿への新規コメント + 投稿カウンター更新
  useEffect(() => {
    if (!id) return;
    return attachChannel(`post-detail:${id}`, (ch) =>
      ch.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ['post-comments', id] }),
      ).on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'posts', filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ['post', id] }),
      ).on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'post_reactions', filter: `post_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ['reactions'] }),
      ),
    );
  }, [id, qc]);

  const handleAddTag = async (tag: string) => {
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
    // mutateAsync は失敗時に reject するが、onError でトーストを出すので
    // ここでは握り潰して UI を壊さない (unhandled rejection 防止)
    await submitReply(text.trim()).catch((e: unknown) => {
      console.warn('[post/handleSend] submit failed:', e);
    });
  };

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
        <Text style={{ fontSize: 48 }}>📭</Text>
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

  const renderReply = ({ item, index }: { item: Comment; index: number }) => (
    <View style={{ width: '100%', alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: MAX_W, paddingHorizontal: SP['4'], paddingVertical: SP['2'] }}>
        <View style={{
          flexDirection: 'row', gap: SP['3'],
          padding: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1, borderColor: C.border,
        }}>
          <View style={{ alignItems: 'center', gap: 2, width: 36 }}>
            <Avatar size={32} color={item.avatar_color} name={String(index + 1)} />
            <View style={{
              paddingHorizontal: 4, paddingVertical: 1,
              backgroundColor: C.bg3, borderRadius: R.sm,
              minWidth: 24, alignItems: 'center',
            }}>
              <Text style={{ fontSize: 9, color: C.text3, fontWeight: '700' }}>#{index + 1}</Text>
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginBottom: 4 }}>
              <TrustBadge score={item.trust_score} />
              <Text style={[T.caption, { color: C.text3 }]}>{formatRelative(item.created_at)}</Text>
              <View style={{ flex: 1 }} />
              <ObsidianSaveButton
                note={commentToObsidianNote(item, post.content, post.id)}
                size={14}
              />
            </View>
            <Text style={[T.body, { color: C.text, lineHeight: 22 }]}>{item.content}</Text>
          </View>
        </View>
      </View>
    </View>
  );

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
              <TrustBadge score={post.trust_score_at_post} size="md" />
              <Text style={[T.caption, { color: C.text3, flex: 1 }]}>· {formatRelative(post.created_at)}</Text>
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
                🏷️ オレンジ色のタグは他のユーザーが追加したタグです
              </Text>
            )}
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
              {similarPosts.map((p) => (
                <PressableScale
                  key={p.id}
                  onPress={() => router.push(`/post/${p.id}` as never)}
                  haptic="tap"
                  style={{
                    padding: SP['3'],
                    backgroundColor: C.bg3,
                    borderRadius: R.md,
                    borderWidth: 1, borderColor: C.border,
                    gap: 4,
                  }}
                >
                  <Text style={[T.small, { color: C.text, lineHeight: 18 }]} numberOfLines={2}>
                    {p.content}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                    <Text style={[T.caption, { color: C.accent }]}>
                      #{p.tag_names[0] ?? '雑談'}
                    </Text>
                    <Text style={[T.caption, { color: C.text3 }]}>
                      · 💛 {p.likes_count ?? 0}
                    </Text>
                    <Text style={[T.caption, { color: C.text3 }]}>
                      · {formatRelative(p.created_at)}
                    </Text>
                  </View>
                </PressableScale>
              ))}
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
      <FlashList
        data={replies}
        keyExtractor={(item) => item.id}
        renderItem={renderReply}
        estimatedItemSize={72}
        // 入力 focus 中でも 1 タップで戻るボタン/タグ/類似投稿に届くように
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<ListHeader />}
        ListEmptyComponent={
          repliesLoading ? (
            <View style={{ padding: SP['6'], alignItems: 'center' }}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : (
            <View style={{ padding: SP['6'], alignItems: 'center' }}>
              <Text style={[T.small, { color: C.text3 }]}>コメントはまだありません</Text>
            </View>
          )
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.accent} />
        }
      />
      <View style={{ width: '100%', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg2 }}>
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
              placeholder="コメントを入力…"
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
    </KeyboardAvoidingView>
  );
}
