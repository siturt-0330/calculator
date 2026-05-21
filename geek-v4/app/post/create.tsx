import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAutoTagSuggest } from '../../hooks/useAutoTagSuggest';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from '../../constants/icons';
import { ProgressiveImage } from '../../components/ui/ProgressiveImage';
import { TextArea } from '../../components/ui/TextArea';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { TagPill } from '../../components/tag/TagPill';
import { TagInputSuggestions } from '../../components/tag/TagInputSuggestions';
import { Input } from '../../components/ui/Input';
import { PressableScale } from '../../components/ui/PressableScale';
import { KeyboardAware } from '../../components/ui/KeyboardAware';
import { BackButton } from '../../components/nav/BackButton';
import { TopBar } from '../../components/nav/TopBar';
import { useToastStore } from '../../stores/toastStore';
import { hap } from '../../design/haptics';
import { createPost, type PostVisibility } from '../../lib/api/posts';
import { fetchCommunity, fetchMyCommunities, type Community } from '../../lib/api/communities';
import { deepNormalize } from '../../lib/search/tokenize';
import { useDebounce } from '../../hooks/useDebounce';
import { checkContent } from '../../lib/ai/checkContent';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { POST_KIND_META } from '../../components/feed/PostKindBadge';
import type { PostKind } from '../../types/models';

type VisibilityOption = {
  value: PostVisibility;
  emoji: string;
  label: string;
  desc: string;
};

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  { value: 'private',          emoji: '🔒', label: '自分だけ',                              desc: '下書きとしてあなただけ見える' },
  { value: 'public',           emoji: '🌐', label: '一般公開',                              desc: 'コミュニティには載せず、ホームに公開' },
  { value: 'community_only',   emoji: '👥', label: '指定コミュニティのメンバーだけ',        desc: '選んだコミュニティ内の人だけ閲覧可' },
  { value: 'community_public', emoji: '📣', label: '全員に公開 (コミュニティにも掲載)',     desc: 'ホームにも、コミュニティにも掲載' },
];

export default function CreatePost() {
  const router = useRouter();
  const params = useLocalSearchParams<{ community_id?: string; prefill_tag?: string }>();
  const insets = useSafeAreaInsets();
  const { show } = useToastStore();

  const [images, setImages] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [kind, setKind] = useState<PostKind>('opinion');
  const [sourceUrl, setSourceUrl] = useState('');
  const [posting, setPosting] = useState(false);

  // 4-way visibility selector (default 'public' — same as 既存 isPublic=true)
  const [visibility, setVisibility] = useState<PostVisibility>('public');

  // Community multi-picker (only used when visibility is community_only / community_public)
  const [communityQuery, setCommunityQuery] = useState('');
  const debouncedCommunityQuery = useDebounce(communityQuery, 150);
  const [communityResults, setCommunityResults] = useState<Community[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [selectedCommunityIds, setSelectedCommunityIds] = useState<string[]>([]);
  const [selectedCommunities, setSelectedCommunities] = useState<Community[]>([]);

  const showCommunityPicker = visibility === 'community_only' || visibility === 'community_public';

  // visibility が community 系でなくなったら選択をクリア
  useEffect(() => {
    if (!showCommunityPicker) {
      setSelectedCommunityIds([]);
      setSelectedCommunities([]);
      setCommunityQuery('');
      setCommunityResults([]);
    }
  }, [showCommunityPicker]);

  // コミュニティ選択 — 投稿先は「自分が参加しているコミュニティ」のみに限定
  // (③ community_only / ④ community_public いずれもメンバー外には投稿できない方針)
  // picker が開いた時に my communities を一括取得 → debounce 検索は client 側で
  // deepNormalize 含めて filter (server roundtrip 1 回で済む + hiragana/katakana 揺れ吸収)
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  useEffect(() => {
    if (!showCommunityPicker) return;
    let cancelled = false;
    setCommunityLoading(true);
    void fetchMyCommunities()
      .then((data) => {
        if (cancelled) return;
        setMyCommunities(data);
      })
      .finally(() => {
        if (!cancelled) setCommunityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showCommunityPicker]);

  // 検索クエリで filter (deepNormalize で揺れ吸収)
  useEffect(() => {
    const q = deepNormalize(debouncedCommunityQuery.trim());
    if (!q) {
      setCommunityResults(myCommunities);
      return;
    }
    const filtered = myCommunities.filter((c) => {
      const hay = deepNormalize(`${c.name} ${c.description ?? ''}`);
      return hay.includes(q);
    });
    setCommunityResults(filtered);
  }, [debouncedCommunityQuery, myCommunities]);

  // ?community_id=X 付きで遷移してきた場合は、対応するコミュニティを自動選択し
  // visibility を 'community_public' に切り替える (community 詳細の「投稿」タブ等から).
  // mount-once だけ走らせる — 後から手動で外せるよう pre-fill 後は触らない.
  useEffect(() => {
    const cid = typeof params.community_id === 'string' ? params.community_id : undefined;
    const preTag = typeof params.prefill_tag === 'string' ? params.prefill_tag.trim() : '';
    if (preTag) {
      // 重複は addTag 側のロジックで防がれるが、mount-once の段階で素直に追加.
      setTags((prev) => (prev.includes(preTag) ? prev : [...prev, preTag].slice(0, 5)));
    }
    if (!cid) return;
    let cancelled = false;
    (async () => {
      try {
        const community = await fetchCommunity(cid);
        if (cancelled || !community) return;
        setVisibility('community_public');
        setSelectedCommunityIds([community.id]);
        setSelectedCommunities([community]);
      } catch (e) {
        console.warn('[post/create] failed to load community from deep link:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          kind?: PostKind; anonymous?: boolean; visibility?: PostVisibility;
        };
        const hasContent = (d.content && d.content.trim().length > 0) || (d.tags && d.tags.length > 0) || (d.sourceUrl && d.sourceUrl.length > 0);
        if (!hasContent) return;
        setContent(d.content ?? '');
        setTags(d.tags ?? []);
        setSourceUrl(d.sourceUrl ?? '');
        setKind((d.kind ?? 'opinion') as PostKind);
        setAnonymous(d.anonymous ?? true);
        setVisibility((d.visibility ?? 'public') as PostVisibility);
        show('下書きを復元しました', 'info', { undoLabel: '破棄', onUndo: () => {
          setContent(''); setTags([]); setSourceUrl('');
          setKind('opinion'); setAnonymous(true); setVisibility('public');
          void AsyncStorage.removeItem(DRAFT_KEY);
        }});
      } catch {
        // ignore — 壊れた draft は無視
      }
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
        content, tags, sourceUrl, kind, anonymous, visibility,
      }));
    }, 500);
    return () => clearTimeout(t);
  }, [content, tags, sourceUrl, kind, anonymous, visibility]);

  const pickImage = async () => {
    try {
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
    } catch (e) {
      console.warn('[post/create] pick image failed:', e);
      show('画像の取得に失敗しました', 'error');
    }
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t) return;
    // deepNormalize 同一視で重複を防ぐ ("ポケモン" vs "ぽけもん" など)
    const nq = deepNormalize(t);
    if (tags.some((x) => deepNormalize(x) === nq)) {
      setTagInput('');
      return;
    }
    if (tags.length >= 5) {
      show('タグは最大 5 個までです', 'warn');
      return;
    }
    setTags([...tags, t]);
    setTagInput('');
    hap.select();
  };

  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t));
    hap.select();
  };

  const toggleCommunity = (c: Community) => {
    if (selectedCommunityIds.includes(c.id)) {
      setSelectedCommunityIds(selectedCommunityIds.filter((id) => id !== c.id));
      setSelectedCommunities(selectedCommunities.filter((x) => x.id !== c.id));
      hap.select();
    } else {
      setSelectedCommunityIds([...selectedCommunityIds, c.id]);
      setSelectedCommunities([...selectedCommunities, c]);
      hap.confirm();
    }
  };

  const removeSelectedCommunity = (id: string) => {
    setSelectedCommunityIds(selectedCommunityIds.filter((x) => x !== id));
    setSelectedCommunities(selectedCommunities.filter((x) => x.id !== id));
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
    if (
      (visibility === 'community_only' || visibility === 'community_public') &&
      selectedCommunityIds.length < 1
    ) {
      show('コミュニティを1つ以上選んでください', 'warn');
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
      // visibility → isPublic 互換マッピング:
      //   private             → isPublic: false (本人だけ)
      //   public / community_* → isPublic: true (既存挙動)
      const isPublic = visibility !== 'private';
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
        visibility,
        community_ids: (visibility === 'community_only' || visibility === 'community_public')
          ? selectedCommunityIds
          : [],
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
  const CommunityIcon = Icon.community;

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
              disabled={posting || tags.length === 0 || !content.trim()}
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

          {/* 本文 — 文字数カウンタ付き */}
          <View style={{ gap: SP['1'] }}>
            <TextArea
              placeholder="このタグについて、語ろう"
              value={content}
              onChangeText={setContent}
              maxLength={2000}
              autoFocus
            />
            {content.length > 0 && (
              <Text style={[T.caption, { color: content.length >= 1900 ? C.amber : C.text3, alignSelf: 'flex-end' }]}>
                {content.length} / 2000
              </Text>
            )}
          </View>

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

            {/* mobile では「+ 追加」ボタンが無いと「return key を押せばいい」 が分からない
                ので、Input 横に常時可視の追加ボタンを置く */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <View style={{ flex: 1 }}>
                <Input
                  placeholder="タグを追加（例: ポケモン）"
                  value={tagInput}
                  onChangeText={setTagInput}
                  onSubmitEditing={addTag}
                  returnKeyType="done"
                  icon={Hash}
                />
              </View>
              <PressableScale
                onPress={addTag}
                haptic="select"
                disabled={!tagInput.trim() || tags.length >= 5}
                style={{
                  paddingHorizontal: SP['4'],
                  paddingVertical: SP['3'],
                  borderRadius: R.lg,
                  backgroundColor: tagInput.trim() && tags.length < 5 ? C.accent : C.bg3,
                  borderWidth: 1,
                  borderColor: tagInput.trim() && tags.length < 5 ? C.accent : C.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Text style={{
                  color: tagInput.trim() && tags.length < 5 ? '#fff' : C.text3,
                  fontWeight: '700',
                  fontSize: 14,
                }}>
                  + 追加
                </Text>
              </PressableScale>
            </View>
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

          {/* 公開範囲 — 4-way audience selector */}
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallM, { color: C.text2 }]}>公開範囲</Text>
            <View style={{ gap: SP['2'] }}>
              {VISIBILITY_OPTIONS.map((opt) => {
                const active = visibility === opt.value;
                return (
                  <PressableScale
                    key={opt.value}
                    onPress={() => setVisibility(opt.value)}
                    haptic="select"
                    scaleValue={0.985}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SP['3'],
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['3'],
                      borderRadius: R.lg,
                      backgroundColor: active ? C.accent + '15' : C.bg2,
                      borderWidth: 1.5,
                      borderColor: active ? C.accent : C.border,
                    }}
                  >
                    <Text style={{ fontSize: 26, width: 32, textAlign: 'center' }}>{opt.emoji}</Text>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[T.bodyB, { color: active ? C.accentLight : C.text }]} numberOfLines={1}>
                        {opt.label}
                      </Text>
                      <Text style={[T.caption, { color: C.text3 }]} numberOfLines={2}>
                        {opt.desc}
                      </Text>
                    </View>
                    {active && (
                      <View style={{
                        width: 22, height: 22, borderRadius: 11,
                        backgroundColor: C.accent,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon.ok size={14} color="#fff" strokeWidth={2.8} />
                      </View>
                    )}
                  </PressableScale>
                );
              })}
            </View>
          </View>

          {/* コミュニティを選ぶ (multi-picker) — visibility が community 系のときだけ */}
          {showCommunityPicker && (
            <View style={{ gap: SP['2'] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                <CommunityIcon size={14} color={C.text2} strokeWidth={2.2} />
                <Text style={[T.smallM, { color: C.text2, flex: 1 }]}>
                  コミュニティを選ぶ (複数選択可)
                </Text>
                {selectedCommunityIds.length > 0 && (
                  <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>
                    {selectedCommunityIds.length} 件選択中
                  </Text>
                )}
              </View>

              {/* 選択済みコミュニティ pills */}
              {selectedCommunities.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                  {selectedCommunities.map((c) => (
                    <PressableScale
                      key={c.id}
                      onPress={() => removeSelectedCommunity(c.id)}
                      haptic="warn"
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: SP['3'],
                        paddingVertical: 6,
                        borderRadius: R.full,
                        backgroundColor: C.accent + '20',
                        borderWidth: 1,
                        borderColor: C.accent,
                      }}
                    >
                      <View
                        style={{
                          width: 18, height: 18, borderRadius: 9,
                          backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                          alignItems: 'center', justifyContent: 'center',
                          overflow: 'hidden',
                        }}
                      >
                        {c.icon_url ? (
                          <Image source={{ uri: c.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                        ) : (
                          <Text style={{ fontSize: 11 }}>{c.icon_emoji}</Text>
                        )}
                      </View>
                      <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <X size={12} color={C.accentLight} strokeWidth={2.6} />
                    </PressableScale>
                  ))}
                </View>
              )}

              {/* 検索 input */}
              <Input
                placeholder="参加中のコミュニティを検索"
                value={communityQuery}
                onChangeText={setCommunityQuery}
                icon={Icon.search}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {/* 検索結果 */}
              <View style={{
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                overflow: 'hidden',
              }}>
                {communityLoading && communityResults.length === 0 ? (
                  <View style={{ padding: SP['4'], alignItems: 'center' }}>
                    <Text style={[T.caption, { color: C.text3 }]}>検索中…</Text>
                  </View>
                ) : communityResults.length === 0 ? (
                  <View style={{ padding: SP['4'], alignItems: 'center', gap: 6 }}>
                    {myCommunities.length === 0 ? (
                      <>
                        <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
                          まだコミュニティに参加していません
                        </Text>
                        <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
                          参加してから、そのコミュニティに投稿できます
                        </Text>
                      </>
                    ) : (
                      <Text style={[T.caption, { color: C.text3 }]}>
                        「{communityQuery.trim()}」 と一致する参加中コミュニティがありません
                      </Text>
                    )}
                  </View>
                ) : (
                  communityResults.map((c, idx) => {
                    const isSelected = selectedCommunityIds.includes(c.id);
                    return (
                      <PressableScale
                        key={c.id}
                        onPress={() => toggleCommunity(c)}
                        haptic="tap"
                        scaleValue={0.99}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: SP['3'],
                          paddingHorizontal: SP['3'],
                          paddingVertical: SP['3'],
                          backgroundColor: isSelected ? C.accent + '15' : 'transparent',
                          borderTopWidth: idx === 0 ? 0 : 1,
                          borderTopColor: C.divider,
                        }}
                      >
                        <View
                          style={{
                            width: 36, height: 36, borderRadius: 18,
                            backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                            alignItems: 'center', justifyContent: 'center',
                            overflow: 'hidden',
                          }}
                        >
                          {c.icon_url ? (
                            <Image source={{ uri: c.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                          ) : (
                            <Text style={{ fontSize: 18 }}>{c.icon_emoji}</Text>
                          )}
                        </View>
                        <View style={{ flex: 1, gap: 1 }}>
                          <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                            {c.name}
                          </Text>
                          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                            メンバー {c.member_count.toLocaleString('ja-JP')} 人
                          </Text>
                        </View>
                        <View
                          style={{
                            width: 22, height: 22, borderRadius: 11,
                            borderWidth: isSelected ? 0 : 1.5,
                            borderColor: C.border2,
                            backgroundColor: isSelected ? C.accent : 'transparent',
                            alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {isSelected && <Icon.ok size={14} color="#fff" strokeWidth={2.8} />}
                        </View>
                      </PressableScale>
                    );
                  })
                )}
              </View>
            </View>
          )}

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
