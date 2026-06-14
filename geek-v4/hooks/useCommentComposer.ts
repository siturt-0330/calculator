// ============================================================
// useCommentComposer — インラインコメント/返信コンポーザーの状態と操作
// ============================================================
// PostDetailScreen から抽出した状態:
//   - replyTarget, commentText, images, video
//   - posting, pickingImage, pickingVideo, composerActive
//   - composerRef, canPost
// 操作:
//   - handleReply(comment)   返信モードにしてフォーカス
//   - pickImage()            画像ライブラリを開いて選択
//   - pickVideo()            動画ライブラリを開いて選択
//   - submitComment()        コメント/返信を送信
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, TextInput } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { createComment } from '../lib/api/comments';
import { patchFeedPagePost, invalidateFeedPage } from '../lib/cacheUpdates/feedPagePatcher';
import { uploadPostImage, uploadPostVideo, validateVideoSource } from '../lib/media';
import { makeWebPreviewDataUrl } from '../lib/image';
import { peekRate, rateLimitMessage } from '../lib/rateLimit';
import { isOnline } from '../lib/offline/networkMonitor';
import { pseudonymFor } from '../lib/utils/pseudonym';
import { hap } from '../design/haptics';
import { useToastStore } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { Comment } from '../types/models';

// インラインコンポーザーで扱うローカル動画 (アップロード前)
export type LocalVideo = { uri: string; mime: string; ext: string; size: number };

export interface CommentComposerState {
  replyTarget: Comment | null;
  commentText: string;
  images: string[];
  video: LocalVideo | null;
  posting: boolean;
  pickingImage: boolean;
  pickingVideo: boolean;
  composerActive: boolean;
  canPost: boolean;
  /** 送信成功のたびに ++。送信ボタンの「Check + 波紋」演出のトリガー (失敗時は不変)。 */
  successTick: number;
}

export interface CommentComposerHandlers {
  handleReply: (c: Comment) => void;
  setReplyTarget: (c: Comment | null) => void;
  setCommentText: (t: string) => void;
  setComposerActive: (v: boolean) => void;
  setImages: React.Dispatch<React.SetStateAction<string[]>>;
  setVideo: (v: LocalVideo | null) => void;
  pickImage: () => Promise<void>;
  pickVideo: () => Promise<void>;
  submitComment: () => Promise<void>;
}

export interface UseCommentComposerResult {
  composerState: CommentComposerState;
  handlers: CommentComposerHandlers;
  composerRef: React.RefObject<TextInput>;
  scrollToEnd: () => void;
}

/**
 * インラインコメント/返信コンポーザーの状態と操作を束ねる Hook。
 *
 * @param postId      投稿 ID
 * @param scrollRef   送信後の自動スクロール用 ScrollView ref
 * @param onPosted    送信成功時に新規コメント id を通知 (作成直後のハイライト用。
 *                    id が取得できない環境では null)
 */
export function useCommentComposer(
  postId: string,
  scrollRef: React.RefObject<{ scrollToEnd: (opts?: { animated?: boolean }) => void }>,
  onPosted?: (newCommentId: string | null) => void,
): UseCommentComposerResult {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const composerRef = useRef<TextInput>(null);

  // アンマウント後に setState を呼ばないためのフラグ
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [commentText, setCommentText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [video, setVideo] = useState<LocalVideo | null>(null);
  const [posting, setPosting] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const [pickingVideo, setPickingVideo] = useState(false);
  const [composerActive, setComposerActive] = useState(false);
  // 送信成功演出 (Check + 波紋) のトリガー。成功時のみ ++。
  const [successTick, setSuccessTick] = useState(0);

  const canPost =
    (commentText.trim().length > 0 || images.length > 0 || !!video) && !posting;

  // ----------------------------------------------------------------
  // handleReply — 返信モード起動
  // ----------------------------------------------------------------
  const handleReply = useCallback((c: Comment) => {
    setReplyTarget(c);
    setComposerActive(true);
    const handle = pseudonymFor(c.pseudonym_id).handle;
    setCommentText((prev) => (prev.trim().length === 0 ? `@${handle} ` : prev));
    // 100ms: 返信チップ表示のレイアウト settle を待ってから focus
    // (50ms だと web でキーボード/フォーカスが先に走りチップ出現でガタつく)
    setTimeout(() => composerRef.current?.focus(), 100);
  }, []);

  // ----------------------------------------------------------------
  // pickImage — Web は data URL 前処理で blob 地雷回避 (lib/image.ts と同方針)
  // ----------------------------------------------------------------
  const pickImage = useCallback(async () => {
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
          const processed = await Promise.all(
            uris.map(async (u) => {
              try {
                return await makeWebPreviewDataUrl(u, 1600, 0.85);
              } catch (e) {
                console.warn('[comment-composer] web image pre-process failed:', e);
                return u;
              }
            }),
          );
          // prev を保持して累積し、上限4枚でクランプ (置換ではなく追加)
          setImages((prev) => {
            if (prev.length >= 4) return prev;
            return [...prev, ...processed].slice(0, 4);
          });
        } else {
          setImages((prev) => {
            if (prev.length >= 4) return prev;
            return [...prev, ...uris].slice(0, 4);
          });
        }
        hap.tap();
      }
    } catch (e) {
      console.warn('[comment-composer] pick image failed:', e);
      show('画像の取得に失敗しました', 'error');
    } finally {
      if (mounted.current) setPickingImage(false);
    }
  }, [pickingImage, show]);

  // ----------------------------------------------------------------
  // pickVideo
  // ----------------------------------------------------------------
  const pickVideo = useCallback(async () => {
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
      console.warn('[comment-composer] pick video failed:', e);
      show('動画の取得に失敗しました', 'error');
    } finally {
      if (mounted.current) setPickingVideo(false);
    }
  }, [pickingVideo, show]);

  // ----------------------------------------------------------------
  // submitComment
  // ----------------------------------------------------------------
  const submitComment = useCallback(async () => {
    if (posting) return;
    if (!commentText.trim() && images.length === 0 && !video) {
      show('本文・画像・動画のいずれかを入力してください。', 'warn');
      return;
    }
    // userId を async ギャップの前に確定 (stale-closure 防止)
    const userId = useAuthStore.getState().user?.id;
    if (!userId) {
      show('ログインし直してください', 'error');
      return;
    }
    // レート制限を upload 前に先読み (超過なら upload せず即 return → 孤児メディア防止)
    const rl = peekRate('comment');
    if (!rl.ok) {
      show(rateLimitMessage('comment', rl.retryAfterMs), 'error');
      return;
    }
    // ★ オフライン時は楽観挿入する前に弾く (insert→即ロールバックの「ゴースト」体験を防ぐ)。
    //   create.tsx の isOnline() 事前チェックと同方針。isOnline() は不明時 true なので誤検知しない。
    if (!isOnline()) {
      hap.warn();
      show('オフラインです。接続してから再度お試しください。', 'warn');
      return;
    }
    setPosting(true);
    // ロールバック用スナップショット
    const prevComments = qc.getQueryData<Comment[]>(['post-comments', postId]) ?? [];
    try {
      let uploadedMediaUrls: string[] = [];
      try {
        const [imageUrls, vidUrls] = await Promise.all([
          images.length > 0
            ? Promise.all(images.map((uri) => uploadPostImage(uri, userId)))
            : Promise.resolve<string[]>([]),
          video
            ? uploadPostVideo(video.uri, userId, { mime: video.mime, ext: video.ext }).then(
                (url) => [url],
              )
            : Promise.resolve<string[]>([]),
        ]);
        uploadedMediaUrls = [...imageUrls, ...vidUrls];
      } catch (e) {
        show(e instanceof Error ? e.message : String(e), 'error');
        return;
      }

      // 楽観的更新: createComment の応答を待たずコメントをキャッシュに即追加。
      // avatar_color はデフォルト色を使い、invalidate 後のサーバーデータで置き換わる。
      const optimisticId = `optimistic-${Date.now()}`;
      qc.setQueryData<Comment[]>(['post-comments', postId], [
        ...prevComments,
        {
          id: optimisticId,
          post_id: postId,
          content: commentText,
          avatar_color: '#7C6AF7',
          created_at: new Date().toISOString(),
          is_own: true,
          parent_comment_id: replyTarget?.id ?? null,
          reply_to_comment_id: replyTarget?.id ?? null,
          media_urls: uploadedMediaUrls.length > 0 ? uploadedMediaUrls : null,
        } satisfies Comment,
      ]);
      // 楽観的コメントが見える位置まで即スクロール
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

      const newCommentId = await createComment(postId, commentText, {
        parentId: replyTarget?.id ?? null,
        replyToId: replyTarget?.id ?? null,
        mediaUrls: uploadedMediaUrls,
      });

      hap.success();
      show(replyTarget ? '返信しました' : 'コメントしました', 'success');
      // 作成直後ハイライト用に新規 id を親へ通知 (取得不可環境は null)
      onPosted?.(newCommentId);
      if (mounted.current) {
        setSuccessTick((n) => n + 1); // 送信ボタンの Check + 波紋を再生
        setCommentText('');
        setImages([]);
        setVideo(null);
        setReplyTarget(null);
        setComposerActive(false);
        composerRef.current?.blur();
      }
      // invalidate で楽観的コメントをサーバーの本物データと置き換え
      void qc.invalidateQueries({ queryKey: ['post-comments', postId] });
      // ★ フィードカードの comment_count を即時 +1 (feed-page cache を patch)。
      //   いいね/反応/保存は即反映なのにコメントだけ次の refetch まで増えなかった。root/返信とも postId 単位 +1。
      patchFeedPagePost(qc, postId, (p) => ({ ...p, comments_count: (p.comments_count ?? 0) + 1 }));
      invalidateFeedPage(qc);
    } catch (e: unknown) {
      // エラー時は楽観的コメントをロールバック
      qc.setQueryData<Comment[]>(['post-comments', postId], prevComments);
      hap.error();
      const msg = e instanceof Error ? e.message : String(e);
      let userMsg = '送信に失敗しました。再度お試しください。';
      if (msg.includes('row-level security') || msg.includes('RLS')) {
        userMsg = '権限エラー。ログインし直してください。';
      } else if (msg.includes('Not authenticated') || msg.includes('未ログイン')) {
        userMsg = 'ログインし直してください。';
      } else if (msg.includes('Network') || msg.includes('Failed to fetch')) {
        userMsg = '通信エラー。電波を確認してください。';
      } else if (
        msg.includes('速すぎ') ||
        msg.includes('時間を置いて') ||
        msg.includes('ペースが')
      ) {
        userMsg = msg;
      }
      show(userMsg, 'error');
    } finally {
      if (mounted.current) setPosting(false);
    }
  }, [
    posting,
    commentText,
    images,
    video,
    replyTarget,
    postId,
    qc,
    show,
    scrollRef,
    onPosted,
  ]);

  const scrollToEnd = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [scrollRef]);

  return {
    composerState: {
      replyTarget,
      commentText,
      images,
      video,
      posting,
      pickingImage,
      pickingVideo,
      composerActive,
      canPost,
      successTick,
    },
    handlers: {
      handleReply,
      setReplyTarget,
      setCommentText,
      setComposerActive,
      setImages,
      setVideo,
      pickImage,
      pickVideo,
      submitComment,
    },
    composerRef,
    scrollToEnd,
  };
}
