// ============================================================
// CommunityCollapsingHeader —「The Lockup Handoff」コラプシング・ヘッダー
// ------------------------------------------------------------
// 上で大きく名乗る Lockup(avatar+名+meta+参加)が崩壊で消え、PinnedBar(glass+
// mini-avatar+名)がリレーで現れる。height は固定シェル(=web layout 再計算ゼロ)、
// 縮約は transform/opacity だけで表現。Lockup は 64px で消えきり、PinnedBar は 72px
// から現れる(8px の無人区間=安いクロスフェードと差別化)。
//
// 設計上の堅牢化(レビュー指摘の反映):
//   - 色は useTheme()(useColors)で解決 → light/dark で紫が割れない。worklet 内は数値のみ。
//   - pointerEvents は worklet で box-none を返さない(web で無効値になるため)。
//     useAnimatedReaction で閾値を跨いだ時だけ静的 prop を 'box-none'↔'none' に切替。
//   - PinnedBar の名前は T.bodyB(NotoSansJP)= 和文 tofu 回避(LOGO_FONT 不使用)。
//   - 参加ボタンは控えめゴースト。紫の発色は「未参加ボタン枠」+「ソート下線」のみ。
// ============================================================
import { useState } from 'react';
import { View, Text, Platform, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { CommunityIcon } from '../ui/CommunityIcon';
import { BackButton } from '../nav/BackButton';
import { OfficialBadge } from './OfficialBadge';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { useTheme } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { T } from '../../design/typography';
import { SP, R } from '../../design/tokens';
import type { ColorPalette } from '../../lib/theme/palettes';

export const HEADER_EXPANDED = 132;
const HEADER_PINNED = 48;
const RAIL_H = 44;
const NATIVE = Platform.OS !== 'web';
const COVER_OVERSCALE = NATIVE ? 1.18 : 1.06;
const GHOST_PV = 6; // 枠線ゴーストピルの縦 padding(SP スケール外の意図的値)

export type CommunityVisibility = 'open' | 'request' | 'invite';

export type CommunityCollapsingHeaderProps = {
  name: string;
  handle: string | null;
  iconUrl?: string | null;
  iconEmoji?: string | null;
  iconColor?: string | null;
  isOfficial: boolean;
  coverUrl?: string | null;
  visibility: CommunityVisibility;
  isMember: boolean;
  isRequestVisibility: boolean;
  hasPendingRequest: boolean;
  joining: boolean;
  onJoinLeave: () => void;
  scrollY: SharedValue<number>;
  topInset: number;
};

export function CommunityCollapsingHeader(props: CommunityCollapsingHeaderProps) {
  const {
    name, handle, iconUrl, iconEmoji, iconColor, isOfficial,
    coverUrl, visibility, isMember, isRequestVisibility, hasPendingRequest, joining,
    onJoinLeave, scrollY, topInset,
  } = props;
  const { C, isDark } = useTheme();
  const reduce = useReducedMotion();
  const [lockupInteractive, setLockupInteractive] = useState(true);

  // 閾値(60px)を跨いだ時だけ pointerEvents を静的 prop で切替(worklet で box-none を返さない)。
  useAnimatedReaction(
    () => scrollY.value > 60,
    (gone, prev) => {
      if (prev !== null && gone !== prev) runOnJS(setLockupInteractive)(!gone);
    },
  );

  const lockupStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [0, 64], [1, 0], Extrapolation.CLAMP);
    if (reduce) return { opacity, transform: [] };
    return {
      opacity,
      transform: [
        { translateY: interpolate(scrollY.value, [0, 120], [0, -16], Extrapolation.CLAMP) },
        { scale: interpolate(scrollY.value, [0, 120], [1, 0.96], Extrapolation.CLAMP) },
      ],
    };
  });
  const pinnedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [72, 116], [0, 1], Extrapolation.CLAMP),
  }));
  const pinnedInnerStyle = useAnimatedStyle(() => {
    if (reduce) return { transform: [] };
    return { transform: [{ translateY: interpolate(scrollY.value, [72, 116], [8, 0], Extrapolation.CLAMP) }] };
  });
  const pinnedHairlineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [104, 124], [0, 1], Extrapolation.CLAMP),
  }));
  const coverStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [0, 120], [1, 0], Extrapolation.CLAMP);
    if (reduce) return { opacity, transform: [] };
    return {
      opacity,
      transform: [
        { translateY: scrollY.value * 0.5 },
        {
          scale: interpolate(scrollY.value, [-120, 0], [COVER_OVERSCALE, 1], {
            extrapolateLeft: Extrapolation.EXTEND,
            extrapolateRight: Extrapolation.CLAMP,
          }),
        },
      ],
    };
  });

  const willChangeTO = NATIVE ? null : ({ willChange: 'transform, opacity' } as object);
  const willChangeO = NATIVE ? null : ({ willChange: 'opacity' } as object);
  const glassBg = isDark ? 'rgba(10,10,10,0.70)' : 'rgba(250,250,252,0.70)';
  const glassHairline = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
      {/* Cover (z0) — coverUrl がある時だけ。現状 Community 型に無いので通常は無地。 */}
      {coverUrl ? (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: 0, left: 0, right: 0, height: topInset + HEADER_EXPANDED, zIndex: 0 },
            coverStyle,
            willChangeTO,
          ]}
        >
          <ExpoImage source={{ uri: coverUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={160} />
          <LinearGradient colors={['rgba(10,10,10,0)', C.bg]} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}

      {/* PinnedBar (z20) — glass + mini-avatar + 名。back/⋯ は Rail(z30)が上に持つ。 */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          { position: 'absolute', top: 0, left: 0, right: 0, height: topInset + HEADER_PINNED, zIndex: 20 },
          pinnedStyle,
          willChangeO,
        ]}
      >
        {NATIVE ? (
          <>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,20,23,0.92)' }]} />
            <BlurView
              intensity={80}
              tint={isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
              style={StyleSheet.absoluteFill}
            />
          </>
        ) : (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: glassBg,
                ...({ backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)' } as object),
              },
            ]}
          />
        )}
        <Animated.View
          style={[
            {
              marginTop: topInset,
              height: HEADER_PINNED,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: SP['4'] + RAIL_H,
            },
            pinnedInnerStyle,
          ]}
        >
          <CommunityIcon size={24} iconUrl={iconUrl} iconEmoji={iconEmoji} iconColor={iconColor} name={name} />
          <Text numberOfLines={1} style={[T.bodyB, { color: C.text, marginLeft: SP['2'], flexShrink: 1 }]}>
            {name}
          </Text>
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: glassHairline },
            pinnedHairlineStyle,
          ]}
        />
      </Animated.View>

      {/* Rail (z30) — back + 可視性バッジ + ⋯。常時表示・最前面。 */}
      <View
        pointerEvents="box-none"
        style={{ marginTop: topInset, height: RAIL_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP['4'], zIndex: 30 }}
      >
        <BackButton />
        <View style={{ flex: 1 }} />
        {visibility === 'request' && <VisibilityBadge C={C} kind="request" />}
        {visibility === 'invite' && <VisibilityBadge C={C} kind="invite" />}
      </View>

      {/* Lockup (z10) — 大きな識別。崩壊で消える。pointerEvents は静的 prop でトグル。 */}
      <Animated.View
        pointerEvents={lockupInteractive ? 'box-none' : 'none'}
        style={[
          {
            position: 'absolute',
            top: topInset + RAIL_H,
            left: 0,
            right: 0,
            zIndex: 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['3'],
            paddingHorizontal: SP['4'],
            paddingBottom: SP['4'],
          },
          lockupStyle,
          willChangeTO,
        ]}
      >
        <CommunityIcon size={56} iconUrl={iconUrl} iconEmoji={iconEmoji} iconColor={iconColor} name={name} />
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text numberOfLines={1} style={[T.h2, { color: C.text }]}>{name}</Text>
            {isOfficial && <OfficialBadge size="sm" />}
          </View>
          {handle ? (
            <Text numberOfLines={1} style={[T.caption, { color: C.text3 }]}>@{handle}</Text>
          ) : null}
        </View>
        <CompactSubscribeButton
          C={C}
          isMember={isMember}
          isRequestVisibility={isRequestVisibility}
          hasPendingRequest={hasPendingRequest}
          loading={joining}
          onPress={onJoinLeave}
        />
      </Animated.View>
    </View>
  );
}

function VisibilityBadge({ C, kind }: { C: ColorPalette; kind: 'request' | 'invite' }) {
  const isReq = kind === 'request';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: SP['2'],
        paddingVertical: 2,
        backgroundColor: isReq ? C.amberBg : C.redBg,
        borderRadius: R.full,
      }}
    >
      {isReq ? (
        <Icon.lock size={12} color={C.amber} strokeWidth={2.4} />
      ) : (
        <Icon.shield size={12} color={C.red} strokeWidth={2.4} />
      )}
      <Text style={[T.caption, { color: isReq ? C.amber : C.red, fontWeight: '600' }]}>
        {isReq ? '許可制' : '招待制'}
      </Text>
    </View>
  );
}

function CompactSubscribeButton({
  C,
  isMember,
  isRequestVisibility,
  hasPendingRequest,
  loading,
  onPress,
}: {
  C: ColorPalette;
  isMember: boolean;
  isRequestVisibility: boolean;
  hasPendingRequest: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  // 申請中 — 承認待ち。二重申請防止のため非活性(View)。無彩ゴースト。
  if (!isMember && hasPendingRequest) {
    return (
      <View
        accessibilityLabel="参加申請中 — 承認待ちです"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: 'transparent',
          borderRadius: R.full,
          borderWidth: 1,
          borderColor: C.border,
          paddingHorizontal: SP['3'],
          paddingVertical: GHOST_PV,
        }}
      >
        <Text style={[T.smallM, { color: C.text3, fontWeight: '700' }]}>申請中</Text>
      </View>
    );
  }
  // 参加中 — 無彩ゴースト + chevron。
  if (isMember) {
    return (
      <PressableScale
        onPress={onPress}
        haptic="tap"
        disabled={loading}
        accessibilityLabel="参加中 — タップで脱退 / 通知設定"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          backgroundColor: 'transparent',
          borderRadius: R.full,
          borderWidth: 1,
          borderColor: C.border,
          paddingHorizontal: SP['3'],
          paddingVertical: GHOST_PV,
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={C.text2} />
        ) : (
          <>
            <Text style={[T.smallM, { color: C.text3, fontWeight: '700' }]}>参加中</Text>
            <Icon.chevronD size={12} color={C.text3} strokeWidth={2.4} />
          </>
        )}
      </PressableScale>
    );
  }
  // 未参加 — 唯一の発色点(accent 枠ゴースト)。
  return (
    <PressableScale
      onPress={onPress}
      haptic="confirm"
      disabled={loading}
      accessibilityLabel={isRequestVisibility ? '参加申請を送る' : 'コミュニティに参加する'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'transparent',
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: C.accent,
        paddingHorizontal: SP['4'],
        paddingVertical: GHOST_PV,
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading && <ActivityIndicator size="small" color={C.accent} />}
      <Text style={[T.smallM, { color: C.accent, fontWeight: '700' }]}>
        {loading ? '…' : isRequestVisibility ? '申請' : '参加'}
      </Text>
    </PressableScale>
  );
}
