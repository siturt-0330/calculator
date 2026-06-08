// ============================================================
// app/post/comment.tsx — 全画面コメント作成 (Instagram / Threads 風の遷移)
// ------------------------------------------------------------
// 投稿詳細 (app/post/[id]) の「コメントを入力」/各コメントの「返信」から
// modal で開く専用画面。X/Threads のように全画面で本文 + 画像/動画を添付できる。
//   - params: postId (必須) / parentId / replyToId / replyHandle / replyPreview
//   - 常に匿名。送信は createComment(postId, content, { parentId, replyToId, mediaUrls })。
//   - メディアは posts-media bucket に upload して公開 URL を comments.media_urls に保存
//     (migration 0104)。本文空でもメディアがあれば送信可。
// ============================================================

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  type TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { X as IconX, Film } from 'lucide-react-native';

import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { ComposerBodyField } from '../../components/post/composer/ComposerBodyField';
import { ComposerMediaGrid } from '../../components/post/composer/ComposerMediaGrid';

import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { hap } from '../../design/haptics';
import { createComment } from '../../lib/api/comments';
import { peekRate, rateLimitMessage } from '../../lib/rateLimit';
import { validateVideoSource, uploadPostImage, uploadPostVideo } from '../../lib/media';
import { makeWebPreviewDataUrl } from '../../lib/image';
import { Icon } from '../../constants/icons';
import { SP, R, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';

type LocalVideo = { uri: string; mime: string; ext: string; size: number };

export default function CommentComposer() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const show = useToastStore((s) => s.show);
  const qc = useQueryClient();
  const C = useColors();

  const params = useLocalSearchParams<{
    postId?: string;
    parentId?: string;
    replyToId?: string;
    replyHandle?: string;
    replyPreview?: string;
  }>();
  const postId = typeof params.postId === 'string' ? params.postId : '';
  const parentId = typeof params.parentId === 'string' ? params.parentId : undefined;
  const replyToId = typeof params.replyToId === 'string' ? params.replyToId : undefined;
  const replyHandle = typeof params.replyHandle === 'string' ? params.replyHandle : '';
  const replyPreview = typeof params.replyPreview === 'string' ? params.replyPreview : '';
  const isReply = !!parentId;

  // -----------------------------------------------------------
  // local state — この画面で完結 (post draft store とは独立)
  // -----------------------------------------------------------
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [video, setVideo] = useState<LocalVideo | null>(null);
  const [pickingImage, setPickingImage] = useState(false);
  const [pickingVideo, setPickingVideo] = useState(false);
  const [posting, setPosting] = useState(false);

  const bodyRef = useRef<TextInput>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // 開いた瞬間にキーボードを上げる (Instagram 風)
  useEffect(() => {
    const t = setTimeout(() => bodyRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  // -----------------------------------------------------------
  // image picker (create.tsx と同じ方針 — Web は data URL 前処理)
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
          const processed = await Promise.all(
            uris.map(async (u) => {
              try {
                return await makeWebPreviewDataUrl(u, 1600, 0.85);
              } catch (e) {
                console.warn('[post/comment] web image pre-process failed:', e);
                return u;
              }
            }),
          );
          setImages(processed.slice(0, 4));
        } else {
          setImages(uris);
        }
        hap.tap();
      }
    } catch (e) {
      console.warn('[post/comment] pick image failed:', e);
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
      console.warn('[post/comment] pick video failed:', e);
      show('動画の取得に失敗しました', 'error');
    } finally {
      setPickingVideo(false);
    }
  };

  // -----------------------------------------------------------
  // 送信
  // -----------------------------------------------------------
  const canPost = (content.trim().length > 0 || images.length > 0 || !!video) && !posting;

  const handlePost = async () => {
    if (posting) return;
    if (!postId) {
      show('投稿が見つかりませんでした', 'error');
      return;
    }
    if (!content.trim() && images.length === 0 && !video) {
      show('本文・画像・動画のいずれかを入力してください。', 'warn');
      return;
    }
    setPosting(true);
    try {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) {
        show('ログインし直してください', 'error');
        return;
      }
      // ★ レート制限を upload 前に先読み (createComment の checkRate は increment。peekRate で
      //   増やさず判定、超過なら upload せず即 return → 孤児メディア防止)。
      const rl = peekRate('comment');
      if (!rl.ok) {
        show(rateLimitMessage('comment', rl.retryAfterMs), 'error');
        return;
      }
      let mediaUrls: string[] = [];
      try {
        const [imageUrls, videoUrls] = await Promise.all([
          images.length > 0
            ? Promise.all(images.map((uri) => uploadPostImage(uri, userId)))
            : Promise.resolve<string[]>([]),
          video
            ? uploadPostVideo(video.uri, userId, { mime: video.mime, ext: video.ext }).then((url) => [url])
            : Promise.resolve<string[]>([]),
        ]);
        mediaUrls = [...imageUrls, ...videoUrls];
      } catch (e) {
        show(e instanceof Error ? e.message : String(e), 'error');
        return;
      }

      await createComment(postId, content, {
        parentId: parentId ?? null,
        replyToId: replyToId ?? null,
        mediaUrls,
      });

      hap.success();
      show(isReply ? '返信しました' : 'コメントしました', 'success');
      void qc.invalidateQueries({ queryKey: ['post-comments', postId] });
      if (router.canGoBack()) router.back();
      else router.replace(`/post/${postId}` as never);
    } catch (e: unknown) {
      hap.error();
      const msg = e instanceof Error ? e.message : String(e);
      let userMsg = '送信に失敗しました。再度お試しください。';
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
    else router.replace(`/post/${postId}` as never);
  };

  // -----------------------------------------------------------
  // render
  // -----------------------------------------------------------
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ヘッダー — [✕] | 返信/コメント | [投稿 pill] */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingBottom: SP['2'],
          paddingHorizontal: SP['4'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
        }}
      >
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

        <Text style={[T.bodyB, { color: C.text, flex: 1, textAlign: 'center' }]}>
          {isReply ? '返信' : 'コメント'}
        </Text>

        <PressableScale
          onPress={handlePost}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel={isReply ? '返信を送信' : 'コメントを送信'}
          accessibilityState={{ disabled: !canPost }}
          disabled={!canPost}
          style={{
            paddingHorizontal: SP['4'],
            paddingVertical: SP['2'],
            borderRadius: R.full,
            backgroundColor: canPost ? C.accent : C.bg3,
            opacity: canPost ? 1 : 0.5,
            minWidth: 64,
            alignItems: 'center',
          }}
        >
          {posting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[T.smallB, { color: canPost ? '#fff' : C.text3 }]}>投稿</Text>
          )}
        </PressableScale>
      </View>

      {/* 本体 */}
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
          {/* 返信先コンテキスト (返信時のみ) */}
          {isReply && (replyHandle || replyPreview) ? (
            <View
              style={{
                marginHorizontal: SP['4'],
                marginTop: SP['3'],
                padding: SP['3'],
                borderRadius: R.md,
                backgroundColor: C.bg2,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <Icon.arrowUL size={13} color={C.accent} strokeWidth={2.4} />
                <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]} numberOfLines={1}>
                  {replyHandle ? `${replyHandle} さんに返信` : 'コメントに返信'}
                </Text>
              </View>
              {!!replyPreview && (
                <Text style={[T.small, { color: C.text3 }]} numberOfLines={2}>
                  {replyPreview}
                </Text>
              )}
            </View>
          ) : null}

          {/* アバター + 本文 + メディア */}
          <View style={{ flexDirection: 'row', paddingHorizontal: SP['4'], paddingTop: SP['4'] }}>
            <View style={{ width: 44, alignItems: 'center' }}>
              <Avatar size={40} anonymous />
            </View>
            <View style={{ flex: 1, paddingLeft: SP['3'] }}>
              <Text style={[T.caption, { color: C.text3, marginBottom: SP['1'] }]}>
                匿名で{isReply ? '返信' : 'コメント'}・名前は表示されません
              </Text>

              <ComposerBodyField
                value={content}
                onChangeText={setContent}
                placeholder={isReply ? '返信を入力…' : 'コメントを入力…'}
                onSelectionChange={(sel) => {
                  selectionRef.current = sel;
                }}
                inputRef={bodyRef}
              />

              {(images.length > 0 || video) && (
                <View style={{ marginTop: SP['3'] }}>
                  <ComposerMediaGrid
                    images={images}
                    video={video ? { uri: video.uri, sizeMb: video.size / 1024 / 1024 } : null}
                    onRemoveImage={(index) => setImages(images.filter((_, i) => i !== index))}
                    onRemoveVideo={() => setVideo(null)}
                    containerPaddingH={0}
                  />
                </View>
              )}
            </View>
          </View>
        </ScrollView>

        {/* メディアアクションバー (画像 / 動画) */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['1'],
            minHeight: 52,
            paddingTop: SP['1'],
            paddingBottom: SP['1'] + insets.bottom,
            paddingHorizontal: SP['3'],
            backgroundColor: C.bg,
            borderTopWidth: 1,
            borderTopColor: C.border,
          }}
        >
          <PressableScale
            haptic="select"
            onPress={images.length >= 4 || pickingImage ? undefined : pickImage}
            disabled={images.length >= 4 || pickingImage}
            accessibilityLabel="画像を追加"
            accessibilityRole="button"
            style={{
              width: SIZE.touch,
              height: SIZE.touch,
              borderRadius: SIZE.touch / 2,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: images.length >= 4 ? 0.4 : pickingImage ? 0.55 : 1,
            }}
          >
            <Icon.image size={22} color={images.length >= 4 ? C.text3 : C.text2} strokeWidth={2} />
          </PressableScale>
          <PressableScale
            haptic="select"
            onPress={!!video || pickingVideo ? undefined : pickVideo}
            disabled={!!video || pickingVideo}
            accessibilityLabel="動画を追加"
            accessibilityRole="button"
            style={{
              width: SIZE.touch,
              height: SIZE.touch,
              borderRadius: SIZE.touch / 2,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: video ? 0.4 : pickingVideo ? 0.55 : 1,
            }}
          >
            <Film size={22} color={video ? C.text3 : C.text2} strokeWidth={2} />
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
