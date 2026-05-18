import { useEffect, useMemo } from 'react';
import { StyleSheet, Platform, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  withRepeat,
  runOnJS,
  Easing,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { FONT } from '@/design/typography';

// ============================================================
// ⚙ 設定 — シネマティック起動演出
// ============================================================
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SHORTER = Math.min(SCREEN_W, SCREEN_H);
const LONGER = Math.max(SCREEN_W, SCREEN_H);

// 高解像度描画戦略:
// テキストを RENDER_MULT 倍の解像度で描画し、初期スケールを 1/RENDER_MULT に。
// 拡大時にビットマップが粗くならず、超高画質を維持できる。
const RENDER_MULT = 12;

const VISUAL_FONT_SIZE = Math.round(Math.min(SHORTER * 0.28, 160));
const FONT_SIZE = VISUAL_FONT_SIZE * RENDER_MULT;
const LETTER_SPACING_PX = Math.round(-VISUAL_FONT_SIZE * 0.02) * RENDER_MULT;
const GLOW_OUTER = Math.round(VISUAL_FONT_SIZE * 0.22) * RENDER_MULT;
const GLOW_INNER = Math.round(VISUAL_FONT_SIZE * 0.10) * RENDER_MULT;
const INITIAL_SCALE = 1 / RENDER_MULT;

// === Syne_700Bold の各文字幅の経験値（FONT_SIZE 比率） ===
const WIDTH_RATIO = { G: 0.66, e: 0.46, k: 0.56 } as const;

const CFG = {
  REVEAL_DURATION:      560,   // G の登場をもう少しじっくり
  INITIAL_HOLD:         324,
  PER_LETTER_DURATION:  555,
  LETTER_OVERLAP:       209,
  AFTER_COMPLETE_HOLD:  509,
  ZOOM_DURATION:       1296,
  FADE_OUT_DURATION:    371,

  BG_COLOR:        '#000000',
  LOGO_COLOR:      '#FFFFFF',
  GLOW_COLOR:      '#7C6AF7',
  GLOW_COLOR_SOFT: '#B19FFF',
  ACCENT_CYAN:     '#5EE7FF',
  ACCENT_PINK:     '#FF5E9B',
  FONT_FAMILY:     FONT.display,
  FONT_SIZE,
  LETTER_SPACING:  LETTER_SPACING_PX,

  GLOW_RADIUS_OUTER: GLOW_OUTER,
  GLOW_RADIUS_INNER: GLOW_INNER,

  RISE_PX:           14 * RENDER_MULT,    // e/e/k 用 (上から降りる)
  SCALE_FROM:        1.18,                 // e/e/k 用
  G_SCALE_FROM:      0.35,                 // G 用: 小さく点火して膨らむ
  G_RISE_PX:         0,                    // G は中央でじっとして上下動なし

  ZOOM_MAX_SCALE:     30 / RENDER_MULT,
  ZOOM_LETTER_SPACING: Math.round(VISUAL_FONT_SIZE * 0.7) * RENDER_MULT,

  EASE_REVEAL: Easing.bezier(0.16, 1, 0.3, 1),
  EASE_FADE:   Easing.bezier(0.16, 1, 0.3, 1),
  EASE_SHIFT:  Easing.bezier(0.22, 1, 0.36, 1),
  EASE_ZOOM:   Easing.bezier(0.45, 0, 0.85, 0.4),
};

// ============================================================
const LETTERS = ['G', 'e', 'e', 'k'] as const;
const PARTICLE_COUNT = 36;

function computeShifts(): [number, number, number, number] {
  const widths = [
    FONT_SIZE * WIDTH_RATIO.G,
    FONT_SIZE * WIDTH_RATIO.e,
    FONT_SIZE * WIDTH_RATIO.e,
    FONT_SIZE * WIDTH_RATIO.k,
  ];
  const spaced = widths.map((w, i) => w + (i > 0 ? LETTER_SPACING_PX : 0));
  const positions: number[] = [];
  let cum = 0;
  for (let i = 0; i < 4; i++) {
    positions.push(cum);
    cum += spaced[i]!;
  }
  const total = cum;
  const visibleEnds = spaced.map((w, i) => positions[i]! + w);
  return visibleEnds.map((end) => total / 2 - end / 2) as [number, number, number, number];
}

// 決定論的な擬似乱数 (seed 固定で毎回同じ配置 → flicker しない)
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

type Particle = {
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
  color: string;
  hue: number;
};

function buildParticles(): Particle[] {
  const rand = seededRandom(42);
  const palette = [CFG.GLOW_COLOR, CFG.GLOW_COLOR_SOFT, CFG.ACCENT_CYAN, '#FFFFFF'];
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    x: rand() * SCREEN_W,
    y: rand() * SCREEN_H,
    size: 1.5 + rand() * 3,
    delay: rand() * 1500,
    duration: 3000 + rand() * 4000,
    drift: (rand() - 0.5) * 80,
    color: palette[Math.floor(rand() * palette.length)] ?? CFG.GLOW_COLOR,
    hue: rand(),
  }));
}

// ============================================================
export function IntroAnimation({ onComplete }: { onComplete: () => void }) {
  const shifts = computeShifts();
  const particles = useMemo(buildParticles, []);

  // === 文字の状態 ===
  const o0 = useSharedValue(0);
  const o1 = useSharedValue(0);
  const o2 = useSharedValue(0);
  const o3 = useSharedValue(0);
  const opacities = [o0, o1, o2, o3];

  // G は小さく発火、e/e/k は上から降りる
  const s0 = useSharedValue(CFG.G_SCALE_FROM);
  const s1 = useSharedValue(CFG.SCALE_FROM);
  const s2 = useSharedValue(CFG.SCALE_FROM);
  const s3 = useSharedValue(CFG.SCALE_FROM);
  const scales = [s0, s1, s2, s3];

  // G は中央で発火するので上下動なし、e/e/k は上から降りる
  const y0 = useSharedValue(CFG.G_RISE_PX);
  const y1 = useSharedValue(CFG.RISE_PX);
  const y2 = useSharedValue(CFG.RISE_PX);
  const y3 = useSharedValue(CFG.RISE_PX);
  const yOffsets = [y0, y1, y2, y3];

  // G の点火フラッシュ (G が land する瞬間に光が炸裂)
  const ignitionFlash = useSharedValue(0);
  const ignitionScale = useSharedValue(0.15);

  const wordShift = useSharedValue(shifts[0]);
  const containerScale = useSharedValue(INITIAL_SCALE);
  const containerOpacity = useSharedValue(1);
  const spacingAnim = useSharedValue(CFG.LETTER_SPACING);
  const glowOuter = useSharedValue(0);
  const glowInner = useSharedValue(0);

  // === 新しい演出用の shared values ===
  const sweepX = useSharedValue(-SCREEN_W);
  const sweepOpacity = useSharedValue(0);
  const chromaShift = useSharedValue(0);   // RGB 分離強度 (px)
  const ring1 = useSharedValue(0);          // 0→1 で広がる
  const ring2 = useSharedValue(0);
  const ring3 = useSharedValue(0);
  const shakeX = useSharedValue(0);
  const shakeY = useSharedValue(0);
  const bgPulse = useSharedValue(0);        // 0→1 脈動
  const particlesOpacity = useSharedValue(0);

  useEffect(() => {
    const PD = CFG.PER_LETTER_DURATION;
    const OL = CFG.LETTER_OVERLAP;
    const REV = CFG.REVEAL_DURATION;
    const HOLD = CFG.INITIAL_HOLD;

    // パーティクルと脈動はすぐに開始
    particlesOpacity.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) });
    bgPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );

    const animateLetter = (idx: number, delay: number) => {
      const dur = idx === 0 ? REV : PD;
      opacities[idx]!.value = withDelay(
        delay,
        withTiming(1, { duration: dur, easing: CFG.EASE_FADE }),
      );
      scales[idx]!.value = withDelay(
        delay,
        withTiming(1, { duration: dur * 1.15, easing: CFG.EASE_REVEAL }),
      );
      yOffsets[idx]!.value = withDelay(
        delay,
        withTiming(0, { duration: dur * 1.1, easing: CFG.EASE_REVEAL }),
      );
    };

    // === G の特別な点火演出 ===
    // 1. 小さい (0.35) → 大きく overshoot (1.06) → 落ち着いて 1.0 へ
    // 2. land する瞬間にフラッシュ
    s0.value = withSequence(
      withTiming(1.06, { duration: REV, easing: Easing.bezier(0.22, 1, 0.36, 1) }),
      withTiming(1, { duration: 220, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
    );
    opacities[0]!.value = withTiming(1, { duration: REV * 0.7, easing: CFG.EASE_FADE });

    // 点火フラッシュ: G が land する瞬間 (REV 直後) に光が膨らんで消える
    ignitionFlash.value = withDelay(
      REV - 80,
      withSequence(
        withTiming(0.95, { duration: 90, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 520, easing: Easing.in(Easing.quad) }),
      ),
    );
    ignitionScale.value = withDelay(
      REV - 80,
      withTiming(1.8, { duration: 600, easing: Easing.out(Easing.cubic) }),
    );

    const t1 = REV + HOLD;
    const t2 = t1 + (PD - OL);
    const t3 = t2 + (PD - OL);

    animateLetter(1, t1);
    animateLetter(2, t2);
    animateLetter(3, t3);

    wordShift.value = withDelay(
      REV,
      withSequence(
        withTiming(shifts[0], { duration: HOLD, easing: Easing.linear }),
        withTiming(shifts[1], { duration: PD - OL, easing: CFG.EASE_SHIFT }),
        withTiming(shifts[2], { duration: PD - OL, easing: CFG.EASE_SHIFT }),
        withTiming(shifts[3], { duration: PD, easing: CFG.EASE_SHIFT }),
      ),
    );

    const completeAt = t3 + PD;

    glowOuter.value = withDelay(
      completeAt - 185,
      withSequence(
        withTiming(0.55, { duration: 324, easing: Easing.out(Easing.cubic) }),
        withTiming(0.32, { duration: 417, easing: Easing.inOut(Easing.sin) }),
      ),
    );
    glowInner.value = withDelay(
      completeAt - 185,
      withSequence(
        withTiming(0.9, { duration: 324, easing: Easing.out(Easing.cubic) }),
        withTiming(0.6, { duration: 417, easing: Easing.inOut(Easing.sin) }),
      ),
    );

    // ★ 光のスイープ: 各文字が完成した直後に走らせる (k 完成タイミング)
    const SWEEP_AT = completeAt - 280;
    sweepOpacity.value = withDelay(
      SWEEP_AT,
      withSequence(
        withTiming(0.9, { duration: 100, easing: Easing.out(Easing.cubic) }),
        withDelay(380, withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) })),
      ),
    );
    sweepX.value = withDelay(
      SWEEP_AT,
      withTiming(SCREEN_W, { duration: 720, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
    );

    const ZOOM_START = completeAt + CFG.AFTER_COMPLETE_HOLD;

    // ★ ズーム開始時にリング3つを順に発射
    ring1.value = withDelay(
      ZOOM_START,
      withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }),
    );
    ring2.value = withDelay(
      ZOOM_START + 140,
      withTiming(1, { duration: 1000, easing: Easing.out(Easing.cubic) }),
    );
    ring3.value = withDelay(
      ZOOM_START + 280,
      withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) }),
    );

    // ★ クロマティック収差: ズーム中に強くなって最後に消える
    chromaShift.value = withDelay(
      ZOOM_START,
      withSequence(
        withTiming(8, { duration: 380, easing: Easing.out(Easing.cubic) }),
        withTiming(22, { duration: 600, easing: Easing.in(Easing.cubic) }),
        withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
      ),
    );

    // ★ シェイク: ズーム最終局面で軽くカメラが揺れる
    const SHAKE_AT = ZOOM_START + CFG.ZOOM_DURATION - 480;
    const shakeAmount = 6;
    shakeX.value = withDelay(
      SHAKE_AT,
      withSequence(
        withTiming(shakeAmount, { duration: 50 }),
        withTiming(-shakeAmount, { duration: 50 }),
        withTiming(shakeAmount * 0.7, { duration: 45 }),
        withTiming(-shakeAmount * 0.7, { duration: 45 }),
        withTiming(shakeAmount * 0.4, { duration: 40 }),
        withTiming(-shakeAmount * 0.4, { duration: 40 }),
        withTiming(0, { duration: 60 }),
      ),
    );
    shakeY.value = withDelay(
      SHAKE_AT + 20,
      withSequence(
        withTiming(-shakeAmount * 0.6, { duration: 60 }),
        withTiming(shakeAmount * 0.6, { duration: 50 }),
        withTiming(-shakeAmount * 0.3, { duration: 50 }),
        withTiming(shakeAmount * 0.3, { duration: 50 }),
        withTiming(0, { duration: 60 }),
      ),
    );

    containerScale.value = withDelay(
      ZOOM_START,
      withTiming(CFG.ZOOM_MAX_SCALE, { duration: CFG.ZOOM_DURATION, easing: CFG.EASE_ZOOM }),
    );
    spacingAnim.value = withDelay(
      ZOOM_START,
      withTiming(CFG.ZOOM_LETTER_SPACING, { duration: CFG.ZOOM_DURATION, easing: CFG.EASE_ZOOM }),
    );

    const FADE_START = ZOOM_START + CFG.ZOOM_DURATION - 231;
    const ANIM_TOTAL = FADE_START + CFG.FADE_OUT_DURATION;
    containerOpacity.value = withDelay(
      FADE_START,
      withTiming(0, { duration: CFG.FADE_OUT_DURATION, easing: Easing.in(Easing.quad) }, () => {
        runOnJS(onComplete)();
      }),
    );

    // ★ Safety
    const safetyTimer = setTimeout(() => {
      onComplete();
    }, ANIM_TOTAL + 1500);
    return () => clearTimeout(safetyTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }, { translateY: shakeY.value }],
  }));

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: containerScale.value }],
  }));

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: wordShift.value }],
    letterSpacing: spacingAnim.value,
  }));

  const outerGlowStyle = useAnimatedStyle(() => ({ opacity: glowOuter.value }));
  const innerGlowStyle = useAnimatedStyle(() => ({ opacity: glowInner.value }));

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: sweepOpacity.value,
    transform: [{ translateX: sweepX.value }, { skewX: '-18deg' }],
  }));

  // G の点火フラッシュ (中央で円が膨らんで消える)
  const ignitionStyle = useAnimatedStyle(() => ({
    opacity: ignitionFlash.value,
    transform: [{ scale: ignitionScale.value }],
  }));

  // 背景の脈動: 中央 radial gradient (Animated.View で円を二つ重ねる)
  const pulseAStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bgPulse.value, [0, 1], [0.18, 0.42], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(bgPulse.value, [0, 1], [0.85, 1.15], Extrapolation.CLAMP) }],
  }));
  const pulseBStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bgPulse.value, [0, 1], [0.10, 0.25], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(bgPulse.value, [0, 1], [1.2, 0.95], Extrapolation.CLAMP) }],
  }));

  const particlesStyle = useAnimatedStyle(() => ({
    opacity: particlesOpacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: CFG.BG_COLOR,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          overflow: 'hidden',
        },
        backgroundStyle,
      ]}
    >
      {/* 背景脈動グラデ (radial っぽい円を2つ) */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: LONGER * 1.6,
            height: LONGER * 1.6,
            borderRadius: LONGER,
            backgroundColor: CFG.GLOW_COLOR,
          },
          pulseAStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: LONGER * 1.1,
            height: LONGER * 1.1,
            borderRadius: LONGER,
            backgroundColor: CFG.ACCENT_CYAN,
          },
          pulseBStyle,
        ]}
      />

      {/* パーティクル */}
      <Animated.View style={[StyleSheet.absoluteFill, particlesStyle]}>
        {particles.map((p, i) => (
          <ParticleDot key={i} {...p} />
        ))}
      </Animated.View>

      {/* リング (ズーム開始時に拡散) */}
      <Ring v={ring1} maxScale={6} color={CFG.GLOW_COLOR} thickness={3} />
      <Ring v={ring2} maxScale={9} color={CFG.GLOW_COLOR_SOFT} thickness={2} />
      <Ring v={ring3} maxScale={13} color={CFG.ACCENT_CYAN} thickness={1.5} />

      <Animated.View style={[StyleSheet.absoluteFill, shakeStyle, { alignItems: 'center', justifyContent: 'center' }]}>
        {/* G の点火フラッシュ (文字の真後ろで光が膨らむ) */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: VISUAL_FONT_SIZE * 2.2,
              height: VISUAL_FONT_SIZE * 2.2,
              borderRadius: VISUAL_FONT_SIZE,
              backgroundColor: '#FFFFFF',
              shadowColor: CFG.GLOW_COLOR_SOFT,
              shadowOpacity: 1,
              shadowRadius: 80,
              shadowOffset: { width: 0, height: 0 },
            },
            ignitionStyle,
          ]}
        />
        <Animated.View style={zoomStyle}>
          <Animated.View style={[{ flexDirection: 'row', alignItems: 'baseline' }, rowStyle]}>
            {LETTERS.map((char, i) => (
              <FadeLetter
                key={i}
                char={char}
                opacity={opacities[i]!}
                scale={scales[i]!}
                yOffset={yOffsets[i]!}
                outerGlow={outerGlowStyle}
                innerGlow={innerGlowStyle}
                chromaShift={chromaShift}
              />
            ))}
          </Animated.View>
        </Animated.View>

        {/* 光のスイープ (skewX で斜めの光) */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: 90,
              backgroundColor: '#FFFFFF',
              shadowColor: '#FFFFFF',
              shadowOpacity: 1,
              shadowRadius: 60,
              shadowOffset: { width: 0, height: 0 },
            },
            sweepStyle,
          ]}
        />
      </Animated.View>
    </Animated.View>
  );
}

// =====================================
// Particle
// =====================================
function ParticleDot(p: Particle) {
  const a = useSharedValue(0);
  const y = useSharedValue(p.y);
  const x = useSharedValue(p.x);

  useEffect(() => {
    a.value = withDelay(
      p.delay,
      withRepeat(
        withSequence(
          withTiming(0.6 + p.hue * 0.4, { duration: p.duration * 0.5, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.05, { duration: p.duration * 0.5, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );
    y.value = withDelay(
      p.delay,
      withRepeat(
        withTiming(p.y + p.drift, { duration: p.duration, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
    x.value = withDelay(
      p.delay,
      withRepeat(
        withTiming(p.x + p.drift * 0.5, { duration: p.duration * 1.2, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left: x.value,
    top: y.value,
    width: p.size,
    height: p.size,
    borderRadius: p.size,
    backgroundColor: p.color,
    opacity: a.value,
    shadowColor: p.color,
    shadowOpacity: 0.9,
    shadowRadius: p.size * 2,
    shadowOffset: { width: 0, height: 0 },
  }));

  return <Animated.View style={style} pointerEvents="none" />;
}

// =====================================
// 拡張リング
// =====================================
function Ring({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  v,
  maxScale,
  color,
  thickness,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  v: any;
  maxScale: number;
  color: string;
  thickness: number;
}) {
  const SIZE = Math.round(SHORTER * 0.32);
  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: thickness,
    borderColor: color,
    opacity: interpolate(v.value, [0, 0.1, 1], [0, 0.85, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(v.value, [0, 1], [0.2, maxScale], Extrapolation.CLAMP) }],
  }));
  return <Animated.View style={style} pointerEvents="none" />;
}

// =====================================
// 文字 (RGB クロマティック収差つき)
// =====================================
function FadeLetter({
  char,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opacity,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scale,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yOffset,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outerGlow,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  innerGlow,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chromaShift,
}: {
  char: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opacity: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scale: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yOffset: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outerGlow: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  innerGlow: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chromaShift: any;
}) {
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { scale: scale.value },
      { translateY: yOffset.value },
    ],
  }));

  // ズーム時の RGB 分離: chromaShift は 0..22 (px、見た目スケール上で)
  // 高解像度レイヤーなので RENDER_MULT 倍する
  const chromaR = useAnimatedStyle(() => ({
    transform: [{ translateX: -chromaShift.value * RENDER_MULT }],
    opacity: interpolate(chromaShift.value, [0, 8, 22], [0, 0.7, 0.95], Extrapolation.CLAMP),
  }));
  const chromaB = useAnimatedStyle(() => ({
    transform: [{ translateX: chromaShift.value * RENDER_MULT }],
    opacity: interpolate(chromaShift.value, [0, 8, 22], [0, 0.7, 0.95], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[{ position: 'relative' }, fadeStyle]}>
      {/* 外側グロー */}
      <Animated.Text
        style={[
          baseLogoStyle(),
          {
            position: 'absolute',
            color: 'transparent',
            textShadowColor: CFG.GLOW_COLOR,
            textShadowRadius: CFG.GLOW_RADIUS_OUTER,
            textShadowOffset: { width: 0, height: 0 },
          },
          outerGlow,
        ]}
      >
        {char}
      </Animated.Text>
      {/* 内側グロー */}
      <Animated.Text
        style={[
          baseLogoStyle(),
          {
            position: 'absolute',
            color: 'transparent',
            textShadowColor: CFG.GLOW_COLOR_SOFT,
            textShadowRadius: CFG.GLOW_RADIUS_INNER,
            textShadowOffset: { width: 0, height: 0 },
          },
          innerGlow,
        ]}
      >
        {char}
      </Animated.Text>
      {/* RGB 分離 R チャンネル */}
      <Animated.Text style={[baseLogoStyle(), { position: 'absolute', color: CFG.ACCENT_PINK }, chromaR]}>
        {char}
      </Animated.Text>
      {/* RGB 分離 B チャンネル */}
      <Animated.Text style={[baseLogoStyle(), { position: 'absolute', color: CFG.ACCENT_CYAN }, chromaB]}>
        {char}
      </Animated.Text>
      {/* 本体 (白) */}
      <Animated.Text style={[baseLogoStyle(), { color: CFG.LOGO_COLOR }]}>
        {char}
      </Animated.Text>
    </Animated.View>
  );
}

function baseLogoStyle() {
  const base = {
    fontFamily: CFG.FONT_FAMILY,
    fontSize: CFG.FONT_SIZE,
    fontWeight: '700' as const,
    letterSpacing: CFG.LETTER_SPACING,
    color: CFG.LOGO_COLOR,
    includeFontPadding: false as const,
  };
  if (Platform.OS === 'web') {
    return {
      ...base,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      WebkitFontSmoothing: 'antialiased',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MozOsxFontSmoothing: 'grayscale',
      textRendering: 'geometricPrecision',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
  return base;
}

export function markIntroShown() {
  // 旧 API 互換のため残すが no-op
}
