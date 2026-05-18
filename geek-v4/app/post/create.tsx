import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAutoTagSuggest } from '@/hooks/useAutoTagSuggest';
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
  // CW (content warning)
  type CWCat = 'none' | 'spoiler' | 'nsfw' | 'violence' | 'sensitive';
  const [cwCategory, setCwCategory] = useState<CWCat>('none');
  const [cwText, setCwText] = useState('');
  // Poll
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMulti, setPollMulti] = useState(false);
  const [pollHours, setPollHours] = useState<number | null>(24);

  // 内容から自動タグ提案 (debounce 600ms)
  const [debouncedContent, setDebouncedContent] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedContent(content), 600);
    return () => clearTimeout(t);
  }, [content]);
  const autoTagSuggestions = useAutoTagSuggest(debouncedContent, tags, 6);

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
      const validOptions = pollOptions.filter((o) => o.trim());
      const pollPayload = (showPoll && pollQuestion.trim() && validOptions.length >= 2)
        ? {
            question: pollQuestion,
            options: validOptions,
            multiSelect: pollMulti,
            expiresInHours: pollHours ?? undefined,
          }
        : undefined;
      await createPost({
        content,
        mediaUris: images,
        tagNames: tags,
        isAnonymous: anonymous,
        kind,
        sourceUrl: sourceUrl.trim() || null,
        isPublic,
        contentWarning: cwCategory !== 'none' ? (cwText.trim() || null) : null,
        cwCategory: cwCategory !== 'none' ? cwCategory : null,
        poll: pollPayload,
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

            {/* AI 自動タグ提案 (本文から推測) */}
            {autoTagSuggestions.length > 0 && tags.length < 5 && (
              <View style={{
                padding: SP['2'],
                backgroundColor: 'rgba(124,177,255,0.10)',
                borderRadius: R.md,
                borderWidth: 1, borderColor: 'rgba(124,177,255,0.35)',
                gap: SP['1'],
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 13 }}>🤖</Text>
                  <Text style={[T.caption, { color: '#7CB1FF', fontWeight: '700', flex: 1 }]}>
                    本文から提案 ({autoTagSuggestions.length})
                  </Text>
                  <Text style={[T.caption, { color: C.text3, fontSize: 9 }]}>
                    タップで追加
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {autoTagSuggestions.map((s) => (
                    <PressableScale
                      key={s.tag}
                      onPress={() => {
                        if (tags.includes(s.tag) || tags.length >= 5) return;
                        setTags([...tags, s.tag]);
                        hap.confirm();
                      }}
                      haptic="confirm"
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 3,
                        paddingHorizontal: SP['2'], paddingVertical: 4,
                        backgroundColor: 'rgba(124,177,255,0.15)',
                        borderRadius: R.full,
                        borderWidth: 1, borderColor: 'rgba(124,177,255,0.4)',
                      }}
                    >
                      <Text style={{ fontSize: 11, color: '#7CB1FF', fontWeight: '700' }}>
                        ＋ {s.tag}
                      </Text>
                      <Text style={{ fontSize: 8, color: C.text3 }}>{s.reason}</Text>
                    </PressableScale>
                  ))}
                </View>
              </View>
            )}

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

          {/* コンテンツ警告 (CW) */}
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallM, { color: C.text2 }]}>⚠️ コンテンツ警告 (任意)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {([
                { v: 'none', label: 'なし', emoji: '🟢' },
                { v: 'spoiler', label: 'ネタバレ', emoji: '🤐' },
                { v: 'nsfw', label: 'センシティブ', emoji: '🔞' },
                { v: 'violence', label: '暴力的', emoji: '⚠️' },
                { v: 'sensitive', label: '注意', emoji: '🛡️' },
              ] as { v: CWCat; label: string; emoji: string }[]).map((opt) => {
                const active = cwCategory === opt.v;
                return (
                  <PressableScale
                    key={opt.v}
                    onPress={() => setCwCategory(opt.v)}
                    haptic="select"
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                      borderRadius: R.full,
                      backgroundColor: active ? C.amberBg : C.bg3,
                      borderWidth: 1.5,
                      borderColor: active ? C.amber : C.border,
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>{opt.emoji}</Text>
                    <Text style={[T.smallM, { color: active ? C.amber : C.text2 }]}>{opt.label}</Text>
                  </PressableScale>
                );
              })}
            </View>
            {cwCategory !== 'none' && (
              <Input
                placeholder="警告の詳細 (任意) 例: 鬼滅 無限城編のネタバレを含みます"
                value={cwText}
                onChangeText={setCwText}
                maxLength={120}
              />
            )}
          </View>

          {/* 投票 */}
          <View style={{ gap: SP['2'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={[T.smallM, { color: C.text2 }]}>📊 投票を追加 (任意)</Text>
              <View style={{ flex: 1 }} />
              <PressableScale
                onPress={() => setShowPoll((v) => !v)}
                haptic="tap"
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: 4,
                  borderRadius: R.full,
                  backgroundColor: showPoll ? C.accent : C.bg3,
                  borderWidth: 1,
                  borderColor: showPoll ? C.accent : C.border,
                }}
              >
                <Text style={[T.caption, { color: showPoll ? '#fff' : C.text }]}>
                  {showPoll ? '✓ 投票あり' : '+ 投票を追加'}
                </Text>
              </PressableScale>
            </View>
            {showPoll && (
              <View style={{
                padding: SP['3'],
                backgroundColor: C.bg3,
                borderRadius: R.md,
                borderWidth: 1, borderColor: C.border,
                gap: SP['2'],
              }}>
                <Input
                  placeholder="質問 (例: 鬼滅で一番強い柱は？)"
                  value={pollQuestion}
                  onChangeText={setPollQuestion}
                  maxLength={200}
                />
                {pollOptions.map((opt, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                    <Text style={[T.caption, { color: C.text3, width: 18 }]}>{i + 1}.</Text>
                    <View style={{ flex: 1 }}>
                      <Input
                        placeholder={`選択肢 ${i + 1}`}
                        value={opt}
                        onChangeText={(v) => setPollOptions(pollOptions.map((o, j) => j === i ? v : o))}
                        maxLength={80}
                      />
                    </View>
                    {pollOptions.length > 2 && (
                      <PressableScale
                        onPress={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                        haptic="warn"
                        style={{ padding: 4 }}
                      >
                        <X size={14} color={C.text3} strokeWidth={2.4} />
                      </PressableScale>
                    )}
                  </View>
                ))}
                {pollOptions.length < 6 && (
                  <PressableScale
                    onPress={() => setPollOptions([...pollOptions, ''])}
                    haptic="tap"
                    style={{
                      alignSelf: 'flex-start',
                      paddingHorizontal: SP['3'], paddingVertical: 4,
                      borderRadius: R.full,
                      backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border,
                    }}
                  >
                    <Text style={[T.caption, { color: C.text2 }]}>+ 選択肢を追加</Text>
                  </PressableScale>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginTop: SP['1'] }}>
                  <PressableScale
                    onPress={() => setPollMulti((v) => !v)}
                    haptic="select"
                    style={{
                      paddingHorizontal: SP['2'], paddingVertical: 4,
                      borderRadius: R.full,
                      backgroundColor: pollMulti ? C.accent : C.bg2,
                      borderWidth: 1,
                      borderColor: pollMulti ? C.accent : C.border,
                    }}
                  >
                    <Text style={[T.caption, { color: pollMulti ? '#fff' : C.text2 }]}>
                      {pollMulti ? '✓ 複数選択可' : '単一選択'}
                    </Text>
                  </PressableScale>
                  <View style={{ flex: 1 }} />
                  <Text style={[T.caption, { color: C.text3 }]}>期間:</Text>
                  {[6, 24, 72, 168].map((h) => (
                    <PressableScale
                      key={h}
                      onPress={() => setPollHours(h)}
                      haptic="select"
                      style={{
                        paddingHorizontal: SP['2'], paddingVertical: 4,
                        borderRadius: R.full,
                        backgroundColor: pollHours === h ? C.accent : C.bg2,
                        borderWidth: 1,
                        borderColor: pollHours === h ? C.accent : C.border,
                      }}
                    >
                      <Text style={[T.caption, { color: pollHours === h ? '#fff' : C.text2 }]}>
                        {h < 24 ? `${h}h` : `${h / 24}d`}
                      </Text>
                    </PressableScale>
                  ))}
                </View>
              </View>
            )}
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
