import { View, LayoutChangeEvent } from 'react-native';
import { useState, useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '../ui/PressableScale';
import { R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { SPRING_SEGMENT, TIMING_NORM } from '../../design/motion';
import { useColors, useGradients } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useT } from '../../lib/i18n';
import type { FeedScope } from '../../stores/feedStore';

const PAD = 3;
// Apple Segmented Control 風 spring (damping 22, stiffness 240) ※ 指示書準拠
// — 同値だった design/motion.ts の SPRING_SEGMENT token 参照に統一 (体感不変)
const SCOPE_SPRING = SPRING_SEGMENT;

// 2 値で固定 (open / closed) — 配列を component 外に持つと再 render 時に
// useEffect の依存が安定する。
// ★ 2026-06-12 ユーザー要望: 'closed' の意味を「選択した # のみ」から
//   「参加していないコミュニティの投稿だけ」(= 新しいコミュの発見モード) に変更。
//   store の値 ('open'/'closed') は永続化互換のため変えない。
const OPTIONS = [
  { v: 'open' as FeedScope, label: 'すべて', sub: '全部' },
  { v: 'closed' as FeedScope, label: '未参加のコミュ', sub: 'みつける' },
] as const;

export function ScopeToggle({
  value,
  onChange,
  disabledClosed,
  onClosedWhenEmpty,
}: {
  value: FeedScope;
  onChange: (v: FeedScope) => void;
  disabledClosed?: boolean; // closed (好きだけ) を視覚的にハイライト解除
  onClosedWhenEmpty?: () => void; // disabledClosed 時に closed を押したら呼ばれる
}) {
  const t = useT();
  const C = useColors();
  const GRAD = useGradients();
  const reduceMotion = useReducedMotion();

  const [w, setW] = useState(0);
  const innerW = Math.max(0, w - PAD * 2);
  const segW = innerW / OPTIONS.length;
  const idx = Math.max(0, OPTIONS.findIndex((o) => o.v === value));

  // pill の位置 (translateX)
  const x = useSharedValue(0);
  // shake (closed disabled 時の "効かない" フィードバック) — container 全体を揺らす
  const shakeX = useSharedValue(0);

  useEffect(() => {
    if (segW <= 0) return;
    const target = idx * segW;
    if (reduceMotion) {
      x.value = target;
    } else {
      x.value = withSpring(target, SCOPE_SPRING);
    }
  }, [idx, segW, x, reduceMotion]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: segW,
  }));

  const containerShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  // closed が disabled の時の shake animation. translateX -4 → +4 → 0 を 250ms で。
  const triggerShake = () => {
    if (reduceMotion) return;
    shakeX.value = withSequence(
      withTiming(-4, { duration: 60 }),
      withTiming(4, { duration: 70 }),
      withTiming(-3, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    );
  };

  return (
    <Animated.View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      style={[
        {
          flexDirection: 'row',
          backgroundColor: C.bg3,
          borderRadius: R.full,
          padding: PAD,
          borderWidth: 1,
          borderColor: C.border,
          position: 'relative',
          overflow: 'hidden',
        },
        containerShakeStyle,
      ]}
    >
      {/* sliding pill — Apple Segmented Control 風 */}
      {segW > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: PAD,
              bottom: PAD,
              left: PAD,
              borderRadius: R.full,
              overflow: 'hidden',
              // closed が dimmed の時は active pill 自体も控えめにする
              opacity: disabledClosed && value === 'closed' ? 0.5 : 1,
              ...SHADOW.glow,
            },
            pillStyle,
          ]}
        >
          <LinearGradient
            colors={GRAD.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
        </Animated.View>
      )}

      {OPTIONS.map((m) => {
        const active = value === m.v;
        const dimmed = !!disabledClosed && m.v === 'closed';
        const handlePress = () => {
          if (dimmed) {
            triggerShake();
            if (onClosedWhenEmpty) onClosedWhenEmpty();
            return;
          }
          onChange(m.v);
        };
        return (
          <ScopeItem
            key={m.v}
            label={m.label}
            active={active}
            dimmed={dimmed}
            onPress={handlePress}
            translate={t}
            reduceMotion={reduceMotion}
            // ★ 2026-06-13: active ラベルは常に白。pill は両テーマで濃色グラデ
            //   (dark=紫 / light=チャコール) なので C.text (light で黒) だと
            //   黒文字 on チャコール pill = 不可視になっていた (ユーザー報告)。
            textColor="#ffffff"
            textColorInactive={C.text2}
          />
        );
      })}
    </Animated.View>
  );
}

// ============================================================
// ScopeItem — active 文字色を withTiming(180ms) でフェード
// ============================================================
function ScopeItem({
  label,
  active,
  dimmed,
  onPress,
  translate,
  reduceMotion,
  textColor,
  textColorInactive,
}: {
  label: string;
  active: boolean;
  dimmed: boolean;
  onPress: () => void;
  translate: (s: string) => string;
  reduceMotion: boolean;
  textColor: string;
  textColorInactive: string;
}) {
  // dimmed の場合は active 表現を抑える (= inactive 寄り)
  const showActive = active && !dimmed;
  const progress = useSharedValue(showActive ? 1 : 0);

  useEffect(() => {
    const target = showActive ? 1 : 0;
    if (reduceMotion) {
      progress.value = target;
    } else {
      progress.value = withTiming(target, { duration: 180, easing: TIMING_NORM.easing });
    }
  }, [showActive, reduceMotion, progress]);

  const activeTextStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const inactiveTextStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      accessibilityRole="tab"
      accessibilityState={{ selected: active, disabled: dimmed }}
      style={{
        flex: 1,
        paddingVertical: SP['2'],
        paddingHorizontal: SP['3'],
        borderRadius: R.full,
        alignItems: 'center',
        justifyContent: 'center',
        // dimmed の時は item 自体も控えめにする (タップ自体は通る)
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <View>
        <Animated.Text
          style={[
            T.smallM,
            {
              color: textColor,
              fontWeight: '700',
              letterSpacing: 0.3,
            },
            activeTextStyle,
          ]}
        >
          {translate(label)}
        </Animated.Text>
        <Animated.Text
          style={[
            T.smallM,
            {
              position: 'absolute',
              left: 0,
              right: 0,
              textAlign: 'center',
              color: textColorInactive,
              fontWeight: '500',
              letterSpacing: 0,
            },
            inactiveTextStyle,
          ]}
        >
          {translate(label)}
        </Animated.Text>
      </View>
    </PressableScale>
  );
}
