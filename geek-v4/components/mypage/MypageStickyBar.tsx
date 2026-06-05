// ============================================================
// MypageStickyBar — 上端ガラスミニバー (折り畳み高級感の核)
// ------------------------------------------------------------
// 設計 (Atelier 改 / navigationSpec + motionSpec(4)):
//   - カバー誌名がスクロールで消えた後、上端に「誌名を受け渡す」ミニバー。
//   - 背景:
//       web   = Animated.View(absoluteFill) + 動的 backdrop-filter
//               (TopBar.tsx の aWebBackdrop を写経。blur を scrollY で
//                0→24px に立ち上げ、常時焼付けを避ける。WebkitBackdropFilter
//                併記 + `as object` 注入。blur 面はこの 1 枚に限定し
//                Safari の blur ネスト破綻を回避する)
//       native= 下地 rgba(20,20,23,0.92) + expo-blur BlurView intensity80。
//   - バー全体の opacity は scrollY[150,200]→[0,1] でフェードイン出現。
//   - 中身: 左 Avatar28(accent ring) + ニックネーム(LOGO_FONT13) /
//           右端 設定アイコン(Icon.settings20) → onOpenSettings。
//   - 下端 hairline は scrollY[170,210]→[0,1] で遅れて締める。
//
// 規律:
//   - worklet 内は数値のみ (C 参照禁止)。色は render 時に解決した
//     文字列/数値を style に渡す。light/dark の固定 rgba は
//     isLightActive() で切替 (TopBar / GlassMenu 方式)。
//   - useReducedMotion でも opacity 経路は必ず維持
//     (出現・hairline は opacity だけで意味が壊れない)。
//   - 絶対配置を内包 (呼び出し側はルート直下に置くだけ)。
//   - pointerEvents='box-none' で素通しし、操作は設定アイコンのみ。
// ============================================================

import { Platform, View, Text, StyleSheet, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  interpolate,
  useAnimatedStyle,
  SharedValue,
} from 'react-native-reanimated';
import { C, SP, isLightActive } from '../../design/tokens';
import { LOGO_FONT } from '../../design/typography';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../../constants/icons';

// ミニバー本体の高さ (insets は別途上に積む)。
const BAR_H = 52;

type Props = {
  nickname: string;
  avatarUrl?: string | null;
  avatarEmoji?: string | null;
  /** safe-area 上端 (notch)。バー高 = topInset + 52 を内包する。 */
  topInset: number;
  /** 全モーションの単一駆動源。worklet 内は数値のみ参照する。 */
  scrollY: SharedValue<number>;
  onOpenSettings: () => void;
};

export function MypageStickyBar({
  nickname,
  avatarUrl,
  avatarEmoji,
  topInset,
  scrollY,
  onOpenSettings,
}: Props) {
  // ----- render 時に色を解決 (worklet には渡さない) -----
  const light = isLightActive();
  // 背景: web は半透明 + backdrop-filter、native は不透明寄りの下地。
  const webBgColor = light ? 'rgba(250,250,252,0.70)' : 'rgba(10,10,10,0.70)';
  const nativeFallbackBg = 'rgba(20,20,23,0.92)';
  const hairlineColor = light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.10)';
  const blurTint = (
    light ? 'systemUltraThinMaterialLight' : 'systemUltraThinMaterialDark'
  ) as 'systemUltraThinMaterialLight' | 'systemUltraThinMaterialDark';

  // ----- バー全体の出現 (opacity)。reduceMotion でも opacity は維持 -----
  const aBar = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [150, 200], [0, 1], 'clamp'),
  }));

  // ----- web の frosted は背景レイヤに「静的 blur」を直書き(下記 JSX)。-----
  //   ★ 旧実装は blur 半径を scrollY で 0→24px と毎フレーム動かしていたが、
  //     backdrop-filter の blur 半径アニメは web/Safari で最も重い再描画
  //     (背後の生スクロール領域を毎フレーム再 blur)で「かくかく」の主因だった。
  //     blur は固定にし、バーの出現は親 aBar の opacity フェードだけで担う
  //     (opacity は合成のみで安い。blur 面は合成キャッシュ可能な定数になる)。

  // ----- 下端 hairline (遅れてフェードイン) -----
  const aHairline = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [170, 210], [0, 1], 'clamp'),
  }));

  return (
    // ルート: 絶対配置を内包。box-none で素通しし操作は設定アイコンのみ。
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: topInset + BAR_H,
          zIndex: 5,
        },
        aBar,
      ]}
    >
      {/* 背景レイヤ: web = backdrop-filter / native = 下地 + BlurView */}
      {Platform.OS === 'web' ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: webBgColor,
              // ★ blur 半径は固定。毎フレーム動かさないことで Safari の全面再描画を断つ。
              ...({
                backdropFilter: 'blur(24px) saturate(180%)',
                WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              } as object),
            },
          ]}
        />
      ) : (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: nativeFallbackBg },
            ]}
          />
          <BlurView
            intensity={80}
            tint={blurTint}
            style={StyleSheet.absoluteFill}
          />
        </View>
      )}

      {/* 下端 hairline */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: hairlineColor,
          },
          aHairline,
        ]}
      />

      {/* 中身 row — topInset 分だけ下げてバー本体を配置 */}
      <View
        pointerEvents="box-none"
        style={{
          marginTop: topInset,
          height: BAR_H,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          gap: SP['2'],
        }}
      >
        {/* 左: mini-avatar (accent ring) — カバー誌名からの受け渡し */}
        <Avatar
          size={28}
          uri={avatarUrl ?? undefined}
          emoji={avatarEmoji ?? undefined}
          name={nickname}
          ring="accent"
        />
        {/* ニックネーム (LOGO_FONT 13 / 700) */}
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: LOGO_FONT,
            fontSize: 13,
            fontWeight: '700',
            color: C.text,
          }}
        >
          {nickname}
        </Text>

        {/* 右端: 設定アイコン (操作可能な唯一の要素) */}
        <Pressable
          onPress={onOpenSettings}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="設定を開く"
        >
          <Icon.settings size={20} color={C.text2} strokeWidth={2.2} />
        </Pressable>
      </View>
    </Animated.View>
  );
}
