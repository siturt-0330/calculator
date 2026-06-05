// ============================================================
// CommunityIcon — コミュニティアイコンの単一描画コンポーネント
// ------------------------------------------------------------
// コミュニティのアイコンは「必ず表示」かつ「拡大(crop)しない」を保証する。
// (アプリ全体で ~20 箇所が各自 `icon_url ? <Image cover> : emoji` を再実装し、
//  どれも onError fallback 無し / contentFit=cover だったため「空白の丸」や
//  「ロゴが拡大されて切れる」が頻発していた。これを 1 箇所に集約する)
//
//   1) icon_url 画像があれば最優先で表示する。
//      ★ Avatar は emoji 優先なので、画像を持つコミュニティでも emoji が出てしまう。
//        CommunityIcon は「画像 → emoji → 頭文字 → community アイコン」の順で画像優先。
//   2) contentFit="contain" + iconThumbedUrl(resize=contain) でロゴ全体を収める。
//      中央 crop の「ズーム」を避ける。余白には地色(icon_color)が出る = 自然。
//   3) 画像読み込み失敗 (onError: 404 / 期限切れ / 壊れURL) は即 emoji へ fallback。
//      → これまでは onError が無く「空白の丸」になっていた。
//   4) icon_url も emoji も無ければ頭文字、それも無ければ community アイコンで必ず描く。
// ============================================================
import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { C, R, GRAD } from '../../design/tokens';
import { Icon } from '../../constants/icons';
import { iconThumbedUrl } from '../../lib/utils/imageUrl';

const RING_WIDTH = 2;

export interface CommunityIconProps {
  iconUrl?: string | null;
  iconEmoji?: string | null;
  iconColor?: string | null;
  /** 画像も emoji も無いときの頭文字に使う。 */
  name?: string | null;
  size?: number;
  /** accent グラデの外周リング (IG ストーリー風)。 */
  ring?: boolean;
}

export function CommunityIcon({
  iconUrl,
  iconEmoji,
  iconColor,
  name,
  size = 40,
  ring = false,
}: CommunityIconProps) {
  const bg = iconColor || C.bg3;
  const [errored, setErrored] = useState(false);
  // icon_url が変わったら error 状態をリセット (FlashList のセル再利用対策)。
  useEffect(() => {
    setErrored(false);
  }, [iconUrl]);

  const inner = ring ? size - RING_WIDTH * 2 : size;
  const showImage = !!iconUrl && !errored;
  // retina 2x。contain なので crop されず、ロゴ全体が収まる。
  const resolved = showImage ? iconThumbedUrl(iconUrl, Math.round(inner * 2)) : '';

  const circle = (
    <View
      style={{
        width: inner,
        height: inner,
        borderRadius: R.full,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {showImage ? (
        <ExpoImage
          source={{ uri: resolved }}
          style={{ width: '100%', height: '100%' }}
          // ★ contain: ロゴ全体を収める (cover の中央 crop=「拡大」を避ける)。
          contentFit="contain"
          cachePolicy="memory-disk"
          recyclingKey={resolved}
          transition={120}
          onError={() => setErrored(true)}
        />
      ) : iconEmoji ? (
        <Text style={{ fontSize: inner * 0.5 }}>{iconEmoji}</Text>
      ) : name && name.length > 0 ? (
        <Text style={{ fontSize: inner * 0.42, fontWeight: '800', color: '#fff' }}>
          {name.charAt(0).toUpperCase()}
        </Text>
      ) : (
        <Icon.community size={inner * 0.5} color="#fff" strokeWidth={2.2} />
      )}
    </View>
  );

  if (!ring) return circle;
  return (
    <LinearGradient
      colors={GRAD.primary}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: R.full,
        padding: RING_WIDTH,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {circle}
    </LinearGradient>
  );
}
