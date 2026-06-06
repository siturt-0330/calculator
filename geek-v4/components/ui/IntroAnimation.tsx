import { useEffect, useRef } from 'react';
import { StyleSheet, Platform, View, type TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { LOGO_FONT } from '../../design/typography';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  interpolate,
  Extrapolation,
  cancelAnimation,
  runOnJS,
  Easing,
  ReduceMotion,
  useReducedMotion,
} from 'react-native-reanimated';

// ============================================================
// Geek イントロ — 起動スプラッシュ (web の instant splash) と「完全一致」
// ============================================================
// 設計意図 (継ぎ目のない起動体験):
//   web では HTML の起動スプラッシュ (scripts/web-postbuild.mjs が注入する
//   「Geek グラデ ワードマーク + 進捗バー」) が JS 到着前から出ている。
//   アプリ mount 後に出るこのイントロを **同じ寸法・同じ演出** にすることで、
//   スプラッシュ → イントロ → 本体 が一切ジャンプせず繋がる。
//   ★ そのため寸法は splash と同じ固定値 (46px / バー132px / gap24px / line-height1.0)。
//     画面サイズ依存にすると splash(46px)→intro が拡大して seam が見えるため固定にする。
//
//   - 背景 #0a0a0a / 中央「Geek」(web:グラデ, native:単色) + 細い進捗バー (左→右スライド) + 明滅
//   - 上品 (~2.6s)。★バーが左→右を必ず完走 (2 周) してから退場、タップでスキップ。
//   - reduce motion 時: pulse/sweep を止め、フェードのみ (ReduceMotion.Never で
//     「1フレームだけ点滅して消える」事故を防ぎ、静止した短いイントロを必ず見せる)。
//   - onComplete / markIntroShown / skip / safety の契約は不変 (_layout.tsx 互換)。
//
// グラデ文字:
//   - web: CSS background-clip:text。react-native-web 0.19.13 が全 prop を DOM へ通すことを
//     ソース追跡で確認済 (color:transparent でも不可視にならない)。splash と同一 CSS。
//   - native: RN Text はグラデ文字を持てないので単色 (#B98CFF) フォールバック。
//     (native のグラデ文字は react-native-svg での follow-up。進捗バーは linear-gradient で native もグラデ)
// ============================================================

// web 専用 CSS プロパティを TextStyle に重ねるためのローカル拡張型
type WebTextExtras = {
  backgroundImage?: string;
  backgroundClip?: string;
  WebkitBackgroundClip?: string;
  WebkitTextFillColor?: string;
  WebkitFontSmoothing?: string;
  MozOsxFontSmoothing?: string;
  textRendering?: string;
};
type ExtendedTextStyle = TextStyle & WebTextExtras;

// ★ すべて起動スプラッシュ (scripts/web-postbuild.mjs の #geek-splash) と同一の固定値
const CFG = {
  BG_COLOR: '#0a0a0a',
  FONT_SIZE: 46, // splash .gk-word と同一
  LINE_HEIGHT: 46, // line-height:1.0 (splash と同一)
  LETTER_SPACING: -1, // splash と同一
  NATIVE_LOGO_COLOR: '#B98CFF',
  BAR_W: 132, // splash .gk-bar と同一
  BAR_H: 3,
  SWEEP_RATIO: 0.38, // splash ::after width:38% と同一
  BAR_GAP: 24, // splash margin-top:24px と同一
  // タイミング
  // ★ web は FADE_IN=0: 起動スプラッシュ(同一画)と即差し替えることで、splash の fade-out と
  //   イントロの fade-in が重なる瞬間の「二重像 / 一瞬の点滅」を防ぐ (handoff を継ぎ目なく)。
  FADE_IN: Platform.OS === 'web' ? 0 : 280,
  FADE_OUT: 320,
  PULSE_MS: 1600, // splash gk-pulse 1.6s
  SWEEP_MS: 1150, // splash gk-slide 1.15s
  // ★ バー(左→右スイープ)を必ず「完走」させてから退場する。退場(fade 開始)は
  //   SWEEPS_BEFORE_EXIT × SWEEP_MS にアンカー — sweep は mount(t=0) から走るので、
  //   バーが必ず右端へ到達した瞬間に一致 (途中でブツ切りにならない = 短すぎ違和感の解消)。
  //   2 周で体感 ~2.6s (= 2×1150 + 320)。最低 1 (= 必ず 1 周は左→右を見せ切る)。
  SWEEPS_BEFORE_EXIT: 2,
};

const INNER_W = Math.round(CFG.BAR_W * CFG.SWEEP_RATIO); // ≈ 50
// splash の translateX(-130% → 360%)(内側バー幅基準)を px に換算
const SWEEP_FROM = -INNER_W * 1.3;
const SWEEP_TO = INNER_W * 3.6;
// reduce motion 時のバー静止位置 (splash の translateX(85%) 相当)
const RM_SWEEP = (0.85 + 1.3) / (3.6 + 1.3); // ≈ 0.44

const GRADIENT_CSS = 'linear-gradient(120deg, #7C6AF7 0%, #B98CFF 48%, #E891C7 100%)';
const BAR_GRADIENT = ['#7C6AF7', '#E891C7'] as const;

export function IntroAnimation({ onComplete }: { onComplete: () => void }) {
  const reduceMotion = useReducedMotion();

  const containerOp = useSharedValue(0);
  const pulse = useSharedValue(1);
  const sweep = useSharedValue(0);

  const completedRef = useRef(false);
  const fireComplete = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  };

  const handleSkip = () => {
    if (completedRef.current) return;
    // skip の fade も RM 下で必ず動くように Never。
    containerOp.value = withTiming(
      0,
      { duration: 180, easing: Easing.in(Easing.quad), reduceMotion: ReduceMotion.Never },
      (finished) => {
        if (finished) runOnJS(fireComplete)();
      },
    );
  };

  useEffect(() => {
    const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

    // 1) フェードイン (RM でも必ず動かす = 1フレーム点滅防止)
    containerOp.value = withTiming(1, {
      duration: CFG.FADE_IN,
      easing: EASE_OUT,
      reduceMotion: ReduceMotion.Never,
    });

    // 2) ループ演出。RM 時は止めて splash の静止状態に合わせる。
    if (reduceMotion) {
      pulse.value = 1;
      sweep.value = RM_SWEEP; // バーを見える位置で静止 (splash と同じ振る舞い)
    } else {
      pulse.value = withRepeat(
        withTiming(0.5, { duration: CFG.PULSE_MS, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      sweep.value = withRepeat(
        withTiming(1, { duration: CFG.SWEEP_MS, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
        -1,
        false,
      );
    }

    // 3) 退場は「バーが左→右を完走した瞬間」に合わせる。setTimeout を使う理由は
    //    reanimated の withDelay が system RM 下で delay=0 に潰れ即完了→1フレーム点滅に
    //    なるため。sweep は t=0 から走るので holdUntilExit = N×SWEEP_MS でバー右端到達と一致。
    //    fade-out は Never で必ず動かす。
    const holdUntilExit = CFG.SWEEPS_BEFORE_EXIT * CFG.SWEEP_MS;
    const exitTimer = setTimeout(() => {
      containerOp.value = withTiming(
        0,
        { duration: CFG.FADE_OUT, easing: Easing.in(Easing.quad), reduceMotion: ReduceMotion.Never },
        (finished) => {
          if (finished) runOnJS(fireComplete)();
        },
      );
    }, holdUntilExit);

    // Safety: 何があっても必ず完了
    const safety = setTimeout(fireComplete, holdUntilExit + CFG.FADE_OUT + 1200);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(safety);
      cancelAnimation(pulse);
      cancelAnimation(sweep);
      cancelAnimation(containerOp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: containerOp.value }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const sweepStyle = useAnimatedStyle(() => {
    const tx = interpolate(sweep.value, [0, 1], [SWEEP_FROM, SWEEP_TO], Extrapolation.CLAMP);
    return { transform: [{ translateX: tx }] };
  });

  return (
    <Animated.View
      pointerEvents="box-only"
      onStartShouldSetResponder={() => true}
      onResponderRelease={handleSkip}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Geek"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: CFG.BG_COLOR,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        },
        containerStyle,
      ]}
    >
      <Animated.Text
        style={[wordmarkStyle(), wordStyle]}
        allowFontScaling={false}
        importantForAccessibility="no-hide-descendants"
      >
        Geek
      </Animated.Text>

      <View
        importantForAccessibility="no-hide-descendants"
        style={{
          marginTop: CFG.BAR_GAP,
          width: CFG.BAR_W,
          height: CFG.BAR_H,
          borderRadius: 99,
          backgroundColor: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}
      >
        <Animated.View style={[{ width: INNER_W, height: CFG.BAR_H }, sweepStyle]}>
          <LinearGradient
            colors={BAR_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1, borderRadius: 99 }}
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function wordmarkStyle(): ExtendedTextStyle {
  const base: ExtendedTextStyle = {
    fontFamily: LOGO_FONT,
    fontSize: CFG.FONT_SIZE,
    fontWeight: '800', // splash と同一
    letterSpacing: CFG.LETTER_SPACING,
    lineHeight: CFG.LINE_HEIGHT,
    includeFontPadding: false,
  };
  if (Platform.OS === 'web') {
    return {
      ...base,
      color: 'transparent',
      backgroundImage: GRADIENT_CSS,
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
      textRendering: 'optimizeLegibility',
    };
  }
  return { ...base, color: CFG.NATIVE_LOGO_COLOR };
}

// 旧 API 互換 (no-op)
export function markIntroShown() {}
