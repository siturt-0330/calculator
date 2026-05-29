// ============================================================
// app/post/create.tsx — 匿名 BBS / 議論ベースの投稿コンポーザ
// ------------------------------------------------------------
// 設計 (2026-05-29 rewrite + focused pivot to discussion-board):
//   - Reddit / Mastodon / Lemmy / 2ch 寄りの discussion framing
//   - Threads 風の大型 textarea (auto-grow, 18pt, line-height 1.6)
//   - Instagram 風の水平 thumbnail rail (画像 + 動画 + 追加ボタン)
//   - 本文ベースの auto-tag 提案 (議論カテゴライズ補助)
//   - Reddit 風の visibility cards (水平カルーセル, accent border)
//   - X 風の floating bottom action bar (keyboard 連動で持ち上がる)
//   - Reanimated 3 spring throughout, haptic on key actions
//   - dark / light 両対応 (useColors)
//
// 投稿ロジック (createPost / upload / handler / DB) は完全に維持。
// 並列で G5-G8 が components/post/* を作成中 — 揃えば import に置換可能だが、
// 今は壊さないように **すべて inline 実装**。
//
// AI キャプション提案は意図的に削除 (匿名 BBS の "authentic discussion"
// 原則と矛盾するため。Reddit / Mastodon / Lemmy / Discord forum compose
// にも AI caption は存在しない)。Sparkles アイコンは upload status と
// auto-tag suggestion panel で引き続き使用。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Alert,
  Image,
  Platform,
  StyleSheet,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  Layout,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import {
  Image as ImageIconLucide,
  Film,
  Hash,
  Globe,
  Lock,
  Users2,
  Megaphone,
  Sparkles,
  X as IconX,
  Check as IconCheck,
  ChevronLeft,
  AlertTriangle,
  Link as LinkIcon,
  BarChart3,
  EyeOff,
  Eye,
  Plus as IconPlus,
} from 'lucide-react-native';

import { Icon } from '../../constants/icons';
import { ProgressiveImage } from '../../components/ui/ProgressiveImage';
import { PressableScale } from '../../components/ui/PressableScale';
import { Input } from '../../components/ui/Input';
import { Toggle } from '../../components/ui/Toggle';
import { TagPill } from '../../components/tag/TagPill';
import { TagInputSuggestions } from '../../components/tag/TagInputSuggestions';

import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { hap } from '../../design/haptics';
import { createPost, type PostVisibility } from '../../lib/api/posts';
import {
  fetchCommunity,
  fetchMyCommunities,
  type Community,
} from '../../lib/api/communities';
import { deepNormalize } from '../../lib/search/tokenize';
import { useDebounce } from '../../hooks/useDebounce';
import { useAutoTagSuggest } from '../../hooks/useAutoTagSuggest';
import { checkContent } from '../../lib/ai/checkContent';
import { uploadPostImage, uploadPostVideo, validateVideoSource } from '../../lib/media';

import { SP, R, SIZE, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';
import { SPRING_SNAPPY, SPRING_SOFT, TIMING_NORM } from '../../design/motion';

// ============================================================
// types
// ============================================================
type VisibilityOption = {
  value: PostVisibility;
  label: string;
  desc: string;
  IconComp: typeof Lock;
};

type PickedVideo = { uri: string; mime: string; ext: string; size: number };
type CWCat = 'none' | 'spoiler' | 'nsfw' | 'violence' | 'sensitive';

// ============================================================
// visibility options (Reddit 風 horizontal carousel)
// ============================================================
const VISIBILITY_OPTIONS: VisibilityOption[] = [
  { value: 'private',          label: '自分だけ',     desc: '下書きとして保存',         IconComp: Lock },
  { value: 'public',           label: '一般公開',     desc: 'ホームに公開',             IconComp: Globe },
  { value: 'community_only',   label: 'コミュ限定',   desc: 'メンバーだけに公開',       IconComp: Users2 },
  { value: 'community_public', label: '全員公開',     desc: 'ホーム + コミュニティ',    IconComp: Megaphone },
];

// 入力プレースホルダ候補 (mount ごとにランダム — Reddit / Mastodon 風 discussion framing)
const PLACEHOLDER_POOL: string[] = [
  '何について話したい?',
  'みんなの意見を聞きたいことは?',
  '議論したいトピックを書いてみよう',
  '気になっていることをシェアしよう',
  'みんなで話そう',
];

const CW_OPTIONS: { v: Exclude<CWCat, 'none'>; label: string }[] = [
  { v: 'spoiler', label: 'ネタバレ' },
  { v: 'nsfw', label: 'センシティブ' },
  { v: 'violence', label: '暴力的' },
  { v: 'sensitive', label: '注意' },
];

const DRAFT_KEY = 'geek:post_draft_v1';
const POLL_HOURS_OPTIONS: number[] = [6, 24, 72, 168];

// ============================================================
// CreatePost screen
// ============================================================
export default function CreatePost() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    community_id?: string;
    prefill_tag?: string;
    title?: string;
  }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { show } = useToastStore();
  const C = useColors();

  // -----------------------------------------------------------
  // state
  // -----------------------------------------------------------
  const [images, setImages] = useState<string[]>([]);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const showTitleInput = params.title === '1';
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [sourceUrl, setSourceUrl] = useState('');
  const [posting, setPosting] = useState(false);

  const [visibility, setVisibility] = useState<PostVisibility>('public');

  // visibility が community 系のときだけ表示するコミュニティピッカー
  const [communityQuery, setCommunityQuery] = useState('');
  const debouncedCommunityQuery = useDebounce(communityQuery, 150);
  const [communityResults, setCommunityResults] = useState<Community[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [selectedCommunityIds, setSelectedCommunityIds] = useState<string[]>([]);
  const [selectedCommunities, setSelectedCommunities] = useState<Community[]>([]);
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  const showCommunityPicker =
    visibility === 'community_only' || visibility === 'community_public';

  // CW (content warning)
  const [cwCategory, setCwCategory] = useState<CWCat>('none');
  const [cwText, setCwText] = useState('');
  const [showCw, setShowCw] = useState(false);

  // Poll
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMulti, setPollMulti] = useState(false);
  const [pollHours, setPollHours] = useState<number | null>(24);

  // Source URL (collapsible)
  const [showSourceUrl, setShowSourceUrl] = useState(false);

  // Draft saving indicator
  const [draftSaving, setDraftSaving] = useState(false);

  // -----------------------------------------------------------
  // refs / animations
  // -----------------------------------------------------------
  // mount 時に固定するランダム placeholder
  const placeholder = useMemo<string>(() => {
    const idx = Math.floor(Math.random() * PLACEHOLDER_POOL.length);
    return PLACEHOLDER_POOL[idx] ?? PLACEHOLDER_POOL[0]!;
  }, []);

  // 本文 textarea auto-grow 用 height
  const [composerHeight, setComposerHeight] = useState<number>(160);
  // 本文 focus 状態 → border 色 / glow
  const [composerFocused, setComposerFocused] = useState(false);
  const focusProgress = useSharedValue(0);
  useEffect(() => {
    focusProgress.value = withTiming(composerFocused ? 1 : 0, TIMING_NORM);
  }, [composerFocused, focusProgress]);

  // scroll-driven top header opacity
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  // composer focus glow
  const composerBorderStyle = useAnimatedStyle(() => ({
    borderColor:
      focusProgress.value > 0.5
        ? C.accent
        : 'transparent',
    shadowOpacity:
      Platform.OS === 'web'
        ? 0
        : interpolate(focusProgress.value, [0, 1], [0, 0.25]),
  }));

  // header backdrop opacity (scroll 進むほど濃く)
  const headerBackdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 24, 80], [0, 0.6, 1], 'clamp'),
  }));

  // -----------------------------------------------------------
  // effects — visibility transition
  // -----------------------------------------------------------
  useEffect(() => {
    if (!showCommunityPicker) {
      setSelectedCommunityIds([]);
      setSelectedCommunities([]);
      setCommunityQuery('');
      setCommunityResults([]);
    }
  }, [showCommunityPicker]);

  // mount 時に my communities を 1 回取得
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

  // query で filter
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

  // deep link prefill (community_id / prefill_tag)
  useEffect(() => {
    const cid = typeof params.community_id === 'string' ? params.community_id : undefined;
    const preTag = typeof params.prefill_tag === 'string' ? params.prefill_tag.trim() : '';
    if (preTag) {
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

  // -----------------------------------------------------------
  // 自動タグ提案 (本文 debounce)
  // -----------------------------------------------------------
  const [debouncedContent, setDebouncedContent] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedContent(content), 600);
    return () => clearTimeout(t);
  }, [content]);
  const autoTagSuggestions = useAutoTagSuggest(debouncedContent, tags, 6);

  // -----------------------------------------------------------
  // 下書き自動保存
  // -----------------------------------------------------------
  const draftRestored = useRef(false);
  useEffect(() => {
    if (draftRestored.current) return;
    draftRestored.current = true;
    void AsyncStorage.getItem(DRAFT_KEY).then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw) as {
          content?: string;
          tags?: string[];
          sourceUrl?: string;
          anonymous?: boolean;
          visibility?: PostVisibility;
        };
        const hasContent =
          (d.content && d.content.trim().length > 0) ||
          (d.tags && d.tags.length > 0) ||
          (d.sourceUrl && d.sourceUrl.length > 0);
        if (!hasContent) return;
        setContent(d.content ?? '');
        setTags(d.tags ?? []);
        setSourceUrl(d.sourceUrl ?? '');
        setAnonymous(d.anonymous ?? true);
        setVisibility((d.visibility ?? 'public') as PostVisibility);
        show('下書きを復元しました', 'info', {
          undoLabel: '破棄',
          onUndo: () => {
            setContent('');
            setTags([]);
            setSourceUrl('');
            setAnonymous(true);
            setVisibility('public');
            void AsyncStorage.removeItem(DRAFT_KEY);
          },
        });
      } catch {
        // 壊れた draft は無視
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 変更があるたびに draft を保存 (debounce 500ms)
  useEffect(() => {
    const hasContent = content.trim() || tags.length > 0 || sourceUrl.trim();
    if (!hasContent) {
      void AsyncStorage.removeItem(DRAFT_KEY);
      return;
    }
    setDraftSaving(true);
    const t = setTimeout(() => {
      void AsyncStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ content, tags, sourceUrl, anonymous, visibility }),
      ).finally(() => {
        setDraftSaving(false);
      });
    }, 500);
    return () => clearTimeout(t);
  }, [content, tags, sourceUrl, anonymous, visibility]);

  // -----------------------------------------------------------
  // pickers
  // -----------------------------------------------------------
  const [pickingImage, setPickingImage] = useState(false);
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

  const [pickingVideo, setPickingVideo] = useState(false);
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
  // tag handlers
  // -----------------------------------------------------------
  const handleAddTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t) return;
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

  // -----------------------------------------------------------
  // community handlers
  // -----------------------------------------------------------
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

  // -----------------------------------------------------------
  // submit
  // -----------------------------------------------------------
  const onPost = async () => {
    if (posting) return;
    if (images.length === 0 && !video && !content.trim()) {
      show('画像・動画・テキストのいずれかを入力してください。', 'warn');
      return;
    }
    if (tags.length === 0) {
      show('タグを1つ以上追加してください。', 'warn');
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

      const userId = useAuthStore.getState().user?.id;
      if (!userId) {
        show('ログインし直してください', 'error');
        return;
      }

      // 1) 画像 upload (並列)
      let uploadedImageUrls: string[] = [];
      if (images.length > 0) {
        setUploadStatus(`画像 ${images.length} 枚をアップロード中…`);
        try {
          uploadedImageUrls = await Promise.all(
            images.map((uri) => uploadPostImage(uri, userId)),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          show(msg, 'error');
          return;
        }
      }

      // 2) 動画 upload (1 本)
      let uploadedVideoUrls: string[] = [];
      if (video) {
        const sizeMb = (video.size / 1024 / 1024).toFixed(1);
        setUploadStatus(`動画 (${sizeMb}MB) をアップロード中…`);
        try {
          const url = await uploadPostVideo(video.uri, userId, {
            mime: video.mime,
            ext: video.ext,
          });
          uploadedVideoUrls = [url];
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          show(msg, 'error');
          return;
        }
      }

      setUploadStatus('投稿を作成中…');
      const validOptions = pollOptions.filter((o) => o.trim());
      const pollPayload =
        showPoll && pollQuestion.trim() && validOptions.length >= 2
          ? {
              question: pollQuestion,
              options: validOptions,
              multiSelect: pollMulti,
              expiresInHours: pollHours ?? undefined,
            }
          : undefined;
      const isPublic = visibility !== 'private';
      await createPost({
        content,
        title: showTitleInput ? (title.trim() || null) : null,
        mediaUris: uploadedImageUrls,
        videoUris: uploadedVideoUrls,
        videoDurations: [],
        videoPosters: [],
        tagNames: tags,
        isAnonymous: anonymous,
        sourceUrl: sourceUrl.trim() || null,
        isPublic,
        contentWarning: cwCategory !== 'none' ? (cwText.trim() || null) : null,
        cwCategory: cwCategory !== 'none' ? cwCategory : null,
        poll: pollPayload,
        visibility,
        community_ids:
          visibility === 'community_only' || visibility === 'community_public'
            ? selectedCommunityIds
            : [],
      });
      hap.success();
      show('投稿しました', 'success');
      void AsyncStorage.removeItem(DRAFT_KEY);
      void qc.invalidateQueries({ queryKey: ['my-community-feed'] });
      void qc.invalidateQueries({ queryKey: ['my-communities'] });
      for (const cid of selectedCommunityIds) {
        void qc.invalidateQueries({ queryKey: ['community', cid, 'feed'] });
        void qc.invalidateQueries({ queryKey: ['community', cid] });
      }
      void qc.invalidateQueries({ queryKey: ['feed'] });
      router.back();
    } catch (e: unknown) {
      hap.error();
      const msg =
        e instanceof Error
          ? e.message
          : e !== null && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : String(e);
      console.warn('post create failed:', msg);
      let userMsg = '投稿に失敗しました。再度お試しください。';
      if (msg.includes('row-level security') || msg.includes('RLS')) {
        userMsg = '権限エラー。ログインし直してください。';
      } else if (msg.includes('Not authenticated') || msg.includes('未ログイン')) {
        userMsg = 'ログインし直してください。';
      } else if (msg.includes('Network') || msg.includes('Failed to fetch') || msg.includes('ネットワーク')) {
        userMsg = '通信エラー。電波を確認してください。';
      } else if (msg.includes('check') || msg.includes('constraint')) {
        userMsg = '入力内容を確認してください。';
      } else if (msg.includes('速すぎ') || msg.includes('時間を置いて') || msg.includes('ペースが')) {
        userMsg = msg;
      }
      show(userMsg, 'error');
    } finally {
      setPosting(false);
      setUploadStatus(null);
    }
  };

  // -----------------------------------------------------------
  // derived
  // -----------------------------------------------------------
  const submitBlockedReason = (() => {
    if (!content.trim() && images.length === 0 && !video)
      return '本文・画像・動画 のいずれかを入力してください';
    if (tags.length === 0) return 'タグを 1 つ以上 追加してください';
    if (
      (visibility === 'community_only' || visibility === 'community_public') &&
      selectedCommunityIds.length < 1
    )
      return '投稿先コミュニティを選んでください';
    return null;
  })();

  const charCount = content.length;
  const charCountColor =
    charCount >= 1900 ? C.red : charCount >= 1700 ? C.amber : C.text3;

  // -----------------------------------------------------------
  // render
  // -----------------------------------------------------------
  const onComposerContentSize = (
    e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>,
  ) => {
    const h = e.nativeEvent.contentSize.height;
    if (Number.isFinite(h)) {
      // 160pt 最小、上限なし — auto-grow
      setComposerHeight(Math.max(160, Math.min(h + 24, 480)));
    }
  };

  const canPost = !posting && !submitBlockedReason;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ===== sticky top header (blur backdrop, scroll-reactive) ===== */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          paddingTop: insets.top,
        }}
        pointerEvents="box-none"
      >
        {/* backdrop blur + bg — scroll に応じて opacity */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, headerBackdropStyle]}
        >
          {Platform.OS === 'web' ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: C.bg + 'D9',
                  // CSS backdrop-filter は inline で型安全に追加
                  ...(Platform.OS === 'web'
                    ? ({
                        backdropFilter: 'blur(20px) saturate(180%)',
                        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                      } as object)
                    : {}),
                },
              ]}
            />
          ) : (
            <BlurView
              intensity={80}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          )}
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: StyleSheet.hairlineWidth,
              backgroundColor: C.border,
            }}
          />
        </Animated.View>

        <View
          style={{
            height: SIZE.topBar,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: SP['3'],
            gap: SP['2'],
          }}
        >
          {/* back (chevron left) */}
          <PressableScale
            onPress={() => router.back()}
            haptic="tap"
            hitSlop={12}
            accessibilityLabel="戻る"
            style={{
              width: 44,
              height: 44,
              alignItems: 'flex-start',
              justifyContent: 'center',
              marginLeft: -SP['2'],
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ChevronLeft size={28} color={C.text} strokeWidth={2.4} />
            </View>
          </PressableScale>

          {/* title (centered, subtle) */}
          <Text
            style={[T.h4, { color: C.text, flex: 1, textAlign: 'center' }]}
            numberOfLines={1}
          >
            新しい投稿
          </Text>

          {/* draft saving hint */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
            }}
          >
            {draftSaving && (
              <Animated.Text
                entering={FadeIn.duration(150)}
                exiting={FadeOut.duration(150)}
                style={[T.caption, { color: C.text3 }]}
              >
                保存中…
              </Animated.Text>
            )}

            {/* primary "投稿" button — gradient or disabled */}
            <PrimaryPostButton
              loading={posting}
              disabled={!canPost}
              onPress={onPost}
            />
          </View>
        </View>
      </View>

      {/* ===== main scroll area ===== */}
      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + SIZE.topBar + SP['3'],
          paddingHorizontal: SP['4'],
          paddingBottom: insets.bottom + 96 + SP['8'],
          gap: SP['5'],
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== title (only for thread-mode) ===== */}
        {showTitleInput && (
          <Animated.View entering={FadeInDown.duration(200)} style={{ gap: SP['2'] }}>
            <Input
              placeholder="タイトル (50 文字まで)"
              value={title}
              onChangeText={setTitle}
              maxLength={80}
              showCounter
            />
          </Animated.View>
        )}

        {/* ===== composer (Threads/X 風 hero textarea) ===== */}
        <Animated.View
          style={[
            {
              backgroundColor: C.bg2,
              borderRadius: R.xl,
              borderWidth: 1.5,
              borderColor: C.border,
              padding: SP['4'],
              minHeight: composerHeight + 24,
              shadowColor: C.accent,
              shadowOffset: { width: 0, height: 0 },
              shadowRadius: 16,
              shadowOpacity: 0,
            },
            composerBorderStyle,
            Platform.OS === 'web' && composerFocused
              ? ({ boxShadow: `0 0 0 4px ${C.accent}26` } as object)
              : null,
          ]}
        >
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder={placeholder}
            placeholderTextColor={C.text3}
            multiline
            scrollEnabled={false}
            autoFocus
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onContentSizeChange={onComposerContentSize}
            maxLength={2000}
            selectionColor={C.accent}
            cursorColor={C.accent}
            textAlignVertical="top"
            style={{
              fontSize: 18,
              lineHeight: 28,
              color: C.text,
              fontWeight: '400',
              minHeight: 160,
              padding: 0,
              textAlignVertical: 'top',
              fontFamily: Platform.select({
                ios: 'System',
                android: 'NotoSansJP_400Regular',
                web: '-apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif',
                default: 'NotoSansJP_400Regular',
              }) as string,
            }}
          />

          {/* media rail (Instagram 風 horizontal thumbnails) */}
          {(images.length > 0 || video) && (
            <Animated.View
              entering={FadeInDown.duration(180)}
              layout={Layout.springify().damping(20)}
              style={{ marginTop: SP['3'] }}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: SP['2'] }}
              >
                {images.map((uri, idx) => (
                  <ImageThumb
                    key={uri}
                    uri={uri}
                    index={images.length > 1 ? idx + 1 : null}
                    onRemove={() =>
                      setImages(images.filter((u) => u !== uri))
                    }
                    C={C}
                  />
                ))}
                {video && (
                  <VideoThumb
                    sizeMb={video.size / 1024 / 1024}
                    onRemove={() => setVideo(null)}
                    C={C}
                  />
                )}
              </ScrollView>
            </Animated.View>
          )}

          {/* footer row: char counter */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              marginTop: SP['3'],
            }}
          >
            <View style={{ flex: 1 }} />
            {charCount > 0 && (
              <Animated.Text
                entering={FadeIn.duration(150)}
                style={[T.caption, { color: charCountColor, fontVariant: ['tabular-nums'] }]}
              >
                {charCount} / 2000
              </Animated.Text>
            )}
          </View>
        </Animated.View>

        {/* ===== upload status (大きい動画用) ===== */}
        {uploadStatus && (
          <Animated.View
            entering={FadeInDown.duration(180)}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{
              paddingHorizontal: SP['3'],
              paddingVertical: SP['2'],
              backgroundColor: C.accentBg,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.accentSoft,
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
            }}
          >
            <Sparkles size={14} color={C.accentLight} strokeWidth={2.4} />
            <Text style={[T.caption, { color: C.accentLight, flex: 1 }]}>
              {uploadStatus}
            </Text>
          </Animated.View>
        )}

        {/* ===== tags section (TikTok 風 inline chips) ===== */}
        <SectionBlock C={C}>
          <SectionHeader
            title="タグ"
            required
            countText={`${tags.length} / 5`}
            countWarn={tags.length >= 5}
            C={C}
          />
          <Text style={[T.caption, { color: C.text3 }]}>
            関連する話題のタグで、見つけてもらいやすくしよう
          </Text>

          {/* 選択済みタグ chips (横スクロール) */}
          {tags.length > 0 && (
            <Animated.View
              entering={FadeInDown.duration(180)}
              layout={Layout.springify().damping(20)}
              style={{ marginTop: SP['1'] }}
            >
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                {tags.map((t) => (
                  <TagPill
                    key={t}
                    name={t}
                    state="liked"
                    onPress={() => removeTag(t)}
                  />
                ))}
              </View>
            </Animated.View>
          )}

          {/* auto-tag suggestions (AI 推測) */}
          {autoTagSuggestions.length > 0 && tags.length < 5 && (
            <Animated.View
              entering={FadeInDown.duration(220)}
              layout={Layout.springify().damping(20)}
              style={{
                marginTop: SP['2'],
                padding: SP['3'],
                backgroundColor: C.accentBg,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.accentSoft,
                gap: SP['2'],
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Sparkles size={13} color={C.accentLight} strokeWidth={2.4} />
                <Text style={[T.caption, { color: C.accentLight, fontWeight: '700', flex: 1 }]}>
                  本文から提案 ({autoTagSuggestions.length})
                </Text>
                <Text style={[T.caption, { color: C.text3, fontSize: 10 }]}>
                  タップで追加
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
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
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: SP['3'],
                      paddingVertical: 6,
                      backgroundColor: C.accent + '26',
                      borderRadius: R.full,
                      borderWidth: 1,
                      borderColor: C.accent + '66',
                    }}
                  >
                    <IconPlus size={11} color={C.accentLight} strokeWidth={2.6} />
                    <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
                      {s.tag}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </Animated.View>
          )}

          {/* tag input + 追加 button */}
          {tags.length < 5 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginTop: SP['2'] }}>
              <View style={{ flex: 1 }}>
                <Input
                  placeholder="タグを追加 (例: ポケモン)"
                  value={tagInput}
                  onChangeText={setTagInput}
                  onSubmitEditing={handleAddTag}
                  returnKeyType="done"
                  icon={Hash}
                />
              </View>
              <PressableScale
                onPress={handleAddTag}
                haptic="select"
                disabled={!tagInput.trim()}
                accessibilityLabel="タグを追加"
                style={{
                  height: 48,
                  paddingHorizontal: SP['4'],
                  borderRadius: R.md,
                  backgroundColor: tagInput.trim() ? C.accent : C.bg3,
                  borderWidth: 1,
                  borderColor: tagInput.trim() ? C.accent : C.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <IconPlus
                  size={16}
                  color={tagInput.trim() ? '#fff' : C.text3}
                  strokeWidth={2.6}
                />
                <Text
                  style={{
                    color: tagInput.trim() ? '#fff' : C.text3,
                    fontWeight: '700',
                    fontSize: 14,
                  }}
                >
                  追加
                </Text>
              </PressableScale>
            </View>
          )}

          {/* リアルタイム類似タグ提案 */}
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
        </SectionBlock>

        {/* ===== visibility (Reddit 風 horizontal carousel) ===== */}
        <SectionBlock C={C}>
          <SectionHeader title="公開範囲" required C={C} />
          <Text style={[T.caption, { color: C.text3 }]}>
            だれに見せる投稿か。後から変更できません
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: SP['2'], paddingVertical: SP['1'], paddingRight: SP['4'] }}
          >
            {VISIBILITY_OPTIONS.map((opt) => (
              <VisibilityCard
                key={opt.value}
                option={opt}
                active={visibility === opt.value}
                onPress={() => {
                  setVisibility(opt.value);
                  hap.select();
                }}
                C={C}
              />
            ))}
          </ScrollView>
        </SectionBlock>

        {/* ===== community picker (visibility が community 系のみ) ===== */}
        {showCommunityPicker && (
          <Animated.View
            entering={FadeInDown.duration(220)}
            layout={Layout.springify().damping(20)}
          >
            <SectionBlock C={C}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                <Users2 size={14} color={C.text2} strokeWidth={2.4} />
                <Text style={[T.smallB, { color: C.text2, flex: 1 }]}>
                  コミュニティを選ぶ (複数選択可)
                </Text>
                {selectedCommunityIds.length > 0 && (
                  <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>
                    {selectedCommunityIds.length} 件選択中
                  </Text>
                )}
              </View>

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
                        backgroundColor: C.accent + '26',
                        borderWidth: 1,
                        borderColor: C.accent,
                      }}
                    >
                      <View
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 9,
                          backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                        }}
                      >
                        {c.icon_url ? (
                          <Image
                            source={{ uri: c.icon_url }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                          />
                        ) : (
                          <Text style={{ fontSize: 11 }}>{c.icon_emoji}</Text>
                        )}
                      </View>
                      <Text
                        style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}
                        numberOfLines={1}
                      >
                        {c.name}
                      </Text>
                      <IconX size={12} color={C.accentLight} strokeWidth={2.6} />
                    </PressableScale>
                  ))}
                </View>
              )}

              <Input
                placeholder="参加中のコミュニティを検索"
                value={communityQuery}
                onChangeText={setCommunityQuery}
                icon={Icon.search}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View
                style={{
                  backgroundColor: C.bg3,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  overflow: 'hidden',
                }}
              >
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
                          backgroundColor: isSelected ? C.accent + '1F' : 'transparent',
                          borderTopWidth: idx === 0 ? 0 : 1,
                          borderTopColor: C.divider,
                        }}
                      >
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                          }}
                        >
                          {c.icon_url ? (
                            <Image
                              source={{ uri: c.icon_url }}
                              style={{ width: '100%', height: '100%' }}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={{ fontSize: 18 }}>{c.icon_emoji}</Text>
                          )}
                        </View>
                        <View style={{ flex: 1, gap: 1 }}>
                          <Text
                            style={[T.bodyMd, { color: C.text, fontWeight: '700' }]}
                            numberOfLines={1}
                          >
                            {c.name}
                          </Text>
                          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                            メンバー {c.member_count.toLocaleString('ja-JP')} 人
                          </Text>
                        </View>
                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            borderWidth: isSelected ? 0 : 1.5,
                            borderColor: C.border2,
                            backgroundColor: isSelected ? C.accent : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isSelected && (
                            <IconCheck size={14} color="#fff" strokeWidth={2.8} />
                          )}
                        </View>
                      </PressableScale>
                    );
                  })
                )}
              </View>
            </SectionBlock>
          </Animated.View>
        )}

        {/* ===== 投票 (collapsible) ===== */}
        <CollapsibleSection
          IconComp={BarChart3}
          title="投票を追加"
          desc={
            showPoll
              ? '質問と選択肢を入力 (下) ・最大 6 個'
              : 'みんなに聞いてみたいことがあれば'
          }
          open={showPoll}
          onToggle={() => {
            setShowPoll((v) => !v);
            hap.tap();
          }}
          C={C}
        >
          <View
            style={{
              padding: SP['3'],
              backgroundColor: C.bg3,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['2'],
            }}
          >
            <Input
              placeholder="質問 (例: 鬼滅で一番強い柱は?)"
              value={pollQuestion}
              onChangeText={setPollQuestion}
              maxLength={200}
            />
            {pollOptions.map((opt, i) => (
              <View
                key={`poll-${i}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}
              >
                <Text style={[T.caption, { color: C.text3, width: 18 }]}>{i + 1}.</Text>
                <View style={{ flex: 1 }}>
                  <Input
                    placeholder={`選択肢 ${i + 1}`}
                    value={opt}
                    onChangeText={(v) =>
                      setPollOptions(pollOptions.map((o, j) => (j === i ? v : o)))
                    }
                    maxLength={80}
                  />
                </View>
                {pollOptions.length > 2 && (
                  <PressableScale
                    onPress={() =>
                      setPollOptions(pollOptions.filter((_, j) => j !== i))
                    }
                    haptic="warn"
                    style={{ padding: 4 }}
                    accessibilityLabel="選択肢を削除"
                  >
                    <IconX size={14} color={C.text3} strokeWidth={2.4} />
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
                  paddingHorizontal: SP['3'],
                  paddingVertical: 4,
                  borderRadius: R.full,
                  backgroundColor: C.bg2,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Text style={[T.caption, { color: C.text2 }]}>+ 選択肢を追加</Text>
              </PressableScale>
            )}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                marginTop: SP['1'],
                flexWrap: 'wrap',
              }}
            >
              <PressableScale
                onPress={() => setPollMulti((v) => !v)}
                haptic="select"
                style={{
                  paddingHorizontal: SP['2'],
                  paddingVertical: 4,
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
              {POLL_HOURS_OPTIONS.map((h) => (
                <PressableScale
                  key={h}
                  onPress={() => setPollHours(h)}
                  haptic="select"
                  style={{
                    paddingHorizontal: SP['2'],
                    paddingVertical: 4,
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
        </CollapsibleSection>

        {/* ===== コンテンツ警告 (CW) ===== */}
        <CollapsibleSection
          IconComp={AlertTriangle}
          title="コンテンツ警告 (CW)"
          desc={
            showCw
              ? cwCategory !== 'none'
                ? `現在: ${
                    cwCategory === 'spoiler'
                      ? 'ネタバレ'
                      : cwCategory === 'nsfw'
                        ? 'センシティブ'
                        : cwCategory === 'violence'
                          ? '暴力的'
                          : '注意'
                  }`
                : 'カテゴリを選択 (下)'
              : 'ネタバレ・センシティブ等を含む場合'
          }
          open={showCw}
          accent={C.amber}
          onToggle={() => {
            const next = !showCw;
            setShowCw(next);
            if (!next) setCwCategory('none');
            hap.tap();
          }}
          C={C}
        >
          <View style={{ gap: SP['2'] }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {CW_OPTIONS.map((opt) => {
                const active = cwCategory === opt.v;
                return (
                  <PressableScale
                    key={opt.v}
                    onPress={() => setCwCategory(active ? 'none' : opt.v)}
                    haptic="select"
                    style={{
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['2'],
                      borderRadius: R.full,
                      backgroundColor: active ? C.amberBg : C.bg3,
                      borderWidth: 1.5,
                      borderColor: active ? C.amber : C.border,
                    }}
                  >
                    <Text style={[T.smallM, { color: active ? C.amber : C.text2 }]}>
                      {opt.label}
                    </Text>
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
        </CollapsibleSection>

        {/* ===== 出典 URL (collapsible) ===== */}
        <CollapsibleSection
          IconComp={LinkIcon}
          title="出典 URL を追加"
          desc={sourceUrl ? sourceUrl : '記事・配信・ソースへのリンク (任意)'}
          open={showSourceUrl}
          onToggle={() => {
            setShowSourceUrl((v) => !v);
            hap.tap();
          }}
          C={C}
        >
          <Input
            placeholder="https://..."
            value={sourceUrl}
            onChangeText={setSourceUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={2048}
          />
        </CollapsibleSection>

        {/* ===== 匿名トグル ===== */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['3'],
            padding: SP['4'],
            borderRadius: R.lg,
            backgroundColor: C.bg2,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: anonymous ? C.accent + '26' : C.bg3,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {anonymous ? (
              <EyeOff size={20} color={C.accentLight} strokeWidth={2.2} />
            ) : (
              <Eye size={20} color={C.text2} strokeWidth={2.2} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.bodyB, { color: C.text }]}>匿名で投稿</Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              {anonymous
                ? '誰が投稿したか他のユーザーには分かりません'
                : 'プロフィールに紐付けて公開します'}
            </Text>
          </View>
          <Toggle value={anonymous} onChange={setAnonymous} />
        </View>

        {/* ===== 投稿不可の理由 (inline) ===== */}
        {submitBlockedReason &&
          (content.length > 0 || images.length > 0 || tags.length > 0) && (
            <Animated.View
              entering={FadeIn.duration(180)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'],
                backgroundColor: C.amberBg,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.amber + '40',
              }}
            >
              <AlertTriangle size={14} color={C.amber} strokeWidth={2.4} />
              <Text
                style={[T.caption, { color: C.amber, fontWeight: '600', flex: 1 }]}
              >
                {submitBlockedReason}
              </Text>
            </Animated.View>
          )}
      </Animated.ScrollView>

      {/* ===== floating bottom action bar (X 風) ===== */}
      <FloatingActionBar
        bottomInset={insets.bottom}
        onPickImage={pickImage}
        onPickVideo={pickVideo}
        onFocusTag={() => {
          // タグ入力欄は scroll で見える位置にある — 単に haptic で反応を返す
          hap.tap();
        }}
        pickingImage={pickingImage}
        pickingVideo={pickingVideo}
        imagesFull={images.length >= 4}
        hasVideo={!!video}
        C={C}
      />
    </View>
  );
}

// ============================================================
// sub components (inline)
// ============================================================

// ----- PrimaryPostButton (top-right gradient CTA) -----
function PrimaryPostButton({
  loading,
  disabled,
  onPress,
}: {
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const C = useColors();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = () => {
    if (disabled || loading) return;
    scale.value = withSpring(0.94, SPRING_SNAPPY);
  };
  const onPressOut = () => {
    if (disabled || loading) return;
    scale.value = withSpring(1, SPRING_SNAPPY);
  };

  return (
    <Animated.View style={animStyle}>
      <PressableScale
        onPress={loading || disabled ? undefined : onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        haptic="confirm"
        disabled={loading || disabled}
        accessibilityLabel="投稿する"
        scaleValue={1}
        style={{
          height: 36,
          minWidth: 72,
          borderRadius: R.full,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : 1,
          ...(!disabled ? SHADOW.accentGlow : {}),
        }}
      >
        <LinearGradient
          colors={[C.accent, C.accentDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: SP['4'],
          }}
        >
          <Text
            style={{
              color: '#fff',
              fontWeight: '700',
              fontSize: 14,
              letterSpacing: 0.2,
            }}
          >
            {loading ? '送信中…' : '投稿'}
          </Text>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

// ----- SectionBlock (wrapper card) -----
function SectionBlock({
  children,
  C,
}: {
  children: React.ReactNode;
  C: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={{
        gap: SP['2'],
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      {children}
    </View>
  );
}

// ----- SectionHeader -----
function SectionHeader({
  title,
  required,
  countText,
  countWarn,
  C,
}: {
  title: string;
  required?: boolean;
  countText?: string;
  countWarn?: boolean;
  C: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SP['1'] }}>
      <Text style={[T.smallB, { color: C.text }]}>{title}</Text>
      {required && <Text style={[T.caption, { color: C.red }]}>*</Text>}
      <View style={{ flex: 1 }} />
      {countText && (
        <Text style={[T.caption, { color: countWarn ? C.amber : C.text3 }]}>
          {countText}
        </Text>
      )}
    </View>
  );
}

// ----- ImageThumb -----
function ImageThumb({
  uri,
  index,
  onRemove,
  C,
}: {
  uri: string;
  index: number | null;
  onRemove: () => void;
  C: ReturnType<typeof useColors>;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={Layout.springify().damping(20)}
      style={{ position: 'relative' }}
    >
      <ProgressiveImage uri={uri} width={88} height={88} radius={14} />
      {index !== null && (
        <View
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: R.full,
            backgroundColor: 'rgba(0,0,0,0.75)',
          }}
        >
          <Text style={{ fontSize: 10, color: '#fff', fontWeight: '700' }}>
            {index}
          </Text>
        </View>
      )}
      <PressableScale
        onPress={onRemove}
        haptic="warn"
        hitSlop={10}
        accessibilityLabel="画像を削除"
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
        <IconX size={14} color={C.text} strokeWidth={2.6} />
      </PressableScale>
    </Animated.View>
  );
}

// ----- VideoThumb -----
function VideoThumb({
  sizeMb,
  onRemove,
  C,
}: {
  sizeMb: number;
  onRemove: () => void;
  C: ReturnType<typeof useColors>;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={Layout.springify().damping(20)}
      style={{ position: 'relative' }}
    >
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: 14,
          backgroundColor: '#000',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        }}
      >
        <Film size={28} color="#fff" strokeWidth={2.2} />
        <View
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: R.full,
            backgroundColor: 'rgba(0,0,0,0.75)',
          }}
        >
          <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>
            {sizeMb > 0 ? `${sizeMb.toFixed(1)}MB` : '動画'}
          </Text>
        </View>
      </View>
      <PressableScale
        onPress={onRemove}
        haptic="warn"
        hitSlop={10}
        accessibilityLabel="動画を削除"
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
        <IconX size={14} color={C.text} strokeWidth={2.6} />
      </PressableScale>
    </Animated.View>
  );
}

// ----- VisibilityCard (Reddit 風 carousel item) -----
function VisibilityCard({
  option,
  active,
  onPress,
  C,
}: {
  option: VisibilityOption;
  active: boolean;
  onPress: () => void;
  C: ReturnType<typeof useColors>;
}) {
  const I = option.IconComp;
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  useEffect(() => {
    scale.value = withSpring(active ? 1.0 : 0.98, SPRING_SOFT);
  }, [active, scale]);

  return (
    <Animated.View style={animStyle}>
      <PressableScale
        onPress={onPress}
        haptic="select"
        scaleValue={0.97}
        accessibilityLabel={`${option.label}: ${option.desc}`}
        accessibilityState={{ selected: active }}
        style={{
          width: 152,
          padding: SP['3'],
          borderRadius: R.lg,
          backgroundColor: active ? C.accent + '1F' : C.bg2,
          borderWidth: 1.5,
          borderColor: active ? C.accent : C.border,
          gap: SP['1'],
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 2,
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: active ? C.accent : C.bg3,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <I
              size={16}
              color={active ? '#fff' : C.text2}
              strokeWidth={2.2}
            />
          </View>
          {active && (
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                backgroundColor: C.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconCheck size={12} color="#fff" strokeWidth={3} />
            </View>
          )}
        </View>
        <Text
          style={[T.smallB, { color: active ? C.accentLight : C.text }]}
          numberOfLines={1}
        >
          {option.label}
        </Text>
        <Text
          style={[T.caption, { color: C.text3, fontSize: 11, lineHeight: 14 }]}
          numberOfLines={2}
        >
          {option.desc}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

// ----- CollapsibleSection (poll / CW / sourceUrl で共通) -----
function CollapsibleSection({
  IconComp,
  title,
  desc,
  open,
  onToggle,
  children,
  accent,
  C,
}: {
  IconComp: typeof BarChart3;
  title: string;
  desc: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  accent?: string;
  C: ReturnType<typeof useColors>;
}) {
  const a = accent ?? C.accent;
  return (
    <View style={{ gap: SP['2'] }}>
      <PressableScale
        onPress={onToggle}
        haptic="tap"
        scaleValue={0.99}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          paddingHorizontal: SP['3'],
          paddingVertical: SP['3'],
          borderRadius: R.md,
          backgroundColor: open ? a + '14' : C.bg2,
          borderWidth: 1,
          borderColor: open ? a : C.border,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: open ? a + '33' : C.bg3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconComp
            size={16}
            color={open ? a : C.text2}
            strokeWidth={2.2}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[T.smallB, { color: open ? a : C.text }]}>{title}</Text>
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
            {desc}
          </Text>
        </View>
        <Text
          style={[T.caption, { color: open ? a : C.text3, fontWeight: '700' }]}
        >
          {open ? '閉じる' : '＋ 追加'}
        </Text>
      </PressableScale>
      {open && (
        <Animated.View
          entering={FadeInDown.duration(220)}
          layout={Layout.springify().damping(20)}
        >
          {children}
        </Animated.View>
      )}
    </View>
  );
}

// ----- FloatingActionBar (X 風 keyboard-aware bottom bar) -----
function FloatingActionBar({
  bottomInset,
  onPickImage,
  onPickVideo,
  onFocusTag,
  pickingImage,
  pickingVideo,
  imagesFull,
  hasVideo,
  C,
}: {
  bottomInset: number;
  onPickImage: () => void;
  onPickVideo: () => void;
  onFocusTag: () => void;
  pickingImage: boolean;
  pickingVideo: boolean;
  imagesFull: boolean;
  hasVideo: boolean;
  C: ReturnType<typeof useColors>;
}) {
  // ※ KeyboardAvoidingView を bar 全体に当てると scroll content と競合するため、
  //    bar 単体を absolute で保持し、KeyboardAware で持ち上げる代わりに
  //    bottomInset を尊重するだけのシンプル実装。keyboard 表示時は OS が
  //    composer のスクロール位置を調整する。
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: bottomInset > 0 ? bottomInset : SP['3'],
        paddingTop: SP['2'],
        paddingHorizontal: SP['4'],
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          padding: SP['2'],
          backgroundColor: C.bg2 + 'F2',
          borderRadius: R.full,
          borderWidth: 1,
          borderColor: C.border,
          ...SHADOW.card,
          ...(Platform.OS === 'web'
            ? ({
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
              } as object)
            : {}),
        }}
      >
        <ActionIcon
          IconComp={ImageIconLucide}
          label="画像"
          onPress={onPickImage}
          loading={pickingImage}
          disabled={imagesFull}
          C={C}
        />
        <ActionIcon
          IconComp={Film}
          label="動画"
          onPress={onPickVideo}
          loading={pickingVideo}
          disabled={hasVideo}
          C={C}
        />
        <ActionIcon
          IconComp={Hash}
          label="タグ"
          onPress={onFocusTag}
          C={C}
        />
        <View style={{ flex: 1 }} />
      </View>
    </View>
  );
}

// ----- ActionIcon (floating bar 用 icon button) -----
function ActionIcon({
  IconComp,
  label,
  onPress,
  loading,
  disabled,
  accent,
  C,
}: {
  IconComp: typeof ImageIconLucide;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  accent?: boolean;
  C: ReturnType<typeof useColors>;
}) {
  const color = disabled ? C.text4 : accent ? C.accentLight : C.text;
  const bg = disabled
    ? 'transparent'
    : accent
      ? C.accent + '1F'
      : 'transparent';
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      disabled={disabled || loading}
      accessibilityLabel={label}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: loading ? 0.6 : 1,
      }}
    >
      <IconComp size={20} color={color} strokeWidth={2.2} />
    </PressableScale>
  );
}
