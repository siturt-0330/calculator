// ============================================================
// app/post/create-settings.tsx — 投稿作成 Step 2: 設定画面
// ------------------------------------------------------------
// 2 ステップ投稿フローの Step 2。
// Step 1 (app/post/create.tsx) でコンテンツ (本文・タイトル・メディア) を
// usePostDraftStore に保存し、router.push('/post/create-settings') で遷移してくる。
//
// このページでは以下を設定して投稿を完成させる:
//   - タグ (必須 / 最大 5 個 / 自動提案つき)
//   - 公開範囲 (VisibilityCardsInline)
//   - コミュニティ選択 (community_public / community_only 時のみ表示)
//   - コンテンツ警告 (CW)
//   - 出典 URL
//
// 投稿成功後は usePostDraftStore.reset() → router.replace('/(tabs)/feed')。
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Link as LinkIcon, AlertTriangle } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

// composer components
import { ContentSnippet } from '../../components/post/composer/ContentSnippet';
import { VisibilityCardsInline } from '../../components/post/composer/VisibilityCardsInline';
import { SettingsSection } from '../../components/post/composer/SettingsSection';
import { TagFlairRow } from '../../components/post/composer/TagFlairRow';
import { AutoTagSuggestionRow } from '../../components/post/composer/AutoTagSuggestionRow';
import { CommunityPickerSheet } from '../../components/post/composer/CommunityPickerSheet';
import { ContentWarningSheet, type CwCategory } from '../../components/post/composer/ContentWarningSheet';
import { Input } from '../../components/ui/Input';
import { TagInputSuggestions } from '../../components/tag/TagInputSuggestions';
import { PressableScale } from '../../components/ui/PressableScale';

// stores / lib
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { usePostDraftStore } from '../../stores/postDraftStore';
import { useDraftsStore, newDraftId } from '../../stores/draftsStore';
import { hap } from '../../design/haptics';
import { createPost } from '../../lib/api/posts';
import { fetchMyCommunities, type Community } from '../../lib/api/communities';
import { deepNormalize } from '../../lib/search/tokenize';
import { useAutoTagSuggest } from '../../hooks/useAutoTagSuggest';
import { checkContent } from '../../lib/ai/checkContent';
import { uploadPostImage, uploadPostVideo } from '../../lib/media';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';

// ============================================================
// constants
// ============================================================

/** CW カテゴリ → 日本語ラベル (chip 表示用) */
const CW_LABELS: Record<string, string> = {
  spoiler: 'ネタバレ',
  nsfw: 'センシティブ',
  violence: '暴力的',
  sensitive: '注意',
};

// ============================================================
// ExtraChip — 出典 / コンテンツ警告を開く ghost ピル
// (active のときだけ accent tint。それ以外は控えめな bg3/border)
// ============================================================
function ExtraChip({
  IconComp,
  label,
  active,
  onPress,
}: {
  IconComp: LucideIcon;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const C = useColors();
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: SP['2'],
        paddingHorizontal: SP['3'],
        borderRadius: R.full,
        backgroundColor: active ? C.accentBg : C.bg3,
        borderWidth: 1,
        borderColor: active ? C.accent : C.border,
      }}
    >
      <IconComp size={15} color={active ? C.accent : C.text2} strokeWidth={2.2} />
      <Text style={[T.smallM, { color: active ? C.accent : C.text2 }]}>{label}</Text>
    </PressableScale>
  );
}

// ============================================================
// CreateSettings screen
// ============================================================
export default function CreateSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const C = useColors();

  // ----------------------------------------------------------
  // reactive store selectors (UI バインディング用)
  // ----------------------------------------------------------
  const tags = usePostDraftStore((s) => s.tags);
  const setTags = usePostDraftStore((s) => s.setTags);
  const visibility = usePostDraftStore((s) => s.visibility);
  const setVisibility = usePostDraftStore((s) => s.setVisibility);
  const selectedCommunityIds = usePostDraftStore((s) => s.selectedCommunityIds);
  const selectedCommunities = usePostDraftStore((s) => s.selectedCommunities);
  const setSelectedCommunities = usePostDraftStore((s) => s.setSelectedCommunities);
  const cwCategory = usePostDraftStore((s) => s.cwCategory);
  const setCwCategory = usePostDraftStore((s) => s.setCwCategory);
  const cwText = usePostDraftStore((s) => s.cwText);
  const setCwText = usePostDraftStore((s) => s.setCwText);
  const sourceUrl = usePostDraftStore((s) => s.sourceUrl);
  const setSourceUrl = usePostDraftStore((s) => s.setSourceUrl);
  // 自動タグ提案のために本文を読む
  const content = usePostDraftStore((s) => s.content);

  // ----------------------------------------------------------
  // local state
  // ----------------------------------------------------------
  const [posting, setPosting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityQuery, setCommunityQuery] = useState('');
  const [showCommunitySheet, setShowCommunitySheet] = useState(false);
  const [showCwSheet, setShowCwSheet] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [showSourceUrl, setShowSourceUrl] = useState(false);

  // ----------------------------------------------------------
  // effects — 参加コミュニティ読み込み (mount 1 回)
  // ----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setCommunityLoading(true);
    void fetchMyCommunities()
      .then((data) => {
        if (!cancelled) setMyCommunities(data);
      })
      .finally(() => {
        if (!cancelled) setCommunityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ----------------------------------------------------------
  // 自動タグ提案 (本文 debounce 600ms)
  // ----------------------------------------------------------
  const [debouncedContent, setDebouncedContent] = useState(content);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedContent(content), 600);
    return () => clearTimeout(t);
  }, [content]);
  const autoTagSuggestions = useAutoTagSuggest(debouncedContent, tags, 6);

  // ----------------------------------------------------------
  // 下書き自動保存 (Step 2 の設定変更も反映, debounce 600ms)
  // Step 1 で draftId が発番済みなら同 ID を更新。未発番でも本文があれば発番して保存。
  // ----------------------------------------------------------
  useEffect(() => {
    const cur = usePostDraftStore.getState();
    const meaningful = cur.title.trim() || cur.content.trim() || cur.images.length > 0 || !!cur.video;
    if (!meaningful) return;
    const t = setTimeout(() => {
      const s = usePostDraftStore.getState();
      let id = s.draftId;
      if (!id) {
        id = newDraftId('post');
        s.setDraftId(id);
      }
      useDraftsStore.getState().upsert({
        id,
        kind: 'post',
        title: s.title,
        content: s.content,
        images: s.images,
        video: s.video,
        anonymous: s.anonymous,
        tags: s.tags,
        visibility: s.visibility,
        selectedCommunityIds: s.selectedCommunityIds,
        selectedCommunities: s.selectedCommunities,
        cwCategory: s.cwCategory,
        cwText: s.cwText,
        sourceUrl: s.sourceUrl,
        showPoll: s.showPoll,
        pollQuestion: s.pollQuestion,
        pollOptions: s.pollOptions,
        pollMulti: s.pollMulti,
        pollHours: s.pollHours,
      });
    }, 600);
    return () => clearTimeout(t);
  }, [tags, visibility, selectedCommunityIds, cwCategory, cwText, sourceUrl]);

  // ----------------------------------------------------------
  // コミュニティ表示判定 + visibility が非コミュニティになったら選択クリア
  // ----------------------------------------------------------
  const showCommunityPicker = visibility === 'community_only' || visibility === 'community_public';
  useEffect(() => {
    if (!showCommunityPicker) {
      setSelectedCommunities([], []);
      setCommunityQuery('');
    }
  }, [showCommunityPicker, setSelectedCommunities]);

  // ----------------------------------------------------------
  // tag handlers
  // ----------------------------------------------------------
  const addTagDirect = useCallback(
    (raw: string) => {
      const t = raw.trim().replace(/^#/, '');
      if (!t) return;
      const nq = deepNormalize(t);
      if (tags.some((x) => deepNormalize(x) === nq)) return;
      if (tags.length >= 5) {
        show('タグは最大 5 個までです', 'warn');
        return;
      }
      setTags([...tags, t]);
      hap.select();
    },
    [tags, setTags, show],
  );

  const handleAddTag = useCallback(() => {
    addTagDirect(tagInput);
    setTagInput('');
  }, [addTagDirect, tagInput]);

  const removeTag = useCallback(
    (t: string) => {
      setTags(tags.filter((x) => x !== t));
      hap.select();
    },
    [tags, setTags],
  );

  // ----------------------------------------------------------
  // community handler — id でトグル + visibility 自動昇格 / 復帰
  // ----------------------------------------------------------
  const toggleCommunityById = useCallback(
    (id: string) => {
      if (selectedCommunityIds.includes(id)) {
        const nextIds = selectedCommunityIds.filter((x) => x !== id);
        setSelectedCommunities(
          nextIds,
          selectedCommunities.filter((x) => x.id !== id),
        );
        hap.select();
        // 最後の 1 件を外したらホーム公開に戻す
        if (nextIds.length === 0 && showCommunityPicker) {
          setVisibility('public');
        }
      } else {
        const community = myCommunities.find((c) => c.id === id);
        if (!community) return;
        setSelectedCommunities(
          [...selectedCommunityIds, id],
          [...selectedCommunities, community],
        );
        hap.confirm();
        // 非コミュニティ公開のときはコミュ＋公開へ自動昇格
        if (!showCommunityPicker) {
          setVisibility('community_public');
        }
      }
    },
    [
      selectedCommunityIds,
      selectedCommunities,
      setSelectedCommunities,
      setVisibility,
      myCommunities,
      showCommunityPicker,
    ],
  );

  // ----------------------------------------------------------
  // 投稿ボタンの活性判定
  // ----------------------------------------------------------
  const canPost = !posting && tags.length > 0;

  // ----------------------------------------------------------
  // submit
  // ----------------------------------------------------------
  const onPost = async () => {
    if (posting) return;

    // store から最新 state を読む (reactive selector は render 時点の snapshot)
    const s = usePostDraftStore.getState();

    // バリデーション
    if (!s.content.trim() && s.images.length === 0 && !s.video) {
      show('画像・動画・テキストのいずれかを入力してください。', 'warn');
      return;
    }
    if (s.tags.length === 0) {
      show('タグを1つ以上追加してください。', 'warn');
      return;
    }
    if (s.sourceUrl && !/^https?:\/\//.test(s.sourceUrl.trim())) {
      show('出典URLは http:// または https:// で始めてください。', 'warn');
      return;
    }
    if (
      (s.visibility === 'community_only' || s.visibility === 'community_public') &&
      s.selectedCommunityIds.length < 1
    ) {
      show('コミュニティを1つ以上選んでください', 'warn');
      return;
    }

    setPosting(true);
    try {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) {
        show('ログインし直してください', 'error');
        return;
      }

      // AI コンテンツチェック (本文+タグ) とメディアアップロードは互いに独立なので
      // 並列実行する。直列だと「AI チェックの往復」を待ってからアップロードが
      // 始まり、送信ボタン押下後の待ちが長く感じる。チェックが NG のときは
      // アップロード結果を破棄して createPost には進めない (ごく稀に orphan な
      // メディアが Storage に残るが、ポリシー違反は元々レアなので許容)。
      setUploadStatus(s.images.length > 0 || s.video ? 'アップロード中…' : '確認中…');

      let uploadedImageUrls: string[] = [];
      let uploadedVideoUrls: string[] = [];
      try {
        // ★ 先に AI コンテンツチェックを await し、NG ならアップロードしない (#37)。
        //   旧実装は checkContent と upload を Promise.all で並列実行していたため、
        //   NG 時にアップロード済みメディアが Storage に orphan として残っていた。
        //   体感速度よりデータ整合性を優先する。
        const check = await checkContent({ content: s.content, tags: s.tags });
        if (!check.ok) {
          hap.error();
          Alert.alert('投稿できません', check.reason ?? 'コンテンツポリシーに反する可能性があります');
          return;
        }
        [uploadedImageUrls, uploadedVideoUrls] = await Promise.all([
          s.images.length > 0
            ? Promise.all(s.images.map((uri) => uploadPostImage(uri, userId)))
            : Promise.resolve<string[]>([]),
          s.video
            ? uploadPostVideo(s.video.uri, userId, {
                mime: s.video.mime,
                ext: s.video.ext,
              }).then((url) => [url])
            : Promise.resolve<string[]>([]),
        ]);
      } catch (e) {
        show(e instanceof Error ? e.message : String(e), 'error');
        return;
      }

      setUploadStatus('投稿を作成中…');

      // 投票ペイロード
      const validOptions = s.pollOptions.filter((o) => o.trim());
      const pollPayload =
        s.showPoll && s.pollQuestion.trim() && validOptions.length >= 2
          ? {
              question: s.pollQuestion,
              options: validOptions,
              multiSelect: s.pollMulti,
              expiresInHours: s.pollHours ?? undefined,
            }
          : undefined;

      await createPost({
        content: s.content,
        title: s.title.trim() || null,
        mediaUris: uploadedImageUrls,
        videoUris: uploadedVideoUrls,
        videoDurations: [],
        videoPosters: [],
        tagNames: s.tags,
        isAnonymous: true,  // 常に匿名 (匿名トグル廃止 — 匿名SNSの一貫性 #3)。公開投稿がフィードから消える問題も解消。
        sourceUrl: s.sourceUrl.trim() || null,
        isPublic: s.visibility !== 'private',
        contentWarning: s.cwCategory !== 'none' ? (s.cwText.trim() || null) : null,
        cwCategory: s.cwCategory !== 'none' ? s.cwCategory : null,
        poll: pollPayload,
        visibility: s.visibility,
        community_ids:
          s.visibility === 'community_only' || s.visibility === 'community_public'
            ? s.selectedCommunityIds
            : [],
      });

      hap.success();
      show('投稿しました', 'success');
      // 投稿成功 → この下書きを削除 (draftId は reset() で null に戻る)
      {
        const did = usePostDraftStore.getState().draftId;
        if (did) useDraftsStore.getState().remove(did);
      }

      // キャッシュ invalidate
      void qc.invalidateQueries({ queryKey: ['my-community-feed'] });
      void qc.invalidateQueries({ queryKey: ['my-communities'] });
      for (const cid of s.selectedCommunityIds) {
        void qc.invalidateQueries({ queryKey: ['community', cid, 'feed'] });
        void qc.invalidateQueries({ queryKey: ['community', cid] });
      }
      void qc.invalidateQueries({ queryKey: ['feed'] });

      usePostDraftStore.getState().reset();
      router.replace('/(tabs)/feed' as never);
    } catch (e: unknown) {
      hap.error();
      const msg =
        e instanceof Error
          ? e.message
          : e !== null && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : String(e);
      console.warn('post create-settings submit failed:', msg);

      let userMsg = '投稿に失敗しました。再度お試しください。';
      if (msg.includes('row-level security') || msg.includes('RLS')) {
        userMsg = '権限エラー。ログインし直してください。';
      } else if (msg.includes('Not authenticated') || msg.includes('未ログイン')) {
        userMsg = 'ログインし直してください。';
      } else if (msg.includes('Network') || msg.includes('Failed to fetch')) {
        userMsg = '通信エラー。電波を確認してください。';
      } else if (msg.includes('速すぎ') || msg.includes('時間を置いて') || msg.includes('ペースが')) {
        userMsg = msg;
      }
      show(userMsg, 'error');
    } finally {
      setPosting(false);
      setUploadStatus(null);
    }
  };

  // ----------------------------------------------------------
  // render
  // ----------------------------------------------------------
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>

      {/* ================================================================
          ヘッダー: [← 戻る] | [投稿設定 (中央)] | [投稿ボタン (右)]
          ================================================================ */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingBottom: SP['2'],
          paddingHorizontal: SP['4'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        {/* ← 戻る */}
        <PressableScale
          onPress={() => router.back()}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel="戻る"
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <ChevronLeft size={24} color={C.text} strokeWidth={2.2} />
        </PressableScale>

        {/* タイトル — 絶対配置で画面中央 */}
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: insets.top + SP['2'],
            bottom: SP['2'],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[T.bodyB, { color: C.text }]}>投稿設定</Text>
        </View>

        {/* 右端スペーサー → 投稿ボタンを右端に押し込む */}
        <View style={{ flex: 1 }} />

        {/* 投稿ボタン */}
        <PressableScale
          onPress={onPost}
          haptic="confirm"
          disabled={!canPost}
          accessibilityRole="button"
          accessibilityLabel="投稿する"
          style={{
            paddingVertical: SP['2'],
            paddingHorizontal: SP['4'],
            borderRadius: R.full,
            backgroundColor: canPost ? C.accent : C.bg4,
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 56,
            height: 36,
          }}
        >
          {posting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[T.smallB, { color: canPost ? '#fff' : C.text3 }]}>投稿</Text>
          )}
        </PressableScale>
      </View>

      {/* ================================================================
          本体
          ================================================================ */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: SP['10'] }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >

          {/* ============================================================
              コンテンツプレビュー (Step 1 の内容をスニペット表示)
              ============================================================ */}
          <View
            style={{
              paddingHorizontal: SP['4'],
              paddingTop: SP['4'],
              paddingBottom: SP['3'],
            }}
          >
            <ContentSnippet />
          </View>

          {/* ============================================================
              タグセクション (必須)
              ============================================================ */}
          <SettingsSection
            title="タグ"
            required
            hint="1〜5個 追加してください"
          >
            <View style={{ gap: SP['3'] }}>
              {/* タグ flair 行 */}
              <TagFlairRow
                tags={tags}
                onRemove={removeTag}
                onPressAdd={() => setShowTagInput(true)}
                max={5}
              />

              {/* 自動タグ提案 */}
              <AutoTagSuggestionRow
                suggestions={autoTagSuggestions}
                onAdd={addTagDirect}
                visible={autoTagSuggestions.length > 0}
              />

              {/* タグ入力フィールド (インライン展開) */}
              {showTagInput && (
                <View style={{ gap: SP['2'] }}>
                  <View style={{ flexDirection: 'row', gap: SP['2'], alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Input
                        placeholder="タグを入力 (例: ポケモン)"
                        value={tagInput}
                        onChangeText={setTagInput}
                        onSubmitEditing={handleAddTag}
                        returnKeyType="done"
                        maxLength={24}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                      />
                    </View>
                    <PressableScale
                      onPress={handleAddTag}
                      haptic="select"
                      accessibilityRole="button"
                      accessibilityLabel="タグを追加"
                      style={{
                        paddingVertical: SP['3'],
                        paddingHorizontal: SP['4'],
                        borderRadius: R.lg,
                        backgroundColor: C.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={[T.smallB, { color: '#fff' }]}>追加</Text>
                    </PressableScale>
                  </View>
                  <TagInputSuggestions
                    input={tagInput}
                    excludeTags={tags}
                    onPick={(t) => {
                      addTagDirect(t);
                      setTagInput('');
                    }}
                  />
                </View>
              )}
            </View>
          </SettingsSection>

          {/* ============================================================
              公開範囲セクション
              ============================================================ */}
          <SettingsSection title="公開範囲">
            <VisibilityCardsInline value={visibility} onChange={setVisibility} />
          </SettingsSection>

          {/* ============================================================
              コミュニティセクション (community_public / community_only 時のみ)
              ============================================================ */}
          {showCommunityPicker && (
            <SettingsSection title="コミュニティ" required>
              <View style={{ gap: SP['3'] }}>
                {/* 選択済みコミュニティの chips */}
                {selectedCommunities.length > 0 && (
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}
                  >
                    {selectedCommunities.map((community) => (
                      <PressableScale
                        key={community.id}
                        onPress={() => toggleCommunityById(community.id)}
                        haptic="select"
                        accessibilityRole="button"
                        accessibilityLabel={`${community.name} を外す`}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: SP['1'],
                          paddingVertical: SP['1'],
                          paddingLeft: SP['3'],
                          paddingRight: SP['2'],
                          borderRadius: R.full,
                          backgroundColor: C.accentBg,
                          borderWidth: 1,
                          borderColor: C.accentSoft,
                        }}
                      >
                        <Text style={[T.smallM, { color: C.accent }]} numberOfLines={1}>
                          {community.icon_emoji} {community.name}
                        </Text>
                        <View
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 9,
                            backgroundColor: C.accentSoft,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: C.accent, fontSize: 11 }}>✕</Text>
                        </View>
                      </PressableScale>
                    ))}
                  </View>
                )}

                {/* コミュニティ選択ボタン */}
                {communityLoading ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                    <ActivityIndicator size="small" color={C.accent} />
                    <Text style={[T.small, { color: C.text3 }]}>読み込み中…</Text>
                  </View>
                ) : (
                  <PressableScale
                    onPress={() => setShowCommunitySheet(true)}
                    haptic="tap"
                    accessibilityRole="button"
                    accessibilityLabel="コミュニティを選択"
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: SP['2'],
                      paddingVertical: SP['3'],
                      borderRadius: R.lg,
                      borderWidth: 1.5,
                      borderStyle: 'dashed',
                      borderColor: selectedCommunityIds.length === 0 ? C.accent : C.border2,
                      backgroundColor: selectedCommunityIds.length === 0 ? C.accentBg : 'transparent',
                    }}
                  >
                    <Text
                      style={[
                        T.smallM,
                        { color: selectedCommunityIds.length === 0 ? C.accent : C.text2 },
                      ]}
                    >
                      {selectedCommunityIds.length === 0
                        ? '＋ コミュニティを選択'
                        : '＋ 追加する'}
                    </Text>
                  </PressableScale>
                )}
              </View>
            </SettingsSection>
          )}

          {/* ============================================================
              追加設定セクション (出典 / コンテンツ警告)
              ============================================================ */}
          <SettingsSection title="追加設定">
            <View style={{ gap: SP['3'] }}>
              {/* ghost pill 群 */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                <ExtraChip
                  IconComp={LinkIcon}
                  label={sourceUrl.trim() ? '出典あり' : '出典リンク'}
                  active={showSourceUrl || sourceUrl.trim().length > 0}
                  onPress={() => setShowSourceUrl((v) => !v)}
                />
                <ExtraChip
                  IconComp={AlertTriangle}
                  label={
                    cwCategory !== 'none'
                      ? `警告: ${CW_LABELS[cwCategory] ?? cwCategory}`
                      : 'コンテンツ警告'
                  }
                  active={cwCategory !== 'none'}
                  onPress={() => setShowCwSheet(true)}
                />
              </View>

              {/* 出典 URL 入力フィールド */}
              {showSourceUrl && (
                <Input
                  label="出典リンク (任意)"
                  placeholder="https://..."
                  value={sourceUrl}
                  onChangeText={setSourceUrl}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  icon={LinkIcon}
                />
              )}
            </View>
          </SettingsSection>

          {/* ============================================================
              アップロード進捗バナー
              ============================================================ */}
          {uploadStatus && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                marginHorizontal: SP['4'],
                marginTop: SP['3'],
                paddingVertical: SP['2'],
                paddingHorizontal: SP['3'],
                borderRadius: R.lg,
                backgroundColor: C.accentBg,
                borderWidth: 1,
                borderColor: C.accentSoft,
              }}
            >
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={[T.small, { color: C.accent }]}>{uploadStatus}</Text>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* ================================================================
          Bottom sheets
          ================================================================ */}
      <CommunityPickerSheet
        visible={showCommunitySheet}
        onClose={() => setShowCommunitySheet(false)}
        communities={myCommunities}
        selectedIds={selectedCommunityIds}
        onToggle={toggleCommunityById}
        loading={communityLoading}
        query={communityQuery}
        onQueryChange={setCommunityQuery}
      />
      <ContentWarningSheet
        visible={showCwSheet}
        onClose={() => setShowCwSheet(false)}
        category={cwCategory === 'none' ? null : (cwCategory as CwCategory)}
        onCategoryChange={(c) => setCwCategory(c ?? 'none')}
        text={cwText}
        onTextChange={setCwText}
      />
    </View>
  );
}
