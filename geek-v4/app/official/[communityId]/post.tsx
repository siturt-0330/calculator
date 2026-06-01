// ============================================================
// geek-official — 公式投稿コンポーザー
// ============================================================
// 公式管理者が community_public で投稿する画面。送信時は createPost を
// 呼ぶだけ — server 側で attachOfficialAuthor が自動的に de-anonymize する。
// ============================================================
import { useState } from 'react';
import { View, Text, ScrollView, TextInput, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Spinner } from '../../../components/ui/Spinner';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Icon } from '../../../constants/icons';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { useToastStore } from '../../../stores/toastStore';
import { useAuthStore } from '../../../stores/authStore';
import { fetchCommunity } from '../../../lib/api/communities';
import { createPost } from '../../../lib/api/posts';
import { sanitizeUrl } from '../../../lib/sanitize';

const MAX_BODY = 4000;
const MAX_TAGS = 5;

export default function OfficialPostScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const communityId = typeof params.communityId === 'string' ? params.communityId : '';
  const userId = useAuthStore((s) => s.user?.id);
  const show = useToastStore((s) => s.show);
  const qc = useQueryClient();

  const [body, setBody] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState('');

  const { data: community, isLoading } = useQuery({
    queryKey: ['community', communityId],
    queryFn: () => fetchCommunity(communityId),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });
  const isAdmin = !!community && !!userId && community.official_admin_user_id === userId;

  const addTag = (raw: string) => {
    const clean = raw.replace(/^#+/, '').trim();
    if (!clean) return;
    if (tags.includes(clean)) return;
    if (tags.length >= MAX_TAGS) {
      show(`タグは最大 ${MAX_TAGS} 個まで`, 'warn');
      return;
    }
    setTags([...tags, clean]);
    setTagInput('');
  };

  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const submit = useMutation({
    mutationFn: () => {
      // 手入力 URL を media_urls に直書きすると Storage/EXIF/MIME 検証を迂回し、
      // javascript:/data:/内部ネットワーク等の不正 URL も保存され得る。
      // sanitizeUrl (http/https + SSRF ガード) を通し、不正なら投稿を弾く。
      const trimmedImage = imageUrl.trim();
      const safeImage = trimmedImage ? sanitizeUrl(trimmedImage) : null;
      if (trimmedImage && !safeImage) {
        throw new Error('画像URLが不正です。http/https の画像URLを指定してください。');
      }
      return createPost({
        content: body.trim(),
        mediaUris: safeImage ? [safeImage] : [],
        tagNames: tags,
        isAnonymous: false,
        kind: 'opinion',
        visibility: 'community_public',
        community_ids: [communityId],
      });
    },
    onSuccess: () => {
      show('公式投稿を公開しました', 'success');
      void qc.invalidateQueries({ queryKey: ['community', communityId] });
      void qc.invalidateQueries({ queryKey: ['official-dashboard', communityId, 'posts'] });
      router.back();
    },
    onError: (e: unknown) => {
      show(e instanceof Error ? e.message : '投稿に失敗しました', 'error');
    },
  });

  const canSubmit = body.trim().length >= 1 && body.length <= MAX_BODY && !submit.isPending;

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size="large" />
      </View>
    );
  }
  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + SP['4'], paddingHorizontal: SP['4'] }}>
        <BackButton />
        <EmptyState icon={Icon.lock} title="権限がありません" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>公式投稿を書く</Text>
        <PressableScale
          onPress={() => submit.mutate()}
          disabled={!canSubmit}
          haptic="confirm"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: SP['3'],
            paddingVertical: 7,
            backgroundColor: C.accent,
            borderRadius: R.full,
            opacity: canSubmit ? 1 : 0.5,
            ...SHADOW.accentGlow,
          }}
        >
          {submit.isPending && <ActivityIndicator size="small" color="#fff" />}
          <Icon.send size={14} color="#fff" strokeWidth={2.6} />
          <Text style={[T.smallB, { color: '#fff' }]}>投稿</Text>
        </PressableScale>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['4'],
        }}
      >
        <Animated.View entering={FadeInDown.duration(220)} style={{ gap: SP['4'] }}>
          {/* hint banner */}
          <View
            style={{
              padding: SP['3'],
              backgroundColor: C.accentBg,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.accent + '55',
              flexDirection: 'row',
              gap: SP['2'],
              alignItems: 'flex-start',
            }}
          >
            <Icon.info size={16} color={C.accentLight} strokeWidth={2.4} style={{ marginTop: 2 }} />
            <Text style={[T.small, { color: C.text2, flex: 1 }]}>
              この投稿はコミュニティのフィードに公開され、運営の表示名 + 所属で表示されます。
            </Text>
          </View>

          {/* 本文 */}
          <View style={{ gap: 4 }}>
            <Text style={[T.small, { color: C.text2 }]}>本文</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="公式からのお知らせ・FAQ など"
              placeholderTextColor={C.text3}
              multiline
              maxLength={MAX_BODY}
              style={[
                T.body,
                {
                  color: C.text,
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  paddingHorizontal: SP['3'],
                  paddingVertical: SP['3'],
                  minHeight: Platform.OS === 'web' ? 200 : 160,
                  textAlignVertical: 'top',
                },
              ]}
            />
            <Text style={[T.caption, { color: C.text3, textAlign: 'right' }]}>
              {body.length.toLocaleString('ja-JP')} / {MAX_BODY.toLocaleString('ja-JP')}
            </Text>
          </View>

          {/* 画像 URL (簡易) */}
          <View style={{ gap: 4 }}>
            <Text style={[T.small, { color: C.text2 }]}>画像 URL (任意)</Text>
            <TextInput
              value={imageUrl}
              onChangeText={setImageUrl}
              placeholder="https://..."
              placeholderTextColor={C.text3}
              autoCapitalize="none"
              autoCorrect={false}
              // memory DoS 対策: URL は 2048 文字 cap (browser 標準 URL 上限)
              maxLength={2048}
              style={[
                T.body,
                {
                  color: C.text,
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  paddingHorizontal: SP['3'],
                  paddingVertical: SP['3'],
                },
              ]}
            />
          </View>

          {/* タグ */}
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.small, { color: C.text2 }]}>タグ (最大 {MAX_TAGS} 個)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {tags.map((t) => (
                <PressableScale
                  key={t}
                  onPress={() => removeTag(t)}
                  haptic="tap"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['3'],
                    paddingVertical: 6,
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.accent + '55',
                  }}
                >
                  <Text style={{ fontSize: 12, color: C.accentLight, fontWeight: '700' }}>#{t}</Text>
                  <Icon.close size={10} color={C.accentLight} strokeWidth={2.6} />
                </PressableScale>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: SP['2'] }}>
              <TextInput
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={() => addTag(tagInput)}
                placeholder="タグを入力 (Enter で追加)"
                placeholderTextColor={C.text3}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  T.body,
                  {
                    flex: 1,
                    color: C.text,
                    backgroundColor: C.bg2,
                    borderRadius: R.lg,
                    borderWidth: 1,
                    borderColor: C.border,
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['3'],
                  },
                ]}
                maxLength={30}
              />
              <PressableScale
                onPress={() => addTag(tagInput)}
                haptic="tap"
                disabled={tagInput.trim().length === 0 || tags.length >= MAX_TAGS}
                style={{
                  paddingHorizontal: SP['4'],
                  paddingVertical: SP['3'],
                  borderRadius: R.lg,
                  backgroundColor: C.bg3,
                  borderWidth: 1,
                  borderColor: C.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: tagInput.trim().length === 0 || tags.length >= MAX_TAGS ? 0.5 : 1,
                }}
              >
                <Icon.plus size={16} color={C.text} strokeWidth={2.4} />
              </PressableScale>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}
