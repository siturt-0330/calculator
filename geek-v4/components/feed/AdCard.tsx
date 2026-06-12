import { memo, useEffect, useRef, useState } from 'react';
import { View, Text, Linking, Platform } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { sanitizeUrl } from '../../lib/sanitize';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { logAdClick, logAdDismiss, logAdImpression } from '../../lib/api/ads';
import type { Ad } from '../../lib/api/ads';

// ============================================================
// AdCard — フィードに混ぜる広告カード
// ============================================================
// 設計:
//   - 視覚的に通常の投稿と明確に区別する: dashed 上枠 + 「広告」バッジ
//   - 個人追跡は一切しない — タグマッチングのみで配信される
//   - impression / click / dismiss を fire-and-forget でログ
//   - dismiss はセッション中の非表示のみ (永続化はしない — フィルタ条件は
//     タグ blockedList で行う設計)
// ============================================================

type AdCardProps = {
  ad: Ad;
  position: number;          // フィード何番目に出ているか
  matchedTags: string[];     // 配信時にマッチしたタグ (impression に同梱)
};

function AdCardInner({ ad, position, matchedTags }: AdCardProps) {
  const [dismissed, setDismissed] = useState(false);
  const impressionLoggedRef = useRef(false);
  // ad.id が変わったら再度 impression を記録
  useEffect(() => {
    if (impressionLoggedRef.current) return;
    impressionLoggedRef.current = true;
    void logAdImpression(ad.id, position, matchedTags);
    // position / matchedTags の変化では再記録しない (同じ広告は 1 度だけ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.id]);

  if (dismissed) return null;

  const onCTAPress = async () => {
    void logAdClick(ad.id);
    const safe = sanitizeUrl(ad.click_url);
    if (!safe) return;
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(safe, '_blank', 'noopener,noreferrer');
      } else {
        await Linking.openURL(safe);
      }
    } catch {
      // 無視 — クリックは成功扱い (logAdClick は既に走った)
    }
  };

  const onDismiss = () => {
    void logAdDismiss(ad.id);
    setDismissed(true);
  };

  return (
    <View
      style={[
        {
          marginHorizontal: SP['3'],
          marginVertical: SP['2'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: C.accent + '66',
          overflow: 'hidden',
        },
        SHADOW.card,
      ]}
      accessibilityRole="summary"
      accessibilityLabel={`広告: ${ad.advertiser_name}`}
    >
      {/* Header: 広告バッジ + advertiser_name + dismiss */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['3'],
          paddingTop: SP['3'],
          paddingBottom: SP['2'],
          gap: SP['2'],
        }}
      >
        <View
          style={{
            paddingHorizontal: 6,
            paddingVertical: 2,
            backgroundColor: C.accentBg,
            borderRadius: R.sm,
            borderWidth: 1,
            borderColor: C.accent + '55',
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: '800',
              color: C.accentLight,
              letterSpacing: 0.8,
            }}
          >
            広告 · Sponsored
          </Text>
        </View>
        <Text style={[T.captionM, { color: C.text3, flex: 1 }]} numberOfLines={1}>
          {ad.advertiser_name}
        </Text>
        <PressableScale
          onPress={onDismiss}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="この広告を閉じる"
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: C.bg3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon.close size={14} color={C.text3} strokeWidth={2.4} />
        </PressableScale>
      </View>

      {/* Image (任意) — expo-image で memory-disk cache + (Supabase ホストなら) thumbnail */}
      {ad.image_url ? (
        <ExpoImage
          source={{ uri: thumbedUrl(ad.image_url, 960) }}
          style={{
            width: '100%',
            aspectRatio: 16 / 9,
            backgroundColor: C.bg3,
          }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={ad.image_url}
          transition={120}
        />
      ) : null}

      {/* Body */}
      <View style={{ paddingHorizontal: SP['3'], paddingTop: SP['3'], gap: 4 }}>
        <Text style={[T.h4, { color: C.text }]} numberOfLines={2}>
          {ad.headline}
        </Text>
        <Text style={[T.small, { color: C.text2 }]} numberOfLines={3}>
          {ad.body}
        </Text>
      </View>

      {/* CTA */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          paddingHorizontal: SP['3'],
          paddingTop: SP['3'],
          paddingBottom: SP['3'],
        }}
      >
        <PressableScale
          onPress={onCTAPress}
          haptic="confirm"
          accessibilityLabel={ad.cta_label}
          style={[
            {
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              backgroundColor: C.accent,
              borderRadius: R.full,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            },
            SHADOW.accentGlow,
          ]}
        >
          <Text style={[T.smallB, { color: '#fff' }]}>{ad.cta_label}</Text>
          <Icon.chevronR size={14} color="#fff" strokeWidth={2.6} />
        </PressableScale>
      </View>
    </View>
  );
}

export const AdCard = memo(AdCardInner);
