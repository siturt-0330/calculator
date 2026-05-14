import { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from '@/constants/icons';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { TagPill } from '@/components/tag/TagPill';
import { Input } from '@/components/ui/Input';
import { PressableScale } from '@/components/ui/PressableScale';
import { KeyboardAware } from '@/components/ui/KeyboardAware';
import { BackButton } from '@/components/nav/BackButton';
import { TopBar } from '@/components/nav/TopBar';
import { TrustBar } from '@/components/ui/TrustBar';
import { useToastStore } from '@/stores/toastStore';
import { hap } from '@/design/haptics';
import { createPost } from '@/lib/api/posts';
import { checkContent } from '@/lib/ai/checkContent';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';

export default function CreatePost() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { show } = useToastStore();

  const [images, setImages] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [posting, setPosting] = useState(false);

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
      show('タグを 1 つ以上追加してください。', 'warn');
      return;
    }

    setPosting(true);
    try {
      const check = await checkContent({ content, tags });
      if (!check.ok) {
        hap.error();
        Alert.alert(
          '投稿できません',
          check.reason ?? 'コンテンツポリシーに反する可能性があります',
        );
        return;
      }
      await createPost({ content, mediaUris: images, tagNames: tags, isAnonymous: anonymous });
      hap.success();
      show('投稿しました。', 'success');
      router.back();
    } catch {
      hap.error();
      show('投稿に失敗しました。', 'error');
    } finally {
      setPosting(false);
    }
  };

  const X = Icon.close;
  const Sparkles = Icon.sparkles;
  const Cam = Icon.image;
  const Hash = Icon.hash;

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
        >
          {/* 信頼スコア */}
          <TrustBar score={50} />

          {/* 画像 */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {images.map((uri) => (
              <View key={uri} style={{ position: 'relative' }}>
                <ProgressiveImage uri={uri} width={80} height={80} radius={12} />
                <PressableScale
                  onPress={() => setImages(images.filter((u) => u !== uri))}
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: C.bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: C.border,
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
                  width: 80,
                  height: 80,
                  borderRadius: 12,
                  backgroundColor: C.bg3,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Cam size={22} color={C.text3} strokeWidth={2.2} />
              </PressableScale>
            )}
          </View>

          {/* キャプション */}
          <TextArea
            placeholder="このタグについて、語ろう"
            value={content}
            onChangeText={setContent}
            maxLength={2000}
          />

          {/* AI 提案ボタン */}
          <Button
            label="AI でキャプションを提案"
            onPress={() => show('Supabase Edge Function の設定が必要です。', 'info')}
            variant="ghost"
            icon={Sparkles}
            disabled={images.length === 0}
          />

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
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {tags.map((t) => (
                <TagPill key={t} name={t} state="liked" onPress={() => removeTag(t)} />
              ))}
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
