// ============================================================
// app/post/create.tsx — 投稿作成 Step 1: コンテンツ入力
// ------------------------------------------------------------
// 2-Step 投稿作成フローの Step 1。
// ここではコンテンツ (タイトル / 本文 / 画像・動画 / 匿名設定 / 投票) のみ扱う。
// タグ / 公開範囲 / コミュニティ / CW / 出典 URL は Step 2 (/post/create-settings) で設定。
//
// ヘッダー右の「次へ」ボタンで /post/create-settings に push する。
// 状態は usePostDraftStore (Zustand) を経由して Step 2 と共有する。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { X as IconX, EyeOff, Eye } from 'lucide-react-native';

import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { ComposerTitleField } from '../../components/post/composer/ComposerTitleField';
import { ComposerBodyField } from '../../components/post/composer/ComposerBodyField';
import { ComposerMediaGrid } from '../../components/post/composer/ComposerMediaGrid';
import { ComposerBottomBar } from '../../components/post/composer/ComposerBottomBar';
import { FormatToolbar, type FormatKind } from '../../components/post/composer/FormatToolbar';
import { PollEditorSheet } from '../../components/post/composer/PollEditorSheet';

import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { usePostDraftStore } from '../../stores/postDraftStore';
import { useDraftsStore, newDraftId } from '../../stores/draftsStore';
import { hap } from '../../design/haptics';
import { fetchCommunity } from '../../lib/api/communities';
import { validateVideoSource } from '../../lib/media';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';

// ============================================================
// 定数
// ============================================================

// 本文プレースホルダ候補 (mount ごとにランダム — discussion framing)
const PLACEHOLDER_POOL: string[] = [
  '何について話したい?',
  'みんなの意見を聞きたいことは?',
  '議論したいトピックを書いてみよう',
  '気になっていることをシェアしよう',
  'みんなで話そう',
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

// ============================================================
// CreatePost — Step 1
// ============================================================

export default function CreatePost() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    community_id?: string;
    prefill_tag?: string;
    draftId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const show = useToastStore((s) => s.show);
  const C = useColors();

  const user = useAuthStore((s) => s.user);
  const displayName = user?.nickname?.trim() || 'あなた';

  // -----------------------------------------------------------
  // store selectors — 個別 selector で購読 (destructure 禁止)
  // -----------------------------------------------------------
  const title = usePostDraftStore((s) => s.title);
  const setTitle = usePostDraftStore((s) => s.setTitle);
  const content = usePostDraftStore((s) => s.content);
  const setContent = usePostDraftStore((s) => s.setContent);
  const images = usePostDraftStore((s) => s.images);
  const setImages = usePostDraftStore((s) => s.setImages);
  const video = usePostDraftStore((s) => s.video);
  const setVideo = usePostDraftStore((s) => s.setVideo);
  const anonymous = usePostDraftStore((s) => s.anonymous);
  const setAnonymous = usePostDraftStore((s) => s.setAnonymous);
  const showPoll = usePostDraftStore((s) => s.showPoll);
  const pollQuestion = usePostDraftStore((s) => s.pollQuestion);
  const pollOptions = usePostDraftStore((s) => s.pollOptions);
  const pollMulti = usePostDraftStore((s) => s.pollMulti);
  const pollHours = usePostDraftStore((s) => s.pollHours);
  const setPoll = usePostDraftStore((s) => s.setPoll);

  // -----------------------------------------------------------
  // local state
  // -----------------------------------------------------------
  const [pickingImage, setPickingImage] = useState(false);
  const [pickingVideo, setPickingVideo] = useState(false);
  const [formatActive, setFormatActive] = useState(false);
  const [showPollSheet, setShowPollSheet] = useState(false);

  // -----------------------------------------------------------
  // refs
  // -----------------------------------------------------------
  const draftRestored = useRef(false);
  const titleRef = useRef<TextInput>(null);
  const bodyRef = useRef<TextInput>(null);
  // 本文の選択範囲 — FormatToolbar の markdown 挿入に使う
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // mount 時に固定するランダム placeholder
  const placeholder = useMemo<string>(() => {
    const idx = Math.floor(Math.random() * PLACEHOLDER_POOL.length);
    return PLACEHOLDER_POOL[idx] ?? PLACEHOLDER_POOL[0]!;
  }, []);

  // -----------------------------------------------------------
  // 下書き復元 — ?draftId=xxx で「下書き一覧」から再開 (mount 1 回)
  // draftsStore の post 下書きを postDraftStore に流し込み、以後は同 ID を更新する。
  // -----------------------------------------------------------
  useEffect(() => {
    if (draftRestored.current) return;
    draftRestored.current = true;
    const did = typeof params.draftId === 'string' ? params.draftId : '';
    if (!did) return;
    const d = useDraftsStore.getState().items.find((x) => x.id === did);
    if (!d || d.kind !== 'post') return;
    const st = usePostDraftStore.getState();
    st.setTitle(d.title);
    st.setContent(d.content);
    st.setImages(d.images);
    st.setVideo(d.video);
    st.setAnonymous(d.anonymous);
    st.setTags(d.tags);
    st.setVisibility(d.visibility);
    st.setSelectedCommunities(d.selectedCommunityIds, d.selectedCommunities);
    st.setCwCategory(d.cwCategory);
    st.setCwText(d.cwText);
    st.setSourceUrl(d.sourceUrl);
    st.setPoll(d.showPoll, d.pollQuestion, d.pollOptions, d.pollMulti, d.pollHours);
    st.setDraftId(d.id);
    show('下書きを開きました', 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 下書き自動保存 (debounce 600ms)
  // 「一度でも何か入力したら」自動で下書き登録 → 以後は同一 draftId を更新。
  // Step 1 の content フィールド (title/content/images/video) を契機に store 全体を snapshot する。
  useEffect(() => {
    const meaningful = title.trim() || content.trim() || images.length > 0 || !!video;
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
  }, [title, content, images, video, anonymous]);

  // deep link prefill — community_id / prefill_tag (mount 1 回)
  useEffect(() => {
    const cid = typeof params.community_id === 'string' ? params.community_id : undefined;
    const preTag = typeof params.prefill_tag === 'string' ? params.prefill_tag.trim() : '';
    if (preTag) {
      const cur = usePostDraftStore.getState().tags;
      usePostDraftStore.getState().setTags(cur.includes(preTag) ? cur : [...cur, preTag].slice(0, 5));
    }
    if (!cid) return;
    let cancelled = false;
    void (async () => {
      try {
        const community = await fetchCommunity(cid);
        if (cancelled || !community) return;
        usePostDraftStore.getState().setVisibility('community_public');
        usePostDraftStore.getState().setSelectedCommunities([community.id], [community]);
      } catch (e) {
        console.warn('[post/create] failed to load community from deep link:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------
  // image picker
  // -----------------------------------------------------------
  const pickImage = async () => {
    if (pickingImage) return;
    setPickingImage(true);
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
    } finally {
      setPickingImage(false);
    }
  };

  // -----------------------------------------------------------
  // video picker
  // -----------------------------------------------------------
  const pickVideo = async () => {
    if (pickingVideo) return;
    setPickingVideo(true);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'videos',
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (r.canceled || r.assets.length === 0) return;
      const asset = r.assets[0];
      if (!asset) return;
      const v = await validateVideoSource({
        uri: asset.uri,
        fileSize: asset.fileSize,
        mimeType: asset.mimeType,
      });
      if (!v.ok) {
        hap.warn();
        show(v.reason, 'warn');
        return;
      }
      setVideo({ uri: asset.uri, mime: v.mime, ext: v.ext, size: v.size });
      hap.confirm();
    } catch (e) {
      console.warn('[post/create] pick video failed:', e);
      show('動画の取得に失敗しました', 'error');
    } finally {
      setPickingVideo(false);
    }
  };

  // -----------------------------------------------------------
  // poll handlers — 状態はすべて store 経由
  // -----------------------------------------------------------
  const openPoll = () => {
    setPoll(true, pollQuestion, pollOptions, pollMulti, pollHours);
    setShowPollSheet(true);
    hap.tap();
  };
  const changePollOption = (index: number, v: string) => {
    setPoll(true, pollQuestion, pollOptions.map((o, i) => (i === index ? v : o)), pollMulti, pollHours);
  };
  const addPollOption = () => {
    if (pollOptions.length >= 4) return;
    setPoll(true, pollQuestion, [...pollOptions, ''], pollMulti, pollHours);
  };
  const removePollOption = (index: number) => {
    if (pollOptions.length <= 2) return;
    setPoll(true, pollQuestion, pollOptions.filter((_, i) => i !== index), pollMulti, pollHours);
  };
  const clearPoll = () => {
    setPoll(false, '', ['', ''], false, 24);
    setShowPollSheet(false);
    hap.warn();
  };

  // -----------------------------------------------------------
  // format — 選択範囲に markdown を best-effort で挿入
  // -----------------------------------------------------------
  const wrapInline = (left: string, right: string, ph: string) => {
    const len = content.length;
    const s = clamp(selectionRef.current.start, 0, len);
    const e = clamp(selectionRef.current.end, s, len);
    const selected = content.slice(s, e) || ph;
    const next = content.slice(0, s) + left + selected + right + content.slice(e);
    setContent(next);
    requestAnimationFrame(() => bodyRef.current?.focus());
  };
  const prefixLines = (makePrefix: (i: number) => string) => {
    const len = content.length;
    const s = clamp(selectionRef.current.start, 0, len);
    const e = clamp(selectionRef.current.end, s, len);
    const lineStart = content.lastIndexOf('\n', s - 1) + 1;
    const nlIdx = content.indexOf('\n', e);
    const lineEnd = nlIdx === -1 ? len : nlIdx;
    const block = content.slice(lineStart, lineEnd);
    const transformed = block
      .split('\n')
      .map((ln, i) => makePrefix(i) + ln)
      .join('\n');
    const next = content.slice(0, lineStart) + transformed + content.slice(lineEnd);
    setContent(next);
    requestAnimationFrame(() => bodyRef.current?.focus());
  };
  const insertFormat = (kind: FormatKind) => {
    switch (kind) {
      case 'bold':
        return wrapInline('**', '**', '太字');
      case 'italic':
        return wrapInline('*', '*', '斜体');
      case 'strike':
        return wrapInline('~~', '~~', '取り消し線');
      case 'code':
        return wrapInline('`', '`', 'コード');
      case 'link':
        return wrapInline('[', '](https://)', 'リンク');
      case 'list':
        return prefixLines(() => '- ');
      case 'orderedList':
        return prefixLines((i) => `${i + 1}. `);
      case 'quote':
        return prefixLines(() => '> ');
    }
  };

  // -----------------------------------------------------------
  // navigation
  // -----------------------------------------------------------
  const canGoNext = title.trim().length > 0 || content.trim().length > 0 || images.length > 0 || !!video;

  const handleNext = () => {
    if (!canGoNext) return;
    hap.tap();
    router.push('/post/create-settings' as never);
  };

  const handleClose = () => {
    hap.tap();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/feed' as never);
  };

  // -----------------------------------------------------------
  // render
  // -----------------------------------------------------------
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>

      {/* ================================================================
          ヘッダー — [✕] | spacer | [次へ pill]
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
        {/* ✕ 閉じる */}
        <PressableScale
          onPress={handleClose}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          hitSlop={8}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <IconX size={22} color={C.text} strokeWidth={2.2} />
        </PressableScale>

        {/* spacer */}
        <View style={{ flex: 1 }} />

        {/* 次へ pill */}
        <PressableScale
          onPress={handleNext}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel="次へ"
          accessibilityState={{ disabled: !canGoNext }}
          disabled={!canGoNext}
          style={{
            paddingHorizontal: SP['4'],
            paddingVertical: SP['2'],
            borderRadius: R.full,
            backgroundColor: canGoNext ? C.accent : C.bg3,
            opacity: canGoNext ? 1 : 0.5,
          }}
        >
          <Text style={[T.smallB, { color: canGoNext ? '#fff' : C.text3 }]}>次へ</Text>
        </PressableScale>
      </View>

      {/* ================================================================
          本体 — KeyboardAvoiding + ScrollView
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
              2カラムレイアウト: [アバター列 | スレッドライン] + [コンテンツ列]
              ============================================================ */}
          <View style={{ flexDirection: 'row', paddingHorizontal: SP['4'], paddingTop: SP['4'] }}>

            {/* --- 左列: アバター + スレッドライン --- */}
            <View style={{ width: 48, alignItems: 'center' }}>
              {anonymous ? (
                <Avatar size={46} anonymous />
              ) : (
                <Avatar size={46} name={displayName} uri={null} ring="accent" />
              )}
              {/* スレッドライン */}
              <View
                style={{
                  width: 2,
                  flex: 1,
                  marginTop: SP['2'],
                  borderRadius: R.full,
                  backgroundColor: C.border,
                  minHeight: 40,
                }}
              />
            </View>

            {/* --- 右列: すべてのコンテンツ --- */}
            <View style={{ flex: 1, paddingLeft: SP['3'], paddingBottom: SP['6'] }}>

              {/* 名前行 + 匿名トグル pill */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: SP['2'],
                  minHeight: 46,
                }}
              >
                <View>
                  <Text style={[T.bodyB, { color: C.text }]}>
                    {anonymous ? '匿名で投稿' : displayName}
                  </Text>
                  <Text style={[T.caption, { color: C.text3, marginTop: 1 }]}>
                    {anonymous ? '名前は表示されません' : 'プロフィールに表示されます'}
                  </Text>
                </View>
                <PressableScale
                  haptic="select"
                  onPress={() => setAnonymous(!anonymous)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: anonymous }}
                  accessibilityLabel={anonymous ? '匿名をオフ' : '匿名にする'}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    paddingHorizontal: SP['3'],
                    paddingVertical: 6,
                    borderRadius: R.full,
                    backgroundColor: anonymous ? C.accentBg : C.bg3,
                    borderWidth: 1,
                    borderColor: anonymous ? C.accent : C.border,
                  }}
                >
                  {anonymous ? (
                    <>
                      <EyeOff size={13} color={C.accent} strokeWidth={2.2} />
                      <Text style={[T.smallB, { color: C.accent }]}>匿名</Text>
                    </>
                  ) : (
                    <>
                      <Eye size={13} color={C.text2} strokeWidth={2.2} />
                      <Text style={[T.smallM, { color: C.text2 }]}>公開</Text>
                    </>
                  )}
                </PressableScale>
              </View>

              {/* タイトル — Reddit風の太字 hero 入力 (任意) */}
              <ComposerTitleField
                value={title}
                onChangeText={setTitle}
                inputRef={titleRef}
              />

              {/* 本文 — X / Threads 風の borderless 大型 textarea */}
              <View style={{ marginTop: SP['2'] }}>
                <ComposerBodyField
                  value={content}
                  onChangeText={setContent}
                  placeholder={placeholder}
                  onSelectionChange={(sel) => {
                    selectionRef.current = sel;
                  }}
                  inputRef={bodyRef}
                />
              </View>

              {/* メディアグリッド */}
              {(images.length > 0 || video) && (
                <View style={{ marginTop: SP['3'] }}>
                  <ComposerMediaGrid
                    images={images}
                    video={video ? { uri: video.uri, sizeMb: video.size / 1024 / 1024 } : null}
                    onRemoveImage={(uri) => setImages(images.filter((u) => u !== uri))}
                    onRemoveVideo={() => setVideo(null)}
                    containerPaddingH={0}
                  />
                </View>
              )}
            </View>
          </View>
        </ScrollView>

        {/* ============================================================
            フッター: 書式ツールバー (トグル) + X 風アクションバー
            ============================================================ */}
        {formatActive && (
          <View style={{ paddingHorizontal: SP['3'], paddingBottom: SP['1'] }}>
            <FormatToolbar onInsert={insertFormat} />
          </View>
        )}
        <ComposerBottomBar
          onPickImage={pickImage}
          onPickVideo={pickVideo}
          onTogglePoll={openPoll}
          onToggleFormat={() => {
            setFormatActive((v) => !v);
            hap.tap();
          }}
          pickingImage={pickingImage}
          pickingVideo={pickingVideo}
          imagesFull={images.length >= 4}
          hasVideo={!!video}
          pollActive={showPoll}
          formatActive={formatActive}
          bottomInset={insets.bottom}
        />
      </KeyboardAvoidingView>

      {/* ================================================================
          Bottom sheets
          ================================================================ */}
      <PollEditorSheet
        visible={showPollSheet}
        onClose={() => setShowPollSheet(false)}
        question={pollQuestion}
        onQuestionChange={(q) => setPoll(true, q, pollOptions, pollMulti, pollHours)}
        options={pollOptions}
        onOptionChange={changePollOption}
        onAddOption={addPollOption}
        onRemoveOption={removePollOption}
        multiSelect={pollMulti}
        onToggleMulti={(m) => setPoll(true, pollQuestion, pollOptions, m, pollHours)}
        hours={pollHours ?? 24}
        onHoursChange={(h) => setPoll(true, pollQuestion, pollOptions, pollMulti, h)}
        onClear={clearPoll}
      />
    </View>
  );
}
