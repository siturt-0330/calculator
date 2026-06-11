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
  Animated,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X as IconX } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { PressableScale } from '../../components/ui/PressableScale';
import { CommunityIcon } from '../../components/ui/CommunityIcon';
import { ComposerBodyField } from '../../components/post/composer/ComposerBodyField';
import { ComposerMediaGrid } from '../../components/post/composer/ComposerMediaGrid';
import { ComposerBottomBar } from '../../components/post/composer/ComposerBottomBar';
import { FormatToolbar, type FormatKind } from '../../components/post/composer/FormatToolbar';
import { PollEditorSheet } from '../../components/post/composer/PollEditorSheet';
import { CommunityPickerSheet } from '../../components/post/composer/CommunityPickerSheet';

import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { useRecentCommunitiesStore } from '../../stores/recentCommunitiesStore';
import { usePostDraftStore } from '../../stores/postDraftStore';
import { useDraftsStore, newDraftId } from '../../stores/draftsStore';
import { useDraftStore } from '../../stores/draftStore';
import { hap } from '../../design/haptics';
import {
  fetchCommunity,
  fetchMyCommunities,
  joinCommunity,
  searchByName,
  type Community,
} from '../../lib/api/communities';
import { createPost, fetchPostById, updatePost } from '../../lib/api/posts';
import { checkContent } from '../../lib/ai/checkContent';
import { validateVideoSource, uploadPostImage, uploadPostVideo } from '../../lib/media';
import { makeWebPreviewDataUrl } from '../../lib/image';
import { openPhotoEditor } from '../../lib/photoEditor';
import { sanitizeTag } from '../../lib/sanitize';
import { peekRate, rateLimitMessage } from '../../lib/rateLimit';
import { isOnline } from '../../lib/offline/networkMonitor';
import { Icon } from '../../constants/icons';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors, useGradients } from '../../hooks/useColors';

// ============================================================
// 定数
// ============================================================

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

// タイトルと本文を分けない単一フィールドのプレースホルダ
const PLACEHOLDER = '話したいトピックを書いてみよう';
const MAX_TAGS = 5;
// 本文が空のときに出す「書き出しヒント」chips (タップで本文へ挿入)。
// 真っ黒な余白の寂しさを埋めつつ、最初の一歩のハードルを下げる。
// 最近のコミュ chips の最大表示数
const MAX_RECENT_CHIPS = 5;
// ローカル下書き自動保存のデバウンス間隔 (ms)
const DRAFT_DEBOUNCE_MS = 1500;
// 下書き保存インジケーターの表示保持時間 (ms)
const DRAFT_INDICATOR_DURATION_MS = 2000;

// ============================================================
// CreatePost — Step 1
// ============================================================

// ピック時先行アップロードの投機キャッシュの 1 エントリ (key=ローカルURI)。
type PrefetchEntry = {
  localUri: string;
  promise: Promise<string>; // 解決値 = remoteUrl (公開 https URL)
  remoteUrl?: string;
  errored: boolean;
};

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
  const GRAD = useGradients();

  const user = useAuthStore((s) => s.user);

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
  const [pickingCamera, setPickingCamera] = useState(false); // カメラ撮影中 (画像ピックとは独立)
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
  // 送信の進捗フェーズ (pill 表示用)。アップロード中を可視化して「固まった?」不安を減らす。
  const [postPhase, setPostPhase] = useState<'idle' | 'uploading' | 'saving'>('idle');
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
  // 表示用フォールバック: deep link 直後など myCommunities 取得前でも選択済みコミュの
  // 名前/アイコンを pill に出せるよう、store 保持のメタ (setSelectedCommunities で
  // 渡された Community[]) も参照する。選択ロジック自体には一切使わない (表示のみ)。
  const selectedCommunityMeta = usePostDraftStore((s) => s.selectedCommunities);
  const displayCommunity = useMemo<Community | undefined>(
    () => selectedCommunity ?? selectedCommunityMeta.find((c) => c.id === selectedCommunityIds[0]),
    [selectedCommunity, selectedCommunityMeta, selectedCommunityIds],
  );

  // 最近見たコミュニティ (HomeDrawer 履歴と同じ store・read-only selector 購読)。
  // 参加中 (myCommunities に含まれる) のものだけ chips に出す — 未参加コミュは
  // 投稿先にできない可能性があり、選んでも attach で弾かれて混乱するため。
  const recentCommunities = useRecentCommunitiesStore((s) => s.items);
  const recentChips = useMemo(
    () =>
      recentCommunities
        .filter((r) => myCommunities.some((c) => c.id === r.id))
        .slice(0, MAX_RECENT_CHIPS),
    [recentCommunities, myCommunities],
  );
  // 履歴 store は sync 永続化 (MMKV/localStorage) — mount 時に 1 回 hydrate (多重呼び出しは no-op)
  useEffect(() => {
    useRecentCommunitiesStore.getState().hydrate();
  }, []);

  // -----------------------------------------------------------
  // refs
  // -----------------------------------------------------------
  const draftRestored = useRef(false);
  const editRestored = useRef(false);
  const editIdRef = useRef(''); // 自動保存 guard 用 (state より先に同期確定させる)
  const bodyRef = useRef<TextInput>(null);
  // 本文の選択範囲 — FormatToolbar の markdown 挿入に使う
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // ピック時先行アップロードの投機キャッシュ (remove は一切しない = データ消失ゼロ)。
  //   key=ローカルURI / value={promise(→remoteUrl), remoteUrl?, errored}。
  //   未採用 prefetch は storage に orphan として残す (client から消すと採用済み media を
  //   消す race が原理的に避けられないため。回収はサーバ側 GC に委ねる=申し送り)。
  const imageUploadsRef = useRef<Map<string, PrefetchEntry>>(new Map());
  const videoUploadsRef = useRef<Map<string, PrefetchEntry>>(new Map());

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

  // 下書き保存インジケーター — フェードイン→DRAFT_INDICATOR_DURATION_MS保持→フェードアウト
  // useRef で安定した関数参照を保持し、useEffect の deps 警告を回避する。
  const draftSavedOpacity = useRef(new Animated.Value(0)).current;
  const draftSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDraftSavedIndicatorRef = useRef(() => {
    if (draftSavedTimerRef.current) clearTimeout(draftSavedTimerRef.current);
    draftSavedOpacity.setValue(0);
    Animated.timing(draftSavedOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start(() => {
      draftSavedTimerRef.current = setTimeout(() => {
        Animated.timing(draftSavedOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
      }, DRAFT_INDICATOR_DURATION_MS);
    });
  });

  // draftStore (server-synced) の loadDrafts を mount 時に 1 回呼ぶ
  useEffect(() => {
    useDraftStore.getState().loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // server-synced 下書き自動保存 (debounce DRAFT_DEBOUNCE_MS)
  // 編集モードでは書かない。本文・タグ・メディアが空なら skip。
  useEffect(() => {
    if (editIdRef.current) return;
    const meaningful = content.trim() || tags.length > 0 || images.length > 0 || !!video;
    if (!meaningful) return;
    const t = setTimeout(() => {
      const s = usePostDraftStore.getState();
      useDraftStore.getState().saveDraft({
        content: s.content,
        title: s.title || undefined,
        tagNames: s.tags,
        mediaUrls: s.images,
      });
      showDraftSavedIndicatorRef.current();
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, tags, images, video]);

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

  // ローカル下書き自動保存 (debounce DRAFT_DEBOUNCE_MS)
  // 「一度でも何か入力したら」自動で下書き登録 → 以後は同一 draftId を更新。
  // 前回保存と内容が同じ場合はスキップして余分な write / indicator 表示を防ぐ。
  const lastSavedSnapshotRef = useRef('');
  const localDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (editIdRef.current) return; // 編集モードは下書きへ書き戻さない
    const meaningful = title.trim() || content.trim() || images.length > 0 || !!video;
    if (!meaningful) return;
    if (localDraftTimerRef.current) clearTimeout(localDraftTimerRef.current);
    localDraftTimerRef.current = setTimeout(() => {
      const s = usePostDraftStore.getState();
      // 変化がない場合は保存も indicator 表示もしない
      const snapshot = JSON.stringify({ content: s.content, title: s.title, images: s.images, video: s.video, tags: s.tags });
      if (snapshot === lastSavedSnapshotRef.current) return;
      lastSavedSnapshotRef.current = snapshot;
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
      // インジケーターはローカル保存後に一度だけ表示 (server save は並走するが indicator は共有)
      showDraftSavedIndicatorRef.current();
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (localDraftTimerRef.current) clearTimeout(localDraftTimerRef.current);
    };
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
                // 無音で生 URI にフォールバックすると「真っ黒/低品質」に気づけないので一応通知
                // (投稿自体は続行可能。toast は dedup されるので複数失敗でも 1 回)
                show('一部の画像の事前処理に失敗しました。そのまま投稿できます', 'warn');
                return u;
              }
            }),
          );
          setImages(processed);
          processed.forEach(kickImageUpload); // ★各画像の先行 upload を開始 (掃除はしない)
        } else {
          setImages(uris);
          uris.forEach(kickImageUpload);
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
  // camera — その場で撮影 (★端末のカメラロールには保存しない)
  // -----------------------------------------------------------
  // launchCameraAsync は撮影画像を一時ファイルで返すだけで、iOS/Android とも
  // カメラロールへ自動保存しない (web は <input capture> で同様)。これで「投稿用に
  // 撮った写真が端末のフォルダに溜まる」問題を解消する。後処理は pickImage と同じ。
  const takePhoto = async () => {
    if (pickingCamera || images.length >= 4) return;
    setPickingCamera(true);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          show('カメラへのアクセス許可が必要です', 'warn');
          return;
        }
      }
      const r = await ImagePicker.launchCameraAsync({
        mediaTypes: 'images',
        quality: 0.85,
      });
      if (r.canceled || !r.assets[0]) return;
      let uri = r.assets[0].uri;
      if (Platform.OS === 'web') {
        // 送信時フリーズ回避のため pickImage と同様にピック時 data URL 化
        try {
          uri = await makeWebPreviewDataUrl(uri, 1600, 0.85);
        } catch (e) {
          console.warn('[post/create] web camera pre-process failed:', e);
          show('一部の画像の事前処理に失敗しました。そのまま投稿できます', 'warn');
        }
      }
      const next = [...images, uri].slice(0, 4);
      setImages(next);
      kickImageUpload(uri); // 先行 upload
      hap.tap();
    } catch (e) {
      console.warn('[post/create] take photo failed:', e);
      show('写真の撮影に失敗しました', 'error');
    } finally {
      setPickingCamera(false);
    }
  };

  // -----------------------------------------------------------
  // 画像編集 — 添付済み画像を切り抜き/回転 (openCropper の rect モード)。opt-in。
  // -----------------------------------------------------------
  const editImage = async (index: number) => {
    const uri = usePostDraftStore.getState().images[index];
    if (!uri) return;
    try {
      // web: フル編集 (描く/文字/スタンプ/モザイク/フィルター/切り抜き)。native: 切り抜き+回転。
      const edited = await openPhotoEditor(uri);
      if (!edited || edited === uri) return; // キャンセル or 変更なし
      const cur = usePostDraftStore.getState().images;
      // 編集中に配列が変わった可能性 → 同 index が同 uri のときだけ差し替える (重複/並べ替え対策)
      if (cur[index] !== uri) return;
      const next = cur.slice();
      next[index] = edited;
      setImages(next);
      kickImageUpload(edited); // 編集後の画像を先行 upload (旧 prefetch は破棄=無害)
      hap.tap();
    } catch (e) {
      console.warn('[post/create] edit image failed:', e);
      show('画像の編集に失敗しました', 'warn');
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
        // 検証エラー (サイズ/形式) は選択前に判断できない情報なので、ワンタップで
        // picker を再起動できる「別の動画を選ぶ」アクションを toast に付ける。
        show(v.reason, 'warn', {
          undoLabel: '別の動画を選ぶ',
          onUndo: () => {
            void pickVideo();
          },
        });
        return;
      }
      setVideo({ uri: asset.uri, mime: v.mime, ext: v.ext, size: v.size });
      kickVideoUpload({ uri: asset.uri, mime: v.mime, ext: v.ext }); // ★先行 upload (掃除はしない)
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
  // 未参加コミュへの「参加して投稿」 (ユーザー要望 2026-06-12)
  // 検索ヒットのうち未参加のものを sheet の discover セクションに出し、
  // open コミュは参加 → 即投稿先に自動選択 → sheet を閉じる。
  // request/invite 制はその場で参加できないため詳細画面の申請フローへ
  // (下書きは autosave されるので戻ってきても消えない)。
  // -----------------------------------------------------------
  const { data: discoverHits = [] } = useQuery({
    queryKey: ['composer-discover', communityQuery.trim()],
    queryFn: () => searchByName(communityQuery.trim(), 20),
    enabled: showCommunitySheet && communityQuery.trim().length >= 1,
    staleTime: 30_000,
  });
  const discoverUnjoined = useMemo(
    () => discoverHits.filter((h) => !myCommunities.some((m) => m.id === h.id)),
    [discoverHits, myCommunities],
  );
  const [joiningIds, setJoiningIds] = useState<Set<string>>(new Set());
  const handleJoinAndSelect = (c: Community) => {
    if (c.visibility !== 'open') {
      show('このコミュニティは参加申請が必要です。詳細から申請してください', 'warn');
      setShowCommunitySheet(false);
      router.push(`/community/${c.id}` as never);
      return;
    }
    if (joiningIds.has(c.id)) return; // 二重タップガード
    setJoiningIds((prev) => new Set(prev).add(c.id));
    void (async () => {
      try {
        const { error } = await joinCommunity(c.id);
        if (error) {
          show(error || '参加に失敗しました', 'error');
          return;
        }
        // メンバーシップ cache を更新しつつ、待たずに即選択して閉じる
        void qc.invalidateQueries({ queryKey: ['my-community-ids'] });
        void qc.invalidateQueries({ queryKey: ['my-communities'] });
        void qc.invalidateQueries({ queryKey: ['my-community-feed-rich'] });
        setSelectedCommunities([c.id], [c]);
        setVisibility('community_public');
        setShowCommunitySheet(false);
        hap.success();
        show(`${c.name} に参加しました — このコミュに投稿します`, 'success');
      } catch {
        show('通信エラーが発生しました', 'error');
      } finally {
        setJoiningIds((prev) => {
          const next = new Set(prev);
          next.delete(c.id);
          return next;
        });
      }
    })();
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
  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t));
    // 誤タップ対策: タグは再入力コストが高いので undo できる toast を出す。
    // onUndo は実行時の最新 tags を store から読んで復元する (stale closure 回避)。
    show(`タグ #${t} を削除しました`, 'info', {
      undoLabel: '元に戻す',
      onUndo: () => {
        const cur = usePostDraftStore.getState().tags;
        if (!cur.includes(t)) setTags([...cur, t].slice(0, MAX_TAGS));
      },
    });
  };

  // -----------------------------------------------------------
  // 投稿 — 旧 Step2 (create-settings) の送信ロジックを 1 画面に統合
  // -----------------------------------------------------------
  const canPost =
    (content.trim().length > 0 || images.length > 0 || !!video || editHasVideo) &&
    (editId !== '' || selectedCommunityIds.length > 0) &&
    !posting;

  // 送信ボタンの文言: 送信中はフェーズ (アップロード中… / 投稿中…) を出す。
  const phaseLabel =
    postPhase === 'uploading' ? 'アップロード中…' : editId ? '更新中…' : '投稿中…';

  // 画像 1 枚の先行 upload を起こして Map に登録 (既に登録済み / https ならスキップ)。
  const kickImageUpload = (uri: string) => {
    if (!uri || /^https?:\/\//i.test(uri)) return; // 既存リモートは温存 (編集経路)
    if (imageUploadsRef.current.has(uri)) return; // 同一 URI の二重 upload 防止
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return; // 未ログイン → 送信時にまとめて処理
    const entry: PrefetchEntry = { localUri: uri, errored: false, promise: Promise.resolve('') };
    entry.promise = uploadPostImage(uri, userId).then(
      (remoteUrl) => {
        entry.remoteUrl = remoteUrl;
        return remoteUrl;
      },
      (e) => {
        entry.errored = true;
        // 先行 upload 失敗を可視化 (送信時に再試行される旨も伝える)
        show('画像の先行アップロードに失敗しました（送信時に再試行します）', 'warn');
        throw e;
      },
    );
    entry.promise.catch(() => {}); // 送信まで誰も await しない間の unhandled rejection 回避
    imageUploadsRef.current.set(uri, entry);
  };

  // 動画 1 件の先行 upload 版。
  const kickVideoUpload = (v: { uri: string; mime: string; ext: string }) => {
    if (!v.uri || /^https?:\/\//i.test(v.uri)) return;
    if (videoUploadsRef.current.has(v.uri)) return;
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    const entry: PrefetchEntry = { localUri: v.uri, errored: false, promise: Promise.resolve('') };
    entry.promise = uploadPostVideo(v.uri, userId, { mime: v.mime, ext: v.ext }).then(
      (remoteUrl) => {
        entry.remoteUrl = remoteUrl;
        return remoteUrl;
      },
      (e) => {
        entry.errored = true;
        // 先行 upload 失敗を可視化 (送信時に再試行される旨も伝える)
        show('動画の先行アップロードに失敗しました（送信時に再試行します）', 'warn');
        throw e;
      },
    );
    entry.promise.catch(() => {});
    videoUploadsRef.current.set(v.uri, entry);
  };

  const handlePost = async () => {
    if (posting) return;
    const s = usePostDraftStore.getState();
    if (!s.content.trim() && s.images.length === 0 && !s.video && !editHasVideo) {
      show('本文・画像・動画のいずれかを入力してください。', 'warn');
      return;
    }

    // ---- 編集モード: 既存投稿を updatePost で更新 (コミュニティ/poll は変更しない) ----
    if (editId) {
      // ★ userId / AI チェックは setPosting(true) の前に行う。
      //   try 内で return すると finally が通らず posting が true のまま固着するため。
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
      setPosting(true);
      try {
        setPostPhase('uploading');
        // 既存の https 画像は温存、新規ローカル URI のみ upload。
        const finalImageUrls = await Promise.all(
          s.images.map((uri) =>
            /^https?:\/\//i.test(uri) ? Promise.resolve(uri) : uploadPostImage(uri, userId),
          ),
        );
        setPostPhase('saving');
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
    // ★ userId / レート制限チェックは setPosting(true) の前に行う。
    //   try 内で return すると finally が通らず posting / postPhase が固着するため。
    const userId = useAuthStore.getState().user?.id;
    if (!userId) {
      show('ログインし直してください', 'error');
      return;
    }
    // レート制限は upload 前に先読み (createPost の checkRate は increment するので
    //   ここは peekRate=非increment で判定。超過なら upload せず即 return → 孤児メディア防止)。
    const rl = peekRate('post');
    if (!rl.ok) {
      hap.error();
      show(rateLimitMessage('post', rl.retryAfterMs), 'error');
      return;
    }
    setPosting(true);
    let navigated = false; // ★ try/catch 両方から参照するため try の外で宣言 (楽観遷移の二重実行/ロールバック判定)
    try {
      let uploadedImageUrls: string[] = [];
      let uploadedVideoUrls: string[] = [];
      try {
        // 先に AI チェック → NG なら upload しない (orphan メディア防止)
        const check = await checkContent({ content: s.content, tags: s.tags });
        if (!check.ok) {
          hap.error();
          // 「何をすればいいか」が分かる文言にする (機械的な理由 + 行動指示)
          const userMsg = check.reason
            ? `${check.reason}。内容を確認して修正してください。`
            : '本文に不適切な表現が含まれている可能性があります。内容を確認してください。';
          show(userMsg, 'error');
          // throw して外側の catch/finally を必ず通す (return だと finally がスキップされ
          //   posting が true のまま固着する)。外側 catch では show 済みなので再表示しない。
          throw new Error('__content_policy_abort__');
        }
        setPostPhase('uploading');

        // ★ v2: prefetch 優先 — https 即返し / prefetch await / 無ければ今 upload (欠落ゼロ)。
        const resolveImage = async (uri: string): Promise<string> => {
          if (/^https?:\/\//i.test(uri)) return uri; // 編集由来の温存
          const entry = imageUploadsRef.current.get(uri);
          if (entry && !entry.errored) {
            try {
              return await entry.promise; // 完了/進行中いずれも待つ
            } catch {
              // prefetch 失敗 → 今 upload にフォールバック
            }
          }
          return uploadPostImage(uri, userId);
        };
        const resolveVideo = async (v: {
          uri: string;
          mime: string;
          ext: string;
        }): Promise<string> => {
          if (/^https?:\/\//i.test(v.uri)) return v.uri;
          const entry = videoUploadsRef.current.get(v.uri);
          if (entry && !entry.errored) {
            try {
              return await entry.promise;
            } catch {
              /* fallthrough → 今 upload */
            }
          }
          return uploadPostVideo(v.uri, userId, { mime: v.mime, ext: v.ext });
        };

        [uploadedImageUrls, uploadedVideoUrls] = await Promise.all([
          s.images.length > 0
            ? Promise.all(s.images.map(resolveImage))
            : Promise.resolve<string[]>([]),
          s.video
            ? resolveVideo({ uri: s.video.uri, mime: s.video.mime, ext: s.video.ext }).then((u) => [u])
            : Promise.resolve<string[]>([]),
        ]);
      } catch (e) {
        // ★ content_policy_abort はすでに toast 表示済み — 再表示しない。
        //   それ以外はユーザー向けエラーメッセージに変換して表示する。
        if (!(e instanceof Error && e.message === '__content_policy_abort__')) {
          const msg = e instanceof Error ? e.message : String(e);
          let uploadErrMsg = '画像・動画のアップロードに失敗しました。再度お試しください。';
          if (msg.includes('Network') || msg.includes('Failed to fetch') || msg.includes('Load failed')) {
            uploadErrMsg = '通信エラー。電波を確認してください。';
          }
          show(uploadErrMsg, 'error');
        }
        // throw して外側の finally (setPosting/setPostPhase リセット) を必ず通す。
        throw e;
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

      // ★ コミュ feed 系 cache の invalidate (冪等)。post_communities への attach が
      //   完了した後に呼ぶ専用。onInserted (楽観遷移) は INSERT 直後=attach 前に走るため、
      //   そこで invalidate すると junction 行がまだ無く「新 post 抜き」を refetch して書き戻し、
      //   コミュタブ/詳細に投稿が出ない (反映が遅い) race になる。よってコミュ系は
      //   finishPostSuccess から分離し、createPost(=attach) の await 完了後に必ず実行する。
      const invalidateCommunityCaches = () => {
        void qc.invalidateQueries({ queryKey: ['my-community-feed'] });
        void qc.invalidateQueries({ queryKey: ['my-community-feed-rich'] });
        void qc.invalidateQueries({ queryKey: ['my-communities'] });
        for (const cid of s.selectedCommunityIds) {
          void qc.invalidateQueries({ queryKey: ['community', cid, 'feed'] });
          void qc.invalidateQueries({ queryKey: ['community', cid] });
        }
      };

      // 投稿成功後の共通後始末 (navigate + toast + draft 削除 + feed系invalidate + prefetch Map clear)。
      // onInserted (楽観) からも、従来 await 後からも、同一処理を navigated ガードで1回だけ実行。
      // ※ コミュ系 invalidate は junction 依存なので attach 後に invalidateCommunityCaches() で別途行う。
      const finishPostSuccess = () => {
        if (navigated) return;
        navigated = true;
        hap.success();
        show('投稿しました', 'success');
        {
          const did = usePostDraftStore.getState().draftId;
          if (did) useDraftsStore.getState().remove(did);
        }
        void qc.invalidateQueries({ queryKey: ['feed'] });
        void qc.invalidateQueries({ queryKey: ['feed-page'] }); // ★ 遷移先 feed の RPC cache も更新 (junction 非依存)
        // ★ 4-F: prefetch Map は clear のみ (storage.remove は一切しない=採用済み media を消す race 根絶)。
        imageUploadsRef.current.clear();
        videoUploadsRef.current.clear();
        usePostDraftStore.getState().reset();
        router.replace('/(tabs)/feed' as never);
      };

      // ★ v2: online かつ poll 無し のときだけ楽観的即遷移 (offline/poll は従来同期フロー)。
      const optimisticNav = isOnline() && !pollPayload;

      setPostPhase('saving');
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
        // ★ v2: 楽観遷移が有効な時のみ INSERT 直後に finishPostSuccess (attach/poll は背後)。
        onInserted: optimisticNav ? () => finishPostSuccess() : undefined,
      });

      // ★ attach (post_communities) 完了後に必ず1回コミュ系 cache を invalidate (race 解消)。
      //   楽観経路では遷移は onInserted で済んでおり、ここでは invalidate だけが効く。
      //   invalidateQueries は staleTime を無視して即 refetch するので数百ms で反映される。
      invalidateCommunityCaches();

      // 楽観時は onInserted で実行済み (navigated=true で no-op)。
      // 非楽観 (offline / poll あり) はここで初めて実行 = 従来どおり全 await 後に遷移。
      finishPostSuccess();
    } catch (e: unknown) {
      // content_policy_abort / upload error はすでに toast 表示済み — 再表示しない。
      const isAlreadyShown =
        e instanceof Error &&
        (e.message === '__content_policy_abort__' || e.message.startsWith('__upload_abort__'));
      if (!isAlreadyShown) {
        hap.error();
        const msg = e instanceof Error ? e.message : String(e);
        let userMsg = '投稿に失敗しました。再度お試しください。';
        if (msg.includes('row-level security') || msg.includes('RLS')) userMsg = '権限エラー。ログインし直してください。';
        else if (msg.includes('Not authenticated') || msg.includes('未ログイン')) userMsg = 'ログインし直してください。';
        else if (msg.includes('Network') || msg.includes('Failed to fetch')) userMsg = '通信エラー。電波を確認してください。';
        else if (msg.includes('速すぎ') || msg.includes('時間を置いて') || msg.includes('ペースが')) userMsg = msg;
        else if (msg.includes('コミュニティには投稿できません')) userMsg = msg; // attach 失敗の文言を尊重
        show(userMsg, 'error');
      }
      // ★ v2 ロールバック: 楽観遷移済み(navigated)で attach/poll が throw した場合。
      //   補償 delete は createPost 内部(posts.ts)で実施済 → ここで delete しない(二重delete回避)。
      //   遷移はやり直さず feed を invalidate して「消えた post が残って見える」を最終整合で解消。
      //   既知の限界: refetch が効くまで数百ms〜秒は「消える post」が見え得る(選択済みコミュ宛なのでレア)。
      if (navigated) {
        void qc.invalidateQueries({ queryKey: ['feed'] });
        void qc.invalidateQueries({ queryKey: ['feed-page'] });
        for (const cid of s.selectedCommunityIds) {
          void qc.invalidateQueries({ queryKey: ['community', cid, 'feed'] });
        }
      }
    } finally {
      setPostPhase('idle'); // ★ phase リセット (非楽観失敗時の「投稿中…」固着も解消)
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

        {/* 投稿 pill (1画面で完結)。disabled にはせず「押せない理由」を toast で示す
            (disabled だと onPress が発火せず "押しても無反応" になるため)。見た目は無効化。
            両方欠けている場合は 1 回の toast に集約してユーザーの往復タップを防ぐ。
            有効時は GRAD.primary の gradient pill + 白文字 — 有効⇔無効が一目で分かる。 */}
        <PressableScale
          onPress={canPost ? handlePost : () => {
            const s = usePostDraftStore.getState();
            const noContent = s.content.trim().length === 0 && s.images.length === 0 && !s.video && !editHasVideo;
            const noCommunity = s.selectedCommunityIds.length === 0 && !editId;
            if (noCommunity && noContent) {
              show('コミュニティを選んで、本文・画像・動画のいずれかを入力してください。', 'warn');
            } else if (noCommunity) {
              show('投稿するコミュニティを選んでください。', 'warn');
            } else if (noContent) {
              show('本文・画像・動画のいずれかを入力してください。', 'warn');
            }
          }}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel={editId ? '更新' : '投稿'}
          accessibilityState={{ disabled: !canPost }}
          style={{ borderRadius: R.full, overflow: 'hidden' }}
        >
          {canPost ? (
            <LinearGradient
              colors={GRAD.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ paddingHorizontal: SP['5'], paddingVertical: SP['2'] }}
            >
              <Text style={[T.smallB, { color: '#fff' }]}>
                {posting ? phaseLabel : (editId ? '更新' : '投稿')}
              </Text>
            </LinearGradient>
          ) : (
            <View
              style={{
                paddingHorizontal: SP['5'],
                paddingVertical: SP['2'],
                backgroundColor: C.bg3,
              }}
            >
              <Text style={[T.smallB, { color: C.text3 }]}>
                {posting ? phaseLabel : (editId ? '更新' : '投稿')}
              </Text>
            </View>
          )}
        </PressableScale>
      </View>

      {/* 下書き保存インジケーター — フェードイン/アウトで控えめに表示 */}
      {!editId && (
        <Animated.Text
          style={{
            opacity: draftSavedOpacity,
            fontSize: 12,
            color: C.text3,
            textAlign: 'center',
            paddingVertical: 4,
          }}
          accessibilityLiveRegion="polite"
        >
          下書き保存済み
        </Animated.Text>
      )}

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
              投稿先コミュニティ — 画面の主役 (必須が一目で分かる accent 強調)
              未選択: accent 枠 pill + 人アイコン / 選択済: コミュの icon + 名前を accent 背景で
              ============================================================ */}
          {!editId && (
          <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], gap: SP['2'] }}>
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
                backgroundColor: displayCommunity ? C.accentBg : C.bg2,
                borderWidth: 1.5,
                borderColor: C.accent,
              }}
            >
              {displayCommunity ? (
                <CommunityIcon
                  size={22}
                  iconUrl={displayCommunity.icon_url}
                  iconEmoji={displayCommunity.icon_emoji}
                  iconColor={displayCommunity.icon_color}
                  name={displayCommunity.name}
                />
              ) : (
                <Icon.community size={18} color={C.accent} strokeWidth={2.2} />
              )}
              <Text
                style={[T.smallB, { color: displayCommunity ? C.accent : C.text, flexShrink: 1 }]}
                numberOfLines={1}
              >
                {displayCommunity ? displayCommunity.name : 'コミュニティを選択'}
              </Text>
              <Icon.chevronD size={16} color={C.accent} strokeWidth={2.2} />
            </PressableScale>

            {/* 未選択時だけ「なぜ必要か」を一言で示す caption */}
            {!displayCommunity && (
              <Text style={[T.caption, { color: C.text3 }]}>必須・どのコミュに投稿する？</Text>
            )}

            {/* 最近見たコミュ (参加中のみ・最大5件) — ワンタップで投稿先を選べる横 chips */}
            {recentChips.length > 0 && (
              <View style={{ gap: SP['1'] }}>
                <Text style={[T.caption, { color: C.text3 }]}>最近のコミュ</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ gap: SP['2'], paddingRight: SP['4'] }}
                >
                  {recentChips.map((r) => {
                    const active = selectedCommunityIds[0] === r.id;
                    return (
                      <PressableScale
                        key={r.id}
                        onPress={() => handleToggleCommunity(r.id)}
                        haptic="tap"
                        accessibilityRole="button"
                        accessibilityLabel={
                          active ? `${r.name} の選択を解除` : `${r.name} に投稿する`
                        }
                        accessibilityState={{ selected: active }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingHorizontal: SP['3'],
                          paddingVertical: 6,
                          borderRadius: R.full,
                          backgroundColor: active ? C.accentBg : C.bg2,
                          borderWidth: 1,
                          borderColor: active ? C.accent : C.border,
                        }}
                      >
                        <CommunityIcon
                          size={18}
                          iconUrl={r.icon_url}
                          iconEmoji={r.icon_emoji}
                          iconColor={r.icon_color}
                          name={r.name}
                        />
                        <Text
                          style={[T.smallM, { color: active ? C.accent : C.text2, maxWidth: 140 }]}
                          numberOfLines={1}
                        >
                          {r.name}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </View>
          )}

          {/* (匿名表示行はユーザー要望で撤去 — 投稿は常に匿名のため UI で明示しない 2026-06-12) */}

          {/* ============================================================
              本文 + メディア + タグ — 全幅 1 カラム (旧アバター列を撤去して広く書ける)
              ============================================================ */}
          <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], paddingBottom: SP['6'] }}>

            {/* 本文 — タイトルと本文を分けない単一フィールド (X / Threads 風) */}
            {/* autoFocus: 投稿画面を開いた瞬間にキーボードを出して即タイプ可能にする
                (これが無いと最初の数文字がキーボード起動待ちで取りこぼされる) */}
            <ComposerBodyField
              value={content}
              onChangeText={setContent}
              placeholder={placeholder}
              autoFocus
              onSelectionChange={(sel) => {
                selectionRef.current = sel;
              }}
              inputRef={bodyRef}
            />

            {/* (書き出しヒント chips はユーザー要望で撤去 2026-06-12) */}

            {/* メディアグリッド */}
            {(images.length > 0 || video) && (
              <View style={{ marginTop: SP['3'] }}>
                <ComposerMediaGrid
                  images={images}
                  video={video ? { uri: video.uri, sizeMb: video.size / 1024 / 1024 } : null}
                  onRemoveImage={(index) => setImages(images.filter((_, i) => i !== index))}
                  onRemoveVideo={() => setVideo(null)}
                  onEditImage={editImage}
                  containerPaddingH={0}
                />
              </View>
            )}

            {/* タグ (任意・最大5) — 追加済みは削除可能な chips (#tag ×) で入力欄の上に */}
            <View style={{ marginTop: SP['4'], gap: SP['2'] }}>
              {tags.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                  {tags.map((t) => (
                    <PressableScale
                      key={t}
                      onPress={() => removeTag(t)}
                      haptic="tap"
                      accessibilityLabel={`タグ ${t} を削除`}
                      accessibilityRole="button"
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
                    maxLength={30}
                    style={[T.small, { color: C.text, flex: 1, padding: 0 }]}
                  />
                  {/* タップでも確定できるよう「追加」ボタンを併設 (return キーのみだと不便) */}
                  <PressableScale
                    onPress={addTag}
                    haptic="tap"
                    disabled={!tagInput.trim()}
                    accessibilityLabel="タグを追加"
                    accessibilityState={{ disabled: !tagInput.trim() }}
                    style={{
                      paddingHorizontal: SP['2'],
                      paddingVertical: 4,
                      borderRadius: R.sm,
                      backgroundColor: tagInput.trim() ? C.accent : C.bg3,
                    }}
                  >
                    <Text style={[T.small, { color: tagInput.trim() ? '#fff' : C.text3, fontWeight: '700' }]}>
                      追加
                    </Text>
                  </PressableScale>
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
          onCamera={takePhoto}
          pickingCamera={pickingCamera}
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
        discover={discoverUnjoined}
        joiningIds={joiningIds}
        onJoin={handleJoinAndSelect}
      />
    </View>
  );
}
