import { useEffect, useRef } from 'react';
import { StyleSheet, Dimensions, Platform, View, type TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { LOGO_FONT } from '../../design/typography';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  interpolate,
  Extrapolation,
  runOnJS,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';

// ============================================================
// Geek イントロ — 起動スプラッシュ (web の instant splash) と同一デザイン
// ============================================================
// 設計意図 (継ぎ目のない起動体験):
//   web では HTML の起動スプラッシュ (scripts/web-postbuild.mjs が注入する
//   「Geek グラデ ワードマーク + 進捗バー」) が JS 到着前から出ている。
//   アプリ mount 後に出るこのイントロを **同じ見た目** にすることで、
//   スプラッシュ → イントロ → 本体 がデザイン的に途切れず続く。
//   native では起動スプラッシュ画面 → このイントロ で同じトーンを共有する。
//
//   - 背景 #0a0a0a / 中央に「Geek」(グラデ) + 下に細い進捗バー (左→右スライド)
//   - ワードマークは ゆっくり明滅 (pulse)、進捗バーは sweep ループ
//   - 旧イントロ (1文字ずつ出して突き抜けズーム ~3s) は廃止。短く上品に。
//   - useReducedMotion 時は pulse / sweep を止め、静止表示 + フェードのみ。
//   - タップでスキップ。onComplete / markIntroShown の契約は不変 (_layout.tsx 互換)。
//
// グラデ文字:
//   - web: CSS background-clip:text で「Geek」自体をグラデ塗り (スプラッシュと同一)。
//   - native: react-native の Text はグラデ文字を直接持てないので単色 (#B98CFF) で
//     代替する (グラデ文字の native 対応は MaskedView/SVG での follow-up)。
//   進捗バーは expo-linear-gradient なので native でもグラデで出る。
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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SHORTER = Math.min(SCREEN_W, SCREEN_H);

const CFG = {
  BG_COLOR: '#0a0a0a', // 起動スプラッシュと同一
  // ワードマーク (スプラッシュより少し大きめ。デザイン言語は同一)
  FONT_SIZE: Math.round(Math.min(SHORTER * 0.17, 80)),
  LETTER_SPACING: -1,
  NATIVE_LOGO_COLOR: '#B98CFF', // native フォールバック (グラデ中間色)
  // 進捗バー
  BAR_W: Math.round(Math.min(SHORTER * 0.42, 176)),
  BAR_H: 3,
  SWEEP_RATIO: 0.38, // 内側バー幅 = BAR_W * 0.38
  BAR_GAP: 28, // ワードマークとバーの間隔
  // タイミング (ms) — 短く上品に (~1.9s)
  FADE_IN: 280,
  HOLD: 1320,
  FADE_OUT: 320,
  PULSE_MS: 1600,
  SWEEP_MS: 1150,
};

// web のグラデ (スプラッシュ CSS と同一の stop)
const GRADIENT_CSS = 'linear-gradient(120deg, #7C6AF7 0%, #B98CFF 48%, #E891C7 100%)';
const BAR_GRADIENT = ['#7C6AF7', '#E891C7'] as const;

export function IntroAnimation({ onComplete }: { onComplete: () => void }) {
  const reduceMotion = useReducedMotion();

  const containerOp = useSharedValue(0); // 全体フェード in/out
  const pulse = useSharedValue(1); // ワードマークの明滅
  const sweep = useSharedValue(0); // 進捗バーのスライド進捗 0→1

  const innerW = Math.round(CFG.BAR_W * CFG.SWEEP_RATIO);

  // 完了の二重発火ガード (タップスキップ + 自動完了の競合防止)
  const completedRef = useRef(false);
  const fireComplete = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  };

  const handleSkip = () => {
    if (completedRef.current) return;
    containerOp.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, () => {
      runOnJS(fireComplete)();
    });
  };

  useEffect(() => {
    const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

    // 1) フェードイン
    containerOp.value = withTiming(1, { duration: CFG.FADE_IN, easing: EASE_OUT });

    // 2) ループ演出 (reduce motion 時は静止)
    if (!reduceMotion) {
      pulse.value = withRepeat(
        withTiming(0.5, { duration: CFG.PULSE_MS, easing: Easing.inOut(Easing.quad) }),
        -1,
        true, // 1↔0.5 を往復
      );
      sweep.value = withRepeat(
        withTiming(1, { duration: CFG.SWEEP_MS, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
        -1,
        false, // 左→右 を繰り返す (毎回左端に戻る)
      );
    }

    // 3) フェードアウト → 完了
    const exitAt = CFG.FADE_IN + CFG.HOLD;
    containerOp.value = withDelay(
      exitAt,
      withTiming(0, { duration: CFG.FADE_OUT, easing: Easing.in(Easing.quad) }, () => {
        runOnJS(fireComplete)();
      }),
    );

    // Safety: 何があっても必ず完了させる
    const safety = setTimeout(fireComplete, exitAt + CFG.FADE_OUT + 1200);
    return () => clearTimeout(safety);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({ opacity: containerOp.value }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const sweepStyle = useAnimatedStyle(() => {
    const tx = interpolate(sweep.value, [0, 1], [-innerW, CFG.BAR_W], Extrapolation.CLAMP);
    return { transform: [{ translateX: tx }] };
  });

  return (
    <Animated.View
      pointerEvents="box-only"
      onStartShouldSetResponder={() => true}
      onResponderRelease={handleSkip}
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
      <Animated.Text style={[wordmarkStyle(), wordStyle]} allowFontScaling={false}>
        Geek
      </Animated.Text>

      <View
        style={{
          marginTop: CFG.BAR_GAP,
          width: CFG.BAR_W,
          height: CFG.BAR_H,
          borderRadius: 99,
          backgroundColor: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}
      >
        <Animated.View style={[{ width: innerW, height: CFG.BAR_H }, sweepStyle]}>
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
    fontWeight: '800',
    letterSpacing: CFG.LETTER_SPACING,
    lineHeight: Math.round(CFG.FONT_SIZE * 1.04),
    includeFontPadding: false,
  };
  if (Platform.OS === 'web') {
    // CSS background-clip:text で「Geek」自体をグラデ塗り (起動スプラッシュと同一)
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
  // native: 単色フォールバック
  return { ...base, color: CFG.NATIVE_LOGO_COLOR };
}

// 旧 API 互換 (no-op)
export function markIntroShown() {}
