// ============================================================
// app/post/create.tsx — 投稿作成 (1画面で完結)
// ------------------------------------------------------------
// 旧 2-Step (Step1=入力 / Step2=create-settings で設定) を 1 画面に統合。
// この画面で完結する:
//   - 投稿先コミュニティ選択 (必須・単一・Reddit 風の上部ピッカー)
//   - 本文 (タイトルと分けない単一フィールド) / 画像・動画 / タグ (任意) / 投票
//   - 常に匿名で投稿 (公開範囲・CW・出典は廃止)
// ヘッダー右の「投稿」で直接送信する (create-settings は現在未使用)。
// 状態は usePostDraftStore (Zustand)。
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X as IconX, EyeOff } from 'lucide-react-native';

import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { ComposerBodyField } from '../../components/post/composer/ComposerBodyField';
import { ComposerMediaGrid } from '../../components/post/composer/ComposerMediaGrid';
import { ComposerBottomBar } from '../../components/post/composer/ComposerBottomBar';
import { FormatToolbar, type FormatKind } from '../../components/post/composer/FormatToolbar';
import { PollEditorSheet } from '../../components/post/composer/PollEditorSheet';
import { CommunityPickerSheet } from '../../components/post/composer/CommunityPickerSheet';

import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { usePostDraftStore } from '../../stores/postDraftStore';
import { useDraftsStore, newDraftId } from '../../stores/draftsStore';
import { hap } from '../../design/haptics';
import { fetchCommunity, fetchMyCommunities, type Community } from '../../lib/api/communities';
import { createPost, fetchPostById, updatePost } from '../../lib/api/posts';
import { checkContent } from '../../lib/ai/checkContent';
import { validateVideoSource, uploadPostImage, uploadPostVideo } from '../../lib/media';
import { makeWebPreviewDataUrl } from '../../lib/image';
import { sanitizeTag } from '../../lib/sanitize';
import { peekRate, rateLimitMessage } from '../../lib/rateLimit';
import { Icon } from '../../constants/icons';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';

// ============================================================
// 定数
// ============================================================

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

// タイトルと本文を分けない単一フィールドのプレースホルダ
const PLACEHOLDER = '話したいトピックを書いてみよう';
const MAX_TAGS = 5;

// ============================================================
// CreatePost — Step 1
// ============================================================

export default function CreatePost() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    community_id?: string;
    prefill_tag?: string;
    draftId?: string;
    editId?: string;
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
  const content = usePostDraftStore((s) => s.content);
  const setContent = usePostDraftStore((s) => s.setContent);
  const images = usePostDraftStore((s) => s.images);
  const setImages = usePostDraftStore((s) => s.setImages);
  const video = usePostDraftStore((s) => s.video);
  const setVideo = usePostDraftStore((s) => s.setVideo);
  // タグ (任意) / コミュニティ (必須・単一選択) / 公開範囲
  const tags = usePostDraftStore((s) => s.tags);
  const setTags = usePostDraftStore((s) => s.setTags);
  const selectedCommunityIds = usePostDraftStore((s) => s.selectedCommunityIds);
  const setSelectedCommunities = usePostDraftStore((s) => s.setSelectedCommunities);
  const setVisibility = usePostDraftStore((s) => s.setVisibility);
  // 投稿は常に匿名 (匿名トグルは廃止 — 匿名SNSの一貫性 #3)。
  // 実際の is_anonymous も create-settings 側で true 固定にしてある。
  const anonymous = true;
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
  // 1画面化: コミュニティ選択シート / タグ入力 / 投稿中フラグ
  const [showCommunitySheet, setShowCommunitySheet] = useState(false);
  const [communityQuery, setCommunityQuery] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [posting, setPosting] = useState(false);
  // ?editId= で開いた編集モード (空文字 = 通常の新規作成)。
  const [editId, setEditId] = useState('');
  // 編集対象が動画を持つか。動画は composer に出さず据え置くため、空本文+空画像でも
  //   保存を許可する判定に使う (= 動画のみ投稿の編集が validation で弾かれないように)。
  const [editHasVideo, setEditHasVideo] = useState(false);
  const qc = useQueryClient();

  // 参加コミュニティ一覧 (Reddit 風の「投稿先」ピッカー用)。
  const { data: myCommunities = [], isLoading: communitiesLoading } = useQuery({
    queryKey: ['my-communities', user?.id],
    queryFn: fetchMyCommunities,
    enabled: !!user,
    staleTime: 30_000,
  });
  const selectedCommunity = useMemo<Community | undefined>(
    () => myCommunities.find((c) => c.id === selectedCommunityIds[0]),
    [myCommunities, selectedCommunityIds],
  );

  // -----------------------------------------------------------
  // refs
  // -----------------------------------------------------------
  const draftRestored = useRef(false);
  const editRestored = useRef(false);
  const editIdRef = useRef(''); // 自動保存 guard 用 (state より先に同期確定させる)
  const bodyRef = useRef<TextInput>(null);
  // 本文の選択範囲 — FormatToolbar の markdown 挿入に使う
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  const placeholder = PLACEHOLDER;

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

  // ?editId=xxx — 既存投稿を編集モードで開く (mount 1 回)。fetchPostById で取得して
  // store に prefill。コミュニティ/poll/タイトルは編集対象外なので prefill しない。
  useEffect(() => {
    if (editRestored.current) return;
    editRestored.current = true;
    const eid = typeof params.editId === 'string' ? params.editId : '';
    if (!eid) return;
    editIdRef.current = eid; // 自動保存を即無効化するため同期セット
    setEditId(eid);
    let cancelled = false;
    void (async () => {
      try {
        const p = await fetchPostById(eid);
        if (cancelled || !p) return;
        const st = usePostDraftStore.getState();
        st.setContent(p.content ?? '');
        st.setImages(p.media_urls ?? []); // 既存は https — 温存 (保存時に再 upload しない)
        st.setTags(p.tag_names ?? []);
        setEditHasVideo((p.video_urls?.length ?? 0) > 0); // 動画は据え置き (composer 非表示)
        show('編集モードで開きました', 'info');
      } catch (e) {
        console.warn('[post/create] failed to load post for edit:', e);
        show('投稿の読み込みに失敗しました', 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 下書き自動保存 (debounce 600ms)
  // 「一度でも何か入力したら」自動で下書き登録 → 以後は同一 draftId を更新。
  // Step 1 の content フィールド (title/content/images/video) を契機に store 全体を snapshot する。
  useEffect(() => {
    if (editIdRef.current) return; // 編集モードは下書きへ書き戻さない
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
        const uris = r.assets.map((a) => a.uri).slice(0, 4);
        if (Platform.OS === 'web') {
          // Web では送信時の canvas リサイズ (manipulateAsync) がメインスレッドを
          // 塞いで「投稿の瞬間フリーズ」になる。ピック時に 1600px JPEG (data URL)
          // へ前倒しすると、送信時は prepareImageUpload の data: 短絡パスを通って
          // 重い処理が走らない。canvas 再エンコードで EXIF も除去される。
          // 失敗時は生 URI にフォールバック (= 従来どおり送信時に処理) するので退行なし。
          const processed = await Promise.all(
            uris.map(async (u) => {
              try {
                return await makeWebPreviewDataUrl(u, 1600, 0.85);
              } catch (e) {
                console.warn('[post/create] web image pre-process failed, fallback to raw uri:', e);
                return u;
              }
            }),
          );
          setImages(processed);
        } else {
          setImages(uris);
        }
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
  // コミュニティ選択 (単一選択・必須・Reddit 風)
  // -----------------------------------------------------------
  const handleToggleCommunity = (id: string) => {
    const community = myCommunities.find((c) => c.id === id);
    if (selectedCommunityIds[0] === id) {
      setSelectedCommunities([], []);
      setVisibility('public');
    } else {
      setSelectedCommunities([id], community ? [community] : []);
      setVisibility('community_public');
      setShowCommunitySheet(false); // 単一選択なので選んだら閉じる
    }
    hap.tap();
  };

  // -----------------------------------------------------------
  // タグ (任意・最大 5)
  // -----------------------------------------------------------
  const addTag = () => {
    const t = sanitizeTag(tagInput);
    if (!t || tags.includes(t)) {
      setTagInput('');
      return;
    }
    if (tags.length >= MAX_TAGS) {
      show(`タグは最大 ${MAX_TAGS} 個まで`, 'warn');
      return;
    }
    setTags([...tags, t]);
    setTagInput('');
    hap.tap();
  };
  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  // -----------------------------------------------------------
  // 投稿 — 旧 Step2 (create-settings) の送信ロジックを 1 画面に統合
  // -----------------------------------------------------------
  const canPost =
    (content.trim().length > 0 || images.length > 0 || !!video || editHasVideo) &&
    (editId !== '' || selectedCommunityIds.length > 0) &&
    !posting;

  const handlePost = async () => {
    if (posting) return;
    const s = usePostDraftStore.getState();
    if (!s.content.trim() && s.images.length === 0 && !s.video && !editHasVideo) {
      show('本文・画像・動画のいずれかを入力してください。', 'warn');
      return;
    }

    // ---- 編集モード: 既存投稿を updatePost で更新 (コミュニティ/poll は変更しない) ----
    if (editId) {
      setPosting(true);
      try {
        const userId = useAuthStore.getState().user?.id;
        if (!userId) {
          show('ログインし直してください', 'error');
          return;
        }
        // 編集後の本文も AI チェック (UX ガード。※ fail-open + client のみなので
        //   セキュリティ境界ではない — 真の防御は通報+事後モデレーション)。
        const check = await checkContent({ content: s.content, tags: s.tags });
        if (!check.ok) {
          hap.error();
          show(check.reason ?? 'コンテンツポリシーに反する可能性があります', 'error');
          return;
        }
        // 既存の https 画像は温存、新規ローカル URI のみ upload。
        const finalImageUrls = await Promise.all(
          s.images.map((uri) =>
            /^https?:\/\//i.test(uri) ? Promise.resolve(uri) : uploadPostImage(uri, userId),
          ),
        );
        await updatePost(editId, {
          content: s.content,
          tagNames: s.tags,
          mediaUrls: finalImageUrls,
        });
        hap.success();
        show('更新しました', 'success');
        // 反映: 詳細(REST)/フィード周辺(RPC)/各フィードを再取得。
        void qc.invalidateQueries({ queryKey: ['post', editId] });
        void qc.invalidateQueries({ queryKey: ['feed-page'] });
        void qc.invalidateQueries({ queryKey: ['feed'] });
        void qc.invalidateQueries({ queryKey: ['user-posts', userId] });
        void qc.invalidateQueries({ queryKey: ['my-community-feed-rich'] });
        void qc.invalidateQueries({ queryKey: ['community'] }); // コミュニティ各フィードの古い本文を除去
        void qc.invalidateQueries({ queryKey: ['post-edited-at', editId] }); // 編集済みバッジ更新
        usePostDraftStore.getState().reset();
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/feed' as never);
      } catch (e: unknown) {
        hap.error();
        const msg = e instanceof Error ? e.message : String(e);
        let userMsg = '編集に失敗しました。再度お試しください。';
        if (msg.includes('23514') || msg.includes('content_check')) {
          userMsg = '本文・画像・動画のいずれかが必要です。';
        } else if (
          msg.includes('row-level security') ||
          msg.includes('権限') ||
          msg.includes('編集できませんでした')
        ) {
          userMsg = '編集権限がありません (自分の投稿のみ編集できます)。';
        }
        show(userMsg, 'error');
      } finally {
        setPosting(false);
      }
      return;
    }

    if (s.selectedCommunityIds.length === 0) {
      show('投稿するコミュニティを選んでください。', 'warn');
      return;
    }
    setPosting(true);
    try {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) {
        show('ログインし直してください', 'error');
        return;
      }
      // ★ レート制限は upload 前に先読み (createPost の checkRate は increment するので
      //   ここは peekRate=非increment で判定。超過なら upload せず即 return → 孤児メディア防止)。
      const rl = peekRate('post');
      if (!rl.ok) {
        hap.error();
        show(rateLimitMessage('post', rl.retryAfterMs), 'error');
        return;
      }
      let uploadedImageUrls: string[] = [];
      let uploadedVideoUrls: string[] = [];
      try {
        // 先に AI チェック → NG なら upload しない (orphan メディア防止)
        const check = await checkContent({ content: s.content, tags: s.tags });
        if (!check.ok) {
          hap.error();
          show(check.reason ?? 'コンテンツポリシーに反する可能性があります', 'error');
          return;
        }
        [uploadedImageUrls, uploadedVideoUrls] = await Promise.all([
          s.images.length > 0
            ? Promise.all(s.images.map((uri) => uploadPostImage(uri, userId)))
            : Promise.resolve<string[]>([]),
          s.video
            ? uploadPostVideo(s.video.uri, userId, { mime: s.video.mime, ext: s.video.ext }).then((url) => [url])
            : Promise.resolve<string[]>([]),
        ]);
      } catch (e) {
        show(e instanceof Error ? e.message : String(e), 'error');
        return;
      }

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
        title: null, // タイトルと本文を分けない (1画面化)
        mediaUris: uploadedImageUrls,
        videoUris: uploadedVideoUrls,
        videoDurations: [],
        videoPosters: [],
        tagNames: s.tags, // 任意
        isAnonymous: true, // 常に匿名
        sourceUrl: null,
        isPublic: true,
        contentWarning: null,
        cwCategory: null,
        poll: pollPayload,
        visibility: 'community_public',
        community_ids: s.selectedCommunityIds,
      });

      hap.success();
      show('投稿しました', 'success');
      {
        const did = usePostDraftStore.getState().draftId;
        if (did) useDraftsStore.getState().remove(did);
      }
      void qc.invalidateQueries({ queryKey: ['my-community-feed'] });
      void qc.invalidateQueries({ queryKey: ['my-community-feed-rich'] });
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
      const msg = e instanceof Error ? e.message : String(e);
      let userMsg = '投稿に失敗しました。再度お試しください。';
      if (msg.includes('row-level security') || msg.includes('RLS')) userMsg = '権限エラー。ログインし直してください。';
      else if (msg.includes('Not authenticated') || msg.includes('未ログイン')) userMsg = 'ログインし直してください。';
      else if (msg.includes('Network') || msg.includes('Failed to fetch')) userMsg = '通信エラー。電波を確認してください。';
      else if (msg.includes('速すぎ') || msg.includes('時間を置いて') || msg.includes('ペースが')) userMsg = msg;
      show(userMsg, 'error');
    } finally {
      setPosting(false);
    }
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

        {/* 投稿 pill (1画面で完結) */}
        <PressableScale
          onPress={handlePost}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel={editId ? '更新' : '投稿'}
          accessibilityState={{ disabled: !canPost }}
          disabled={!canPost}
          style={{
            paddingHorizontal: SP['4'],
            paddingVertical: SP['2'],
            borderRadius: R.full,
            backgroundColor: canPost ? C.accent : C.bg3,
            opacity: canPost ? 1 : 0.5,
          }}
        >
          <Text style={[T.smallB, { color: canPost ? '#fff' : C.text3 }]}>
            {posting ? (editId ? '更新中…' : '投稿中…') : (editId ? '更新' : '投稿')}
          </Text>
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
              投稿先コミュニティ (必須・Reddit 風の上部ピッカー)
              ============================================================ */}
          {!editId && (
          <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'] }}>
            <PressableScale
              onPress={() => {
                setShowCommunitySheet(true);
                hap.tap();
              }}
              haptic="tap"
              accessibilityRole="button"
              accessibilityLabel="投稿先のコミュニティを選ぶ"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                alignSelf: 'flex-start',
                maxWidth: '100%',
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'],
                borderRadius: R.full,
                backgroundColor: selectedCommunity ? C.accentBg : C.bg2,
                borderWidth: 1,
                borderColor: selectedCommunity ? C.accent : C.border,
              }}
            >
              <Icon.community size={16} color={selectedCommunity ? C.accent : C.text2} strokeWidth={2.2} />
              <Text
                style={[T.smallB, { color: selectedCommunity ? C.accent : C.text2, flexShrink: 1 }]}
                numberOfLines={1}
              >
                {selectedCommunity ? selectedCommunity.name : 'コミュニティを選択'}
              </Text>
              <Icon.chevronD size={16} color={selectedCommunity ? C.accent : C.text3} strokeWidth={2.2} />
            </PressableScale>
          </View>
          )}

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
                {/* 投稿は常に匿名 — 操作不可の静的バッジで明示 (トグル廃止 #3) */}
                <View
                  accessibilityLabel="この投稿は匿名で送信されます"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    paddingHorizontal: SP['3'],
                    paddingVertical: 6,
                    borderRadius: R.full,
                    backgroundColor: C.accentBg,
                    borderWidth: 1,
                    borderColor: C.accent,
                  }}
                >
                  <EyeOff size={13} color={C.accent} strokeWidth={2.2} />
                  <Text style={[T.smallB, { color: C.accent }]}>匿名</Text>
                </View>
              </View>

              {/* 本文 — タイトルと本文を分けない単一フィールド (X / Threads 風) */}
              <ComposerBodyField
                value={content}
                onChangeText={setContent}
                placeholder={placeholder}
                onSelectionChange={(sel) => {
                  selectionRef.current = sel;
                }}
                inputRef={bodyRef}
              />

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

              {/* タグ (任意・最大5) */}
              <View style={{ marginTop: SP['4'], gap: SP['2'] }}>
                {tags.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                    {tags.map((t) => (
                      <PressableScale
                        key={t}
                        onPress={() => removeTag(t)}
                        haptic="tap"
                        accessibilityLabel={`タグ ${t} を削除`}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                          paddingHorizontal: SP['3'],
                          paddingVertical: 5,
                          borderRadius: R.full,
                          backgroundColor: C.accentBg,
                          borderWidth: 1,
                          borderColor: C.accentSoft,
                        }}
                      >
                        <Text style={[T.smallB, { color: C.accentLight }]}>#{t}</Text>
                        <IconX size={12} color={C.accentLight} strokeWidth={2.4} />
                      </PressableScale>
                    ))}
                  </View>
                )}
                {tags.length < MAX_TAGS && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SP['2'],
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['2'],
                      borderRadius: R.md,
                      backgroundColor: C.bg2,
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <Icon.hash size={14} color={C.text3} strokeWidth={2.2} />
                    <TextInput
                      value={tagInput}
                      onChangeText={setTagInput}
                      onSubmitEditing={addTag}
                      placeholder="タグを追加 (任意)"
                      placeholderTextColor={C.text3}
                      returnKeyType="done"
                      style={[T.small, { color: C.text, flex: 1, padding: 0 }]}
                    />
                  </View>
                )}
              </View>
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
          hideVideo={!!editId}
          hidePoll={!!editId}
          bottomInset={insets.bottom}
        />
      </KeyboardAvoidingView>

      {/* ================================================================
          Bottom sheets
          ================================================================ */}
      <PollEditorSheet
        visible={showPollSheet && !editId}
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

      {/* コミュニティ選択シート (Reddit 風の投稿先ピッカー・単一選択) */}
      <CommunityPickerSheet
        visible={showCommunitySheet}
        onClose={() => setShowCommunitySheet(false)}
        communities={myCommunities}
        selectedIds={selectedCommunityIds}
        onToggle={handleToggleCommunity}
        loading={communitiesLoading}
        query={communityQuery}
        onQueryChange={setCommunityQuery}
      />
    </View>
  );
}
