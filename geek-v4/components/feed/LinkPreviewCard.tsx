import { useEffect } from 'react';
import { View, Text, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { safeOpenUrl } from '../../lib/openUrl';
import { sanitizeUrl } from '../../lib/sanitize';
import { useQuery } from '@tanstack/react-query';
import { fetchAndCachePreview, ogImageProxyUrl } from '../../lib/api/linkPreview';
import { parseYouTube, youTubeThumbnailUrl, youTubeWatchUrl } from '../../lib/utils/youtube';
import { parseSocialLink } from '../../lib/utils/socialLink';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../ui/PressableScale';
import { ProgressiveImage } from '../ui/ProgressiveImage';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

function shortHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function LinkPreviewCard({
  url,
  embedded = false,
}: {
  url: string;
  /** composer など、呼び出し側が外側の余白を持つ場所に置くとき true。
   *  カード自身の marginHorizontal / marginTop を 0 にして二重インデントを防ぐ。 */
  embedded?: boolean;
}) {
  // 埋め込み時はカード自身の外余白を消し、配置は呼び出し側に委ねる。
  const mh = embedded ? 0 : SP['4'];
  const mt = embedded ? 0 : SP['2'];
  const { data, isLoading } = useQuery({
    queryKey: ['link-preview', url],
    queryFn: () => fetchAndCachePreview(url),
    enabled: !!url,
    staleTime: 60 * 60 * 1000,  // 1h
  });

  // YouTube は video id からサムネ/タイトル/遷移先を確実に導けるので、メタ取得が
  // 失敗してもカード化できる。
  const yt = parseYouTube(url);
  // Instagram / Facebook はメタ取得が基本失敗する (Meta が datacenter IP / 非ブラウザ
  // UA をブロック) ため、サムネ無しでも「ブランドカード」として成立させる。
  // YouTube host は IG/FB にマッチしないので yt と排他で良い。
  const social = yt ? null : parseSocialLink(url);

  // 画像:
  //   YouTube は【常に】hqdefault (確実に存在する) を使う — DB に保存された og:image
  //   (maxresdefault 等) は動画によって 404 になり「紺色の placeholder だけ」事故が
  //   起きていた (2026-06-13 ユーザー報告)。hqdefault は全動画に必ず存在する。
  //   一般リンクは OG 画像。IG/FB は確定的なサムネ URL が無いので image_url がある時だけ。
  // ★ いずれも og-image プロキシ経由にして、閲覧者の IP を相手ホストに渡さない。
  //   sanitizeUrl で http(s)+SSRF/private ガード → ogImageProxyUrl で GEEK サーバー経由に。
  const rawImage = yt ? youTubeThumbnailUrl(yt.videoId) : data?.image_url ?? null;
  const safeImageUrl = ogImageProxyUrl(rawImage ? sanitizeUrl(rawImage) : null);

  // タイトル: OG title 優先。未取得時は YouTube / IG / FB のブランド名で代替。
  const title = data?.title ?? (yt ? 'YouTube' : social ? social.label : null);
  // チャンネル名 (YouTube のみ): og-fetch が oEmbed author_name を site_name に格納する
  // (2026-06-13)。旧 cache 行は 'YouTube' のままなのでその場合は出さない。
  const ytChannel =
    yt && data?.site_name && data.site_name.trim().toLowerCase() !== 'youtube'
      ? data.site_name.trim()
      : null;
  // 遷移先: YouTube は正規 watch URL、IG/FB は tracking 除去済の正規 URL。
  const openUrl = yt ? youTubeWatchUrl(yt.videoId) : social ? social.canonicalUrl : url;

  // IG/FB ブランド表示 (アイコン + ブランド色)。social が無ければ未使用。
  const PlatformIcon = social
    ? social.platform === 'instagram'
      ? Icon.instagram
      : Icon.facebook
    : null;
  const brandColor = social?.platform === 'instagram' ? '#E1306C' : '#1877F2';
  // ▶ オーバーレイ: YouTube か、IG/FB の動画系 (reel / watch 等) で画像がある時。
  const showPlay = !!(yt || social?.isVideo);

  const open = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(openUrl, '_blank', 'noopener,noreferrer');
    } else {
      void safeOpenUrl(openUrl);
    }
  };

  // ★ X 風ローディング (2026-06-14): OG メタ取得待ちの間は、最終カードと同じ寸法の
  //   スケルトン (画像エリア 1.91:1 + タイトル/出典のプレースホルダ) を先に確保して
  //   shimmer 表示する。これで「小さな出典バー → 大カード」のレイアウトジャンプが消え、
  //   X のように「枠が先に出て中身が後から埋まる」体感になる。
  //   YouTube / IG / FB はメタ取得を待たず即カード化するのでスケルトン不要。
  if (!yt && !social && isLoading) {
    return <LinkPreviewSkeleton mh={mh} mt={mt} />;
  }
  // 取得完了したが title も image も無い (= 失敗) ときだけ、控えめな出典バーに落とす。
  if (!yt && !social && (!data || (!title && !safeImageUrl))) {
    return (
      <PressableScale onPress={open} haptic="tap" style={{
        marginHorizontal: mh, marginTop: mt,
        paddingHorizontal: SP['3'], paddingVertical: SP['2'],
        backgroundColor: C.bg3, borderRadius: R.md,
        borderWidth: 1, borderColor: C.border,
        flexDirection: 'row', alignItems: 'center', gap: SP['2'],
      }}>
        <Text style={{ fontSize: 14 }}>🔗</Text>
        <Text style={[T.caption, { color: C.text2, flex: 1 }]} numberOfLines={1}>
          出典: {shortHost(url)}
        </Text>
      </PressableScale>
    );
  }

  // X (Twitter) 風リンクカード:
  //   ・大きな OG 画像 (バナー)
  //   ・画像下部にタイトルを半透明の暗いキャプションバーで重ねる
  //   ・画像の下に「場所: <ドメイン>」を控えめに表示
  // タップで URL を開く挙動 (open) は従来通り維持。
  return (
    <PressableScale onPress={open} haptic="tap" style={{
      marginHorizontal: mh, marginTop: mt,
      backgroundColor: C.bg3,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      overflow: 'hidden',
    }}>
      {safeImageUrl ? (
        // 画像あり: LINE の YouTube カード風 (2026-06-13 ユーザー指定のリファレンス)。
        //   ・YouTube は 16:9 cover crop — hqdefault (4:3, 上下黒帯) の帯が
        //     ちょうど切り落とされて全面サムネになる。一般 OG は 1.91:1 (X/FB 標準)
        //   ・タイトル + チャンネル名はサムネ【上部】の黒→透明グラデに重ねる
        //     (LINE / iMessage の YouTube プレビューと同じ配置)
        //   ・YouTube は右下に watermark (▶ YouTube)
        <View style={{ position: 'relative', width: '100%', aspectRatio: yt ? 16 / 9 : 1.91 }}>
          <ProgressiveImage
            uri={safeImageUrl}
            width={'100%'}
            height={'100%'}
            radius={0}
            lazy
            thumbWidth={720}
          />
          {title ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
              <LinearGradient
                colors={['rgba(0,0,0,0.78)', 'rgba(0,0,0,0.42)', 'transparent']}
                style={{
                  paddingHorizontal: SP['3'],
                  paddingTop: SP['2'],
                  paddingBottom: SP['7'],
                }}
              >
                <Text
                  style={[T.smallB, { color: '#fff', fontSize: 15, lineHeight: 20 }]}
                  numberOfLines={2}
                >
                  {title}
                </Text>
                {ytChannel ? (
                  <Text
                    style={[T.caption, { color: 'rgba(255,255,255,0.82)', marginTop: 2 }]}
                    numberOfLines={1}
                  >
                    {ytChannel}
                  </Text>
                ) : null}
              </LinearGradient>
            </View>
          ) : null}
          {showPlay ? (
            // 再生マーク(中央)。Liquid Glass 風: 半透明黒 + rim light の 1px 縁
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.28)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon.play size={24} color="#fff" fill="#fff" style={{ marginLeft: 3 }} />
              </View>
            </View>
          ) : null}
          {yt ? (
            // 右下 watermark — LINE 風の控えめな白ロゴ表現
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                right: SP['3'],
                bottom: SP['2'],
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                opacity: 0.9,
              }}
            >
              <Icon.play size={13} color="#fff" fill="#fff" />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: -0.2 }}>
                YouTube
              </Text>
            </View>
          ) : null}
        </View>
      ) : social && PlatformIcon ? (
        // IG/FB: サムネが取れない (Meta 制限) のが通常なので、アイコン + ブランド名の
        // チップで「何のリンクか」を明示する。これだけでも生 URL より段違いに分かりやすい。
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], paddingHorizontal: SP['3'], paddingTop: SP['3'] }}>
          <PlatformIcon size={20} color={brandColor} />
          <Text style={[T.smallB, { color: C.text, flex: 1 }]} numberOfLines={2}>
            {title}
          </Text>
        </View>
      ) : title ? (
        // 画像なし OG: タイトルはテキストで (キャプションバーは画像前提のため)
        <View style={{ paddingHorizontal: SP['3'], paddingTop: SP['3'] }}>
          <Text style={[T.smallB, { color: C.text }]} numberOfLines={2}>
            {title}
          </Text>
        </View>
      ) : null}
      {/* 出典行 — ブランドマーク + サイト名 (YouTube は赤 chip、他は globe + ドメイン)。
            旧「場所: <ドメイン>」表記より一目で出典が分かる。 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: SP['3'],
          paddingVertical: SP['2'],
        }}
      >
        {yt ? (
          <View
            style={{
              width: 19,
              height: 13,
              borderRadius: 3.5,
              backgroundColor: '#FF0000',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon.play size={8} color="#fff" fill="#fff" style={{ marginLeft: 0.5 }} />
          </View>
        ) : (
          <Icon.globe size={12} color={C.text3} strokeWidth={2} />
        )}
        <Text style={[T.caption, { color: C.text3, flex: 1 }]} numberOfLines={1}>
          {yt ? 'YouTube' : (data?.site_name ?? shortHost(url))}
        </Text>
      </View>
    </PressableScale>
  );
}

// =============================================================================
// LinkPreviewSkeleton — OG メタ取得待ちの X 風スケルトン
// -----------------------------------------------------------------------------
// 最終カードと同じ寸法 (画像 1.91:1 + タイトル/出典のプレースホルダ) を先に確保し、
// shimmer (opacity の往復) で「読込中」を示す。これでカードがその場で埋まる体感に。
// reduceMotion 時は静止 (opacity 固定)。
// =============================================================================
function LinkPreviewSkeleton({ mh, mt }: { mh: number; mt: number }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 0.6;
      return;
    }
    pulse.value = withRepeat(
      withTiming(0.9, { duration: 750, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    // アンマウント時にワークレットをキャンセルして UI スレッドの漏れを防ぐ
    return () => { cancelAnimation(pulse); };
  }, [pulse, reduceMotion]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const block = { backgroundColor: C.bg4, borderRadius: 4 } as const;
  return (
    <View
      style={{
        marginHorizontal: mh,
        marginTop: mt,
        backgroundColor: C.bg3,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
      }}
    >
      {/* 画像エリア (1.91:1) */}
      <Animated.View style={[{ width: '100%', aspectRatio: 1.91, backgroundColor: C.bg4 }, pulseStyle]} />
      {/* タイトル 2 行 + 出典 */}
      <View style={{ paddingHorizontal: SP['3'], paddingVertical: SP['2'], gap: 8 }}>
        <Animated.View style={[{ width: '82%', height: 12 }, block, pulseStyle]} />
        <Animated.View style={[{ width: '55%', height: 12 }, block, pulseStyle]} />
        <Animated.View style={[{ width: 96, height: 9, marginTop: 2 }, block, pulseStyle]} />
      </View>
    </View>
  );
}
