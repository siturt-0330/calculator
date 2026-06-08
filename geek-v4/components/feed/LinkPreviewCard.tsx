import { View, Text, Platform } from 'react-native';
import { safeOpenUrl } from '../../lib/openUrl';
import { sanitizeUrl } from '../../lib/sanitize';
import { useQuery } from '@tanstack/react-query';
import { fetchAndCachePreview, ogImageProxyUrl } from '../../lib/api/linkPreview';
import { parseYouTube, youTubeThumbnailUrl, youTubeWatchUrl } from '../../lib/utils/youtube';
import { PressableScale } from '../ui/PressableScale';
import { ProgressiveImage } from '../ui/ProgressiveImage';
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

export function LinkPreviewCard({ url }: { url: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['link-preview', url],
    queryFn: () => fetchAndCachePreview(url),
    enabled: !!url,
    staleTime: 60 * 60 * 1000,  // 1h
  });

  // YouTube は video id からサムネ/タイトル/遷移先を確実に導けるので、メタ取得が
  // 失敗してもカード化できる。
  const yt = parseYouTube(url);

  // 画像: OG画像があればそれ、無ければ(YouTubeなら)動画サムネ。
  // ★ いずれも og-image プロキシ経由にして、閲覧者の IP を相手ホストに渡さない。
  //   sanitizeUrl で http(s)+SSRF/private ガード → ogImageProxyUrl で GEEK サーバー経由に。
  const rawImage = data?.image_url ?? (yt ? youTubeThumbnailUrl(yt.videoId) : null);
  const safeImageUrl = ogImageProxyUrl(rawImage ? sanitizeUrl(rawImage) : null);

  // タイトル: OG title 優先、YouTube で未取得なら暫定 'YouTube'。
  const title = data?.title ?? (yt ? 'YouTube' : null);
  // 遷移先: YouTube は正規の watch URL。
  const openUrl = yt ? youTubeWatchUrl(yt.videoId) : url;

  const open = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(openUrl, '_blank', 'noopener,noreferrer');
    } else {
      void safeOpenUrl(openUrl);
    }
  };

  // ローディング/失敗時はシンプルな出典バー。
  // ただし YouTube は video id からサムネを作れるので、メタ取得を待たずカード表示する。
  if (!yt && (isLoading || !data || (!title && !safeImageUrl))) {
    return (
      <PressableScale onPress={open} haptic="tap" style={{
        marginHorizontal: SP['4'], marginTop: SP['2'],
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
      marginHorizontal: SP['4'], marginTop: SP['2'],
      backgroundColor: C.bg3,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      overflow: 'hidden',
    }}>
      {safeImageUrl ? (
        // 画像あり: バナー + タイトルのキャプションバーを重ねる。
        // (ProgressiveImage は width/height を取り内部 contentFit=cover。
        //  外側 PressableScale の overflow:hidden + R.lg で角が丸まる)
        <View style={{ position: 'relative' }}>
          <ProgressiveImage
            uri={safeImageUrl}
            width={'100%'}
            height={190}
            radius={0}
            lazy
            thumbWidth={720}
          />
          {yt ? (
            // YouTube 再生マーク(中央)。タップは外側カードの open(=watch URL)に委ねる。
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 24, marginLeft: 3 }}>▶</Text>
              </View>
            </View>
          ) : null}
          {title ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: SP['2'],
                right: SP['2'],
                bottom: SP['2'],
                backgroundColor: C.scrim,
                borderRadius: R.sm,
                paddingHorizontal: SP['2'],
                paddingVertical: SP['1'],
              }}
            >
              <Text style={[T.smallB, { color: '#fff' }]} numberOfLines={2}>
                {title}
              </Text>
            </View>
          ) : null}
        </View>
      ) : title ? (
        // 画像なし OG: タイトルはテキストで (キャプションバーは画像前提のため)
        <View style={{ paddingHorizontal: SP['3'], paddingTop: SP['3'] }}>
          <Text style={[T.smallB, { color: C.text }]} numberOfLines={2}>
            {title}
          </Text>
        </View>
      ) : null}
      {/* 出典ドメイン — 参考 UI の「場所: example.com」に合わせる */}
      <View style={{ paddingHorizontal: SP['3'], paddingVertical: SP['2'] }}>
        <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
          場所: {shortHost(url)}
        </Text>
      </View>
    </PressableScale>
  );
}
