import { View, Text, ScrollView, RefreshControl, KeyboardAvoidingView, Platform, Image, Pressable, ActivityIndicator } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
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
  uploadCommunityIcon,
  type CommunityWithMembership,
  type CommunityPostWithCommunity,
} from '@/lib/api/communities';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';
import { sanitizeContent, sanitizeUrl } from '@/lib/sanitize';
import { ObsidianSaveButton } from '@/components/ui/ObsidianSaveButton';
import { communityPostToObsidianNote, communityToObsidianNote } from '@/hooks/useObsidian';

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

import { prepareImageUpload } from '@/lib/image';

// Avatar component — image_url 優先、なければ emoji フォールバック
function CommunityAvatar({
  icon_url,
  icon_emoji,
  icon_color,
  size,
}: {
  icon_url: string | null;
  icon_emoji: string;
  icon_color: string;
  size: number;
}) {
  // icon_url を sanitize — http/https 以外を弾く
  const safeIconUrl = icon_url ? sanitizeUrl(icon_url) : null;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: safeIconUrl ? C.bg3 : icon_color,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {safeIconUrl ? (
        <Image source={{ uri: safeIconUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <Text style={{ fontSize: size * 0.55 }}>{icon_emoji}</Text>
      )}
    </View>
  );
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
  const [iconUploading, setIconUploading] = useState(false);

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

  const onChangeIcon = async () => {
    if (!community || iconUploading) return;
    setIconUploading(true);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          show('写真へのアクセス権限が必要です', 'warn');
          setIconUploading(false);
          return;
        }
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (r.canceled || !r.assets[0]) {
        setIconUploading(false);
        return;
      }
      const asset = r.assets[0];
      let prepared;
      try {
        prepared = await prepareImageUpload(asset.uri, {
          maxSizeBytes: 5 * 1024 * 1024,
          maxWidth: 512,
          maxHeight: 512,
          quality: 0.85,
        });
      } catch (e) {
        show(e instanceof Error ? e.message : '画像処理に失敗しました', 'warn');
        setIconUploading(false);
        return;
      }
      const { url, error: upErr } = await uploadCommunityIcon(
        community.id,
        prepared.blob,
        prepared.mime,
      );
      if (upErr || !url) {
        show('アップロードに失敗しました', 'error');
        setIconUploading(false);
        return;
      }
      // Optimistic + DB
      setCommunity({ ...community, icon_url: url });
      const { error: updErr } = await updateCommunity(community.id, { icon_url: url });
      if (updErr) {
        show('保存に失敗しました: ' + updErr, 'error');
        void load();
      } else {
        show('アイコンを変更しました', 'success');
      }
    } catch (e) {
      console.warn('[community/detail] icon change failed:', e);
      show('画像の取得に失敗しました', 'error');
    } finally {
      setIconUploading(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={C.accent} />
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
        {/* Header bar */}
        <View
          style={{
            paddingTop: insets.top + SP['2'],
            paddingHorizontal: SP['4'],
            paddingBottom: SP['2'],
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['2'],
          }}
        >
          <BackButton />
          <View style={{ flex: 1 }} />
          {community.visibility === 'request' && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['2'],
                paddingVertical: 2,
                backgroundColor: C.amberBg,
                borderRadius: R.full,
              }}
            >
              <Icon.lock size={12} color={C.amber} strokeWidth={2.4} />
              <Text style={[T.caption, { color: C.amber, fontWeight: '600' }]}>許可制</Text>
            </View>
          )}
          {community.visibility === 'invite' && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['2'],
                paddingVertical: 2,
                backgroundColor: C.redBg,
                borderRadius: R.full,
              }}
            >
              <Icon.shield size={12} color={C.red} strokeWidth={2.4} />
              <Text style={[T.caption, { color: C.red, fontWeight: '600' }]}>招待制</Text>
            </View>
          )}
        </View>

        {/* アイコン + 名前 */}
        <View style={{ alignItems: 'center', gap: SP['3'], paddingHorizontal: SP['4'], paddingVertical: SP['2'] }}>
          <Pressable
            onPress={canEditIcon ? onChangeIcon : undefined}
            disabled={!canEditIcon || iconUploading}
            style={{ position: 'relative' }}
            hitSlop={8}
          >
            <CommunityAvatar
              icon_url={community.icon_url}
              icon_emoji={community.icon_emoji}
              icon_color={community.icon_color}
              size={104}
            />
            {canEditIcon && (
              <View
                style={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  backgroundColor: C.accent,
                  borderRadius: 16,
                  padding: 6,
                  borderWidth: 3,
                  borderColor: C.bg,
                }}
              >
                {iconUploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon.image size={14} color="#fff" strokeWidth={2.4} />
                )}
              </View>
            )}
          </Pressable>
          <Text style={[T.h2, { color: C.text, textAlign: 'center' }]} numberOfLines={2}>
            {community.name}
          </Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            メンバー {community.member_count.toLocaleString('ja-JP')} 人 · 投稿 {community.post_count.toLocaleString('ja-JP')} 件
          </Text>
          {canEditIcon && (
            <Text style={[T.caption, { color: C.text3, marginTop: -4 }]}>
              アイコンをタップして変更
            </Text>
          )}
          {/* コミュニティ自体を Obsidian に保存 (説明 / タグなどメタ情報) */}
          <ObsidianSaveButton
            note={communityToObsidianNote(community)}
            size={18}
            style={{ marginTop: SP['1'] }}
          />
        </View>

        {/* 説明 */}
        {community.description.length > 0 && (
          <View
            style={{
              marginHorizontal: SP['4'],
              marginTop: SP['3'],
              padding: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Text style={[T.body, { color: C.text2 }]}>
              {sanitizeContent(community.description, { maxLength: 500 })}
            </Text>
          </View>
        )}

        {/* タグ */}
        {community.tags.length > 0 && (
          <View
            style={{
              marginHorizontal: SP['4'],
              marginTop: SP['3'],
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: SP['1'],
            }}
          >
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
        <View style={{ paddingHorizontal: SP['4'], marginTop: SP['4'] }}>
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
        <View style={{ height: 8, backgroundColor: C.bg2, marginTop: SP['4'] }} />

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
              style={{ minHeight: 64, textAlignVertical: 'top' }}
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
                  <Text style={[T.small, { color: C.text2, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
                    {p.author_nickname ?? '匿名'}
                  </Text>
                  <Text style={[T.caption, { color: C.text3 }]}>{timeAgo(p.created_at)}</Text>
                  <ObsidianSaveButton note={communityPostToObsidianNote(p)} size={16} />
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
