import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from '@/constants/icons';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { TagPill } from '@/components/tag/TagPill';
import { TagInputSuggestions } from '@/components/tag/TagInputSuggestions';
import { Input } from '@/components/ui/Input';
import { PressableScale } from '@/components/ui/PressableScale';
import { KeyboardAware } from '@/components/ui/KeyboardAware';
import { BackButton } from '@/components/nav/BackButton';
import { TopBar } from '@/components/nav/TopBar';
import { useToastStore } from '@/stores/toastStore';
import { hap } from '@/design/haptics';
import { createPost } from '@/lib/api/posts';
import { checkContent } from '@/lib/ai/checkContent';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { POST_KIND_META } from '@/components/feed/PostKindBadge';
import type { PostKind } from '@/types/models';

export default function CreatePost() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { show } = useToastStore();

  const [images, setImages] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [kind, setKind] = useState<PostKind>('opinion');
  const [sourceUrl, setSourceUrl] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [posting, setPosting] = useState(false);

  // 下書き自動保存
  const DRAFT_KEY = 'geek:post_draft_v1';
  const draftRestored = useRef(false);
  useEffect(() => {
    if (draftRestored.current) return;
    draftRestored.current = true;
    void AsyncStorage.getItem(DRAFT_KEY).then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw) as {
          content?: string; tags?: string[]; sourceUrl?: string;
          kind?: PostKind; anonymous?: boolean; isPublic?: boolean;
        };
        const hasContent = (d.content && d.content.trim().length > 0) || (d.tags && d.tags.length > 0) || (d.sourceUrl && d.sourceUrl.length > 0);
        if (!hasContent) return;
        setContent(d.content ?? '');
        setTags(d.tags ?? []);
        setSourceUrl(d.sourceUrl ?? '');
        setKind((d.kind ?? 'opinion') as PostKind);
        setAnonymous(d.anonymous ?? true);
        setIsPublic(d.isPublic ?? true);
        show('下書きを復元しました', 'info', { undoLabel: '破棄', onUndo: () => {
          setContent(''); setTags([]); setSourceUrl('');
          setKind('opinion'); setAnonymous(true); setIsPublic(true);
          void AsyncStorage.removeItem(DRAFT_KEY);
        }});
      } catch {}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 変更があるたびに draft を保存 (debounce 500ms)
  useEffect(() => {
    const t = setTimeout(() => {
      const hasContent = content.trim() || tags.length > 0 || sourceUrl.trim();
      if (!hasContent) {
        void AsyncStorage.removeItem(DRAFT_KEY);
        return;
      }
      void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({
        content, tags, sourceUrl, kind, anonymous, isPublic,
      }));
    }, 500);
    return () => clearTimeout(t);
  }, [content, tags, sourceUrl, kind, anonymous, isPublic]);

  const pickImage = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: 4,
    });
    if (!r.canceled) {
      setImages(r.assets.map((a) => a.uri).slice(0, 4));
      hap.tap();
    }
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t || tags.includes(t) || tags.length >= 5) return;
    setTags([...tags, t]);
    setTagInput('');
    hap.select();
  };

  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t));
    hap.select();
  };

  const onPost = async () => {
    if (images.length === 0 && !content.trim()) {
      show('画像かテキストを入力してください。', 'warn');
      return;
    }
    if (tags.length === 0) {
      show('タグを1つ以上追加してください。', 'warn');
      return;
    }
    if (kind === 'fact' && !sourceUrl.trim()) {
      show('「事実」として投稿するには出典URLが必要です。', 'warn');
      return;
    }
    if (sourceUrl && !/^https?:\/\//.test(sourceUrl.trim())) {
      show('出典URLは http:// または https:// で始めてください。', 'warn');
      return;
    }

    setPosting(true);
    try {
      const check = await checkContent({ content, tags });
      if (!check.ok) {
        hap.error();
        Alert.alert('投稿できません', check.reason ?? 'コンテンツポリシーに反する可能性があります');
        return;
      }
      await createPost({
        content,
        mediaUris: images,
        tagNames: tags,
        isAnonymous: anonymous,
        kind,
        sourceUrl: sourceUrl.trim() || null,
        isPublic,
      });
      hap.success();
      show('投稿しました', 'success');
      // 成功 → draft 削除
      void AsyncStorage.removeItem(DRAFT_KEY);
      router.back();
    } catch (e: unknown) {
      hap.error();
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('post create failed:', msg);
      // よくあるエラーを日本語化
      let userMsg = '投稿に失敗しました。再度お試しください。';
      if (msg.includes('row-level security') || msg.includes('RLS')) {
        userMsg = '権限エラー。ログインし直してください。';
      } else if (msg.includes('Network') || msg.includes('Failed to fetch')) {
        userMsg = '通信エラー。電波を確認してください。';
      } else if (msg.includes('check') || msg.includes('constraint')) {
        userMsg = '入力内容を確認してください。';
      }
      show(userMsg, 'error');
    } finally {
      setPosting(false);
    }
  };

  const X = Icon.close;
  const Cam = Icon.image;
  const Hash = Icon.hash;
  const Lock = Icon.lock;

  return (
    <KeyboardAware>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar
          title="投稿"
          left={<BackButton />}
          right={
            <Button
              label="投稿"
              onPress={onPost}
              loading={posting}
              disabled={posting || tags.length === 0}
              size="sm"
              fullWidth={false}
            />
          }
        />

        <ScrollView
          contentContainerStyle={{
            padding: SP['4'],
            gap: SP['4'],
            paddingBottom: insets.bottom + SP['10'],
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* 投稿カテゴリ */}
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallM, { color: C.text2 }]}>この投稿は…</Text>
            <View style={{ flexDirection: 'row', gap: SP['2'], flexWrap: 'wrap' }}>
              {(Object.keys(POST_KIND_META) as PostKind[]).map((k) => {
                const m = POST_KIND_META[k];
                const active = kind === k;
                return (
                  <PressableScale
                    key={k}
                    onPress={() => setKind(k)}
                    haptic="select"
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['2'],
                      borderRadius: R.full,
                      backgroundColor: active ? m.bg : C.bg3,
                      borderWidth: 1.5,
                      borderColor: active ? m.fg : C.border,
                    }}
                  >
                    <Text style={{ fontSize: 14 }}>{m.emoji}</Text>
                    <Text style={[T.smallM, { color: active ? m.fg : C.text2 }]}>{m.label}</Text>
                  </PressableScale>
                );
              })}
            </View>
            {kind === 'fact' && (
              <Text style={[T.caption, { color: C.text3 }]}>
                ⚠ 「事実」を選んだ場合は出典URLが必須です
              </Text>
            )}
            {kind === 'wip' && (
              <Text style={[T.caption, { color: C.green }]}>
                💡 未完成の作品は拡散リミット推奨。安心して試せます
              </Text>
            )}
          </View>

          {/* 画像 */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {images.map((uri) => (
              <View key={uri} style={{ position: 'relative' }}>
                <ProgressiveImage uri={uri} width={80} height={80} radius={12} />
                <PressableScale
                  onPress={() => setImages(images.filter((u) => u !== uri))}
                  style={{
                    position: 'absolute',
                    top: -6, right: -6,
                    width: 24, height: 24, borderRadius: 12,
                    backgroundColor: C.bg,
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: C.border,
                  }}
                >
                  <X size={14} color={C.text} strokeWidth={2.4} />
                </PressableScale>
              </View>
            ))}
            {images.length < 4 && (
              <PressableScale
                onPress={pickImage}
                style={{
                  width: 80, height: 80, borderRadius: 12,
                  backgroundColor: C.bg3,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: C.border,
                }}
              >
                <Cam size={22} color={C.text3} strokeWidth={2.2} />
              </PressableScale>
            )}
          </View>

          {/* 本文 */}
          <TextArea
            placeholder="このタグについて、語ろう"
            value={content}
            onChangeText={setContent}
            maxLength={2000}
          />

          {/* 出典URL */}
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallM, { color: C.text2 }]}>
              出典URL {kind === 'fact' ? '（必須）' : '（任意・あると信頼度UP）'}
            </Text>
            <Input
              placeholder="https://..."
              value={sourceUrl}
              onChangeText={setSourceUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          {/* タグ */}
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallM, { color: C.text2 }]}>タグ（必須・最大 5 個）</Text>
            <Input
              placeholder="タグを追加（例: ポケモン）"
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={addTag}
              returnKeyType="done"
              icon={Hash}
            />
            {/* 入力中のリアルタイム類似タグ提案 */}
            {tags.length < 5 && (
              <TagInputSuggestions
                input={tagInput}
                excludeTags={tags}
                onPick={(t) => {
                  if (tags.includes(t) || tags.length >= 5) return;
                  setTags([...tags, t]);
                  setTagInput('');
                  hap.select();
                }}
                variant="liked"
                limit={8}
              />
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {tags.map((t) => (
                <TagPill key={t} name={t} state="liked" onPress={() => removeTag(t)} />
              ))}
            </View>
          </View>

          {/* 公開範囲 */}
          <View style={{ gap: SP['2'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Lock size={14} color={C.text2} strokeWidth={2.2} />
              <Text style={[T.smallM, { color: C.text2 }]}>公開範囲</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: SP['2'] }}>
              <PressableScale
                onPress={() => setIsPublic(true)}
                haptic="select"
                style={{
                  flex: 1,
                  paddingHorizontal: SP['3'], paddingVertical: SP['3'],
                  borderRadius: R.md,
                  backgroundColor: isPublic ? C.accentBg : C.bg3,
                  borderWidth: 1.5,
                  borderColor: isPublic ? C.accent : C.border,
                  alignItems: 'center', gap: 2,
                }}
              >
                <Text style={[T.smallM, { color: isPublic ? C.accentLight : C.text }]}>
                  🌐 誰でも閲覧可能
                </Text>
                <Text style={[T.caption, { color: C.text3 }]}>フィードに表示される</Text>
              </PressableScale>
              <PressableScale
                onPress={() => setIsPublic(false)}
                haptic="select"
                style={{
                  flex: 1,
                  paddingHorizontal: SP['3'], paddingVertical: SP['3'],
                  borderRadius: R.md,
                  backgroundColor: !isPublic ? C.accentBg : C.bg3,
                  borderWidth: 1.5,
                  borderColor: !isPublic ? C.accent : C.border,
                  alignItems: 'center', gap: 2,
                }}
              >
                <Text style={[T.smallM, { color: !isPublic ? C.accentLight : C.text }]}>
                  🔒 自分だけ
                </Text>
                <Text style={[T.caption, { color: C.text3 }]}>下書き・メモ用</Text>
              </PressableScale>
            </View>
          </View>

          {/* 匿名トグル */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['3'],
              padding: SP['4'],
              borderRadius: 14,
              backgroundColor: C.bg3,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[T.bodyB, { color: C.text }]}>匿名で投稿</Text>
              <Text style={[T.small, { color: C.text3 }]}>
                誰が投稿したか他のユーザーには分かりません
              </Text>
            </View>
            <Toggle value={anonymous} onChange={setAnonymous} />
          </View>
        </ScrollView>
      </View>
    </KeyboardAware>
  );
}
