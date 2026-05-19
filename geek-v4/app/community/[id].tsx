import { View, Text, ScrollView, RefreshControl, KeyboardAvoidingView, Platform, Image, Pressable } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { BackButton } from '@/components/nav/BackButton';
import { Icon } from '@/constants/icons';
import {
  fetchCommunity,
  fetchCommunityPosts,
  joinCommunity,
  requestJoinCommunity,
  leaveCommunity,
  createCommunityPost,
  updateCommunity,
  type CommunityWithMembership,
  type CommunityPostWithCommunity,
} from '@/lib/api/communities';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';

const EMOJI_OPTIONS = [
  '👥', '🎮', '📚', '🎵', '🎨', '⚽', '🍙', '☕',
  '🌸', '🎬', '📷', '🎤', '💼', '🧑‍💻', '🏃', '🎯',
];
const COLOR_OPTIONS = ['#7C6AF7', '#22D3A4', '#F5A623', '#F472B6', '#3B82F6', '#E24B4A', '#9F96F9', '#cca87a'];

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 時間前`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 日前`;
  return new Date(iso).toLocaleDateString('ja-JP');
}

export default function CommunityDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const { user } = useAuthStore();
  const { show } = useToastStore();

  const [community, setCommunity] = useState<CommunityWithMembership | null>(null);
  const [posts, setPosts] = useState<CommunityPostWithCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [postBody, setPostBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [editingIcon, setEditingIcon] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [c, p] = await Promise.all([fetchCommunity(id), fetchCommunityPosts(id, 40)]);
    setCommunity(c);
    setPosts(p);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onJoin = async () => {
    if (!community || joining) return;
    setJoining(true);
    if (community.visibility === 'request') {
      const { error } = await requestJoinCommunity(community.id);
      setJoining(false);
      if (error) {
        show(error, 'error');
        return;
      }
      show('参加申請を送信しました。承認をお待ちください。', 'success');
    } else {
      const { error } = await joinCommunity(community.id);
      setJoining(false);
      if (error) {
        show(error, 'error');
        return;
      }
      show('参加しました！', 'success');
      void load();
    }
  };

  const onLeave = async () => {
    if (!community) return;
    setJoining(true);
    const { error } = await leaveCommunity(community.id);
    setJoining(false);
    if (error) {
      show(error, 'error');
      return;
    }
    show('退出しました', 'success');
    void load();
  };

  const onSubmitPost = async () => {
    if (!community || posting) return;
    const body = postBody.trim();
    if (body.length === 0) return;
    if (body.length > 2000) {
      show('2000 文字以内にしてください', 'warn');
      return;
    }
    setPosting(true);
    const { error } = await createCommunityPost({ community_id: community.id, body });
    setPosting(false);
    if (error) {
      show(error, 'error');
      return;
    }
    setPostBody('');
    void load();
  };

  const onChangeIcon = async (emoji: string, color: string) => {
    if (!community) return;
    setEditingIcon(false);
    // Optimistic update
    setCommunity({ ...community, icon_emoji: emoji, icon_color: color });
    const { error } = await updateCommunity(community.id, { icon_emoji: emoji, icon_color: color });
    if (error) {
      show('アイコン変更に失敗: ' + error, 'error');
      void load();
    } else {
      show('アイコンを変更しました', 'success');
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={[T.body, { color: C.text3 }]}>読み込み中…</Text>
      </View>
    );
  }

  if (!community) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          paddingTop: insets.top + SP['4'],
          paddingHorizontal: SP['4'],
          gap: SP['4'],
        }}
      >
        <BackButton />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: SP['3'] }}>
          <Icon.fail size={48} color={C.text3} strokeWidth={1.6} />
          <Text style={[T.h3, { color: C.text }]}>コミュニティが見つかりません</Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            削除されたか、招待制で閲覧権限がない可能性があります。
          </Text>
        </View>
      </View>
    );
  }

  const canPost = community.is_member;
  const canEditIcon = community.is_member;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['20'],
        }}
        refreshControl={
          <RefreshControl tintColor={C.text2} refreshing={refreshing} onRefresh={onRefresh} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View
          style={{
            paddingTop: insets.top + SP['2'],
            paddingHorizontal: SP['4'],
            paddingBottom: SP['4'],
            gap: SP['4'],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <BackButton />
            <View style={{ flex: 1 }} />
            {community.visibility === 'request' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon.lock size={14} color={C.amber} strokeWidth={2.4} />
                <Text style={[T.caption, { color: C.amber }]}>許可制</Text>
              </View>
            )}
            {community.visibility === 'invite' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon.shield size={14} color={C.red} strokeWidth={2.4} />
                <Text style={[T.caption, { color: C.red }]}>招待制</Text>
              </View>
            )}
          </View>

          {/* アイコン + 名前 */}
          <View style={{ alignItems: 'center', gap: SP['2'] }}>
            <Pressable
              onPress={canEditIcon ? () => setEditingIcon((v) => !v) : undefined}
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: community.icon_color,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 52 }}>{community.icon_emoji}</Text>
              {canEditIcon && (
                <View
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    backgroundColor: C.bg3,
                    borderRadius: 14,
                    padding: 4,
                    borderWidth: 2,
                    borderColor: C.bg,
                  }}
                >
                  <Icon.edit size={14} color={C.text} strokeWidth={2.4} />
                </View>
              )}
            </Pressable>
            <Text style={[T.h2, { color: C.text }]} numberOfLines={2}>
              {community.name}
            </Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              メンバー {community.member_count} 人 · 投稿 {community.post_count} 件
            </Text>
          </View>

          {/* アイコン編集パネル */}
          {editingIcon && canEditIcon && (
            <View
              style={{
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                gap: SP['3'],
              }}
            >
              <Text style={[T.smallM, { color: C.text2 }]}>新しいアイコン</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                {EMOJI_OPTIONS.map((e) => (
                  <PressableScale
                    key={e}
                    onPress={() => onChangeIcon(e, community.icon_color)}
                    haptic="tap"
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: community.icon_emoji === e ? community.icon_color + '33' : C.bg3,
                    }}
                  >
                    <Text style={{ fontSize: 22 }}>{e}</Text>
                  </PressableScale>
                ))}
              </View>
              <Text style={[T.smallM, { color: C.text2 }]}>背景色</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                {COLOR_OPTIONS.map((c) => (
                  <PressableScale
                    key={c}
                    onPress={() => onChangeIcon(community.icon_emoji, c)}
                    haptic="tap"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: c,
                      borderWidth: 2,
                      borderColor: community.icon_color === c ? C.text : 'transparent',
                    }}
                  />
                ))}
              </View>
              <Text style={[T.caption, { color: C.text3 }]}>
                メンバーなら誰でも変更できます。
              </Text>
            </View>
          )}

          {/* 説明 */}
          {community.description.length > 0 && (
            <View
              style={{
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={[T.body, { color: C.text2 }]}>{community.description}</Text>
            </View>
          )}

          {/* タグ */}
          {community.tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['1'] }}>
              {community.tags.map((t) => (
                <View
                  key={t}
                  style={{
                    paddingHorizontal: SP['2'],
                    paddingVertical: 4,
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                  }}
                >
                  <Text style={[T.caption, { color: C.accent }]}>#{t}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Join / Leave */}
          {community.is_member ? (
            <Button label="退出する" variant="ghost" onPress={onLeave} loading={joining} />
          ) : community.visibility === 'request' ? (
            <Button
              label="参加を申請する"
              onPress={onJoin}
              loading={joining}
              variant="secondary"
            />
          ) : (
            <Button label="参加する" onPress={onJoin} loading={joining} haptic="confirm" />
          )}
        </View>

        {/* 区切り */}
        <View style={{ height: 8, backgroundColor: C.bg2 }} />

        {/* 投稿入力 (member のみ) */}
        {canPost && (
          <View style={{ padding: SP['4'], gap: SP['2'], borderBottomWidth: 8, borderBottomColor: C.bg2 }}>
            <Text style={[T.smallM, { color: C.text2 }]}>投稿する</Text>
            <Input
              value={postBody}
              onChangeText={setPostBody}
              placeholder="このコミュニティで共有したいことを書こう…"
              multiline
              numberOfLines={3}
              maxLength={2000}
              keyboardAppearance="dark"
              selectionColor={C.accent}
              style={{ minHeight: 80, paddingTop: 12, textAlignVertical: 'top' }}
            />
            <View style={{ alignSelf: 'flex-end' }}>
              <Button
                label="投稿"
                onPress={onSubmitPost}
                loading={posting}
                disabled={posting || postBody.trim().length === 0}
                size="sm"
              />
            </View>
          </View>
        )}

        {/* 投稿一覧 */}
        <View style={{ padding: SP['4'], gap: SP['3'] }}>
          {posts.length === 0 ? (
            <View style={{ alignItems: 'center', padding: SP['10'], gap: SP['2'] }}>
              <Icon.comment size={40} color={C.text3} strokeWidth={1.6} />
              <Text style={[T.body, { color: C.text2 }]}>まだ投稿がありません</Text>
              {canPost && (
                <Text style={[T.caption, { color: C.text3 }]}>最初の投稿をしてみよう。</Text>
              )}
            </View>
          ) : (
            posts.map((p) => (
              <View
                key={p.id}
                style={{
                  padding: SP['3'],
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  gap: SP['2'],
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: C.bg3,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon.mypage size={14} color={C.text3} strokeWidth={2} />
                  </View>
                  <Text style={[T.small, { color: C.text2, fontWeight: '600', flex: 1 }]}>
                    {p.author_nickname ?? '匿名'}
                  </Text>
                  <Text style={[T.caption, { color: C.text3 }]}>{timeAgo(p.created_at)}</Text>
                </View>
                <Text style={[T.body, { color: C.text }]}>{p.body}</Text>
                {p.image_url && (
                  <Image
                    source={{ uri: p.image_url }}
                    style={{
                      width: '100%',
                      aspectRatio: 16 / 9,
                      borderRadius: R.md,
                      backgroundColor: C.bg3,
                    }}
                    resizeMode="cover"
                  />
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
