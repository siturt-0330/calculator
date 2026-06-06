import { View, Text, Platform } from 'react-native';
import { safeOpenUrl } from '../../lib/openUrl';
import { sanitizeUrl } from '../../lib/sanitize';
import { ENV } from '../../lib/env';
import { useQuery } from '@tanstack/react-query';
import { fetchAndCachePreview } from '../../lib/api/linkPreview';
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

// 自 Supabase ドメイン (og-fetch が og-image 署名 URL でプロキシして返す画像) か。
// プライバシー方針: 閲覧者の端末から外部画像ホストへ直接アクセスさせない。
// 万一外部ホストの生 URL が来た場合は画像を出さず IP/UA 漏洩を防ぐ。
function isSelfHostedImage(url: string): boolean {
  try {
    return new URL(url).host === new URL(ENV.SUPABASE_URL).host;
  } catch {
    return false;
  }
}

export function LinkPreviewCard({ url }: { url: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['link-preview', url],
    queryFn: () => fetchAndCachePreview(url),
    enabled: !!url,
    staleTime: 60 * 60 * 1000,  // 1h
  });

  // OG 画像 URL の二重ガード:
  //   1. sanitizeUrl: http/https のみ + SSRF/private-network/userinfo 排除 (data:/javascript: を弾く)
  //   2. isSelfHostedImage: og-image プロキシ (自 Supabase ドメイン) 以外は表示しない
  //      → 閲覧者 IP が外部画像ホストへ漏れる経路を遮断。外部 raw URL のときは画像を捨て、
  //        タイトル/出典バーのみ表示 (deep-research 結論「壊れたカードを出さず非表示」)。
  const sanitizedImage = data?.image_url ? sanitizeUrl(data.image_url) : null;
  const safeImageUrl = sanitizedImage && isSelfHostedImage(sanitizedImage) ? sanitizedImage : null;

  const open = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      void safeOpenUrl(url);
    }
  };

  // ローディング/失敗時はシンプルな出典バー
  if (isLoading || !data || (!data.title && !safeImageUrl)) {
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
          {data.title ? (
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
                {data.title}
              </Text>
            </View>
          ) : null}
        </View>
      ) : data.title ? (
        // 画像なし OG: タイトルはテキストで (キャプションバーは画像前提のため)
        <View style={{ paddingHorizontal: SP['3'], paddingTop: SP['3'] }}>
          <Text style={[T.smallB, { color: C.text }]} numberOfLines={2}>
            {data.title}
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
