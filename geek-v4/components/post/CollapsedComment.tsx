// ============================================================
// CollapsedComment — 連続する低品質コメントを折りたたみ chip 化する UI
// ------------------------------------------------------------
// Reddit ガイド 5.3 / 5.10 章の「低評価コメントは非表示ではなく折りたたみ」
// を体現する component。タップで展開し、children をそのまま render する。
//
// 使い方:
//   <CollapsedComment count={3}>
//     <CommentThreadItem ... />
//     <CommentThreadItem ... />
//     <CommentThreadItem ... />
//   </CollapsedComment>
//
// 見た目 (GEEK-Rail に統一 — CommentThreadItem の枠全廃路線と一貫):
//   - 横長 chip: 枠なし (borderWidth / SHADOW は撤去)、R.md、背景 C.bg3 (subtle)
//   - 左の「グループ化バー」は RAIL_W(2) / C.border2 (★divider ではない = light で
//     見える)。CommentThreadItem のレールと同じ線体系に揃える。
//   - chevron は Icon.chevronD で 0 → 180deg 回転 (▼ → ▲ 相当)
//   - count バッジは枠なしのフラット pill (背景 C.bg2 / R.full / C.text3 fontWeight700)
//   - 展開後 (expanded=true) は children をそのまま render し、上部に「折りたたむ」
//     chip を残してまた閉じられるようにする。子ラッパの左バーも C.border2 に統一。
//   ★ CollapsedComment の中の CommentThreadItem は root(depth=0) として渡るので
//     エルボーを描かない。よって depth0 のレールとこの左バーは二重化しない。
//
// アニメーション (CommentThreadItem と一貫):
//   - chevron rotate 0deg → 180deg (withTiming 180ms easing.out)
//   - 子セクションの高さ伸縮: Layout.springify({damping:26, stiffness:280})
//   - 子の出現: FadeIn / FadeOut 180ms
//   - ReduceMotion 時は spring / layout transition をスキップして即時切替
// ============================================================

import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  Layout,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { PressableScale } from '../ui/PressableScale';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// レール線の太さ (CommentThreadItem と統一)
const RAIL_W = 2;
// 折りたたみ展開時の spring (CommentThreadItem と統一)
const COLLAPSE_SPRING = { damping: 26, stiffness: 280, mass: 0.8 } as const;
const CHEVRON_TIMING = { duration: 180, easing: Easing.out(Easing.cubic) } as const;
const REDUCED_TIMING = { duration: 150, easing: Easing.out(Easing.cubic) } as const;
const BODY_FADE_MS = 180;

export type CollapsedCommentProps = {
  /** 折りたたみ中のコメント数 (2 以上を想定) */
  count: number;
  /** 展開時に render される子 — 通常は <CommentThreadItem> のリスト */
  children?: React.ReactNode;
  /** 初期 expanded 状態 (default: false = 畳んでいる) */
  initiallyExpanded?: boolean;
};

export function CollapsedComment({
  count,
  children,
  initiallyExpanded = false,
}: CollapsedCommentProps) {
  const C = useColors();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(initiallyExpanded);

  // chip 表示時のラベル — chevron は別の Icon で出すので emoji ▼/▲ は外す
  const label = expanded ? '折りたたむ' : `${count} 件の低評価コメントを表示`;

  const a11y = expanded
    ? `${count} 件の低評価コメントを折りたたむ`
    : `${count} 件の低評価コメントを表示`;

  // chevron 回転 (0 = ▼, 1 = ▲ 相当)
  const chevronProgress = useSharedValue(initiallyExpanded ? 1 : 0);

  useEffect(() => {
    const target = expanded ? 1 : 0;
    chevronProgress.value = withTiming(target, reduceMotion ? REDUCED_TIMING : CHEVRON_TIMING);
  }, [expanded, reduceMotion, chevronProgress]);

  // 0 → 180deg 回転で expanded を表現 (CommentThreadItem と統一)
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 180}deg` }],
  }));

  return (
    <View style={{ width: '100%', marginVertical: 4 }}>
      <PressableScale
        onPress={() => setExpanded((s) => !s)}
        haptic="tap"
        hitSlop={6}
        accessibilityLabel={a11y}
        accessibilityState={{ expanded }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          paddingHorizontal: SP['3'],
          paddingVertical: SP['2'],
          backgroundColor: C.bg3,
          borderRadius: R.md,
        }}
      >
        {/* 左の縦バーで「グループ化された区画」感を出す。
            RAIL_W(2) / C.border2 で CommentThreadItem のレールと同じ線体系に。 */}
        <View
          style={{
            width: RAIL_W,
            height: 14,
            backgroundColor: C.border2,
            borderRadius: 1,
          }}
        />
        {/* chevron — 0deg(▼) ↔ 180deg(▲) で expanded を表現 */}
        <Animated.View style={chevronStyle}>
          <Icon.chevronD size={12} color={C.text2} strokeWidth={2.4} />
        </Animated.View>
        <Text style={[T.smallM, { color: C.text2, fontWeight: '700', flex: 1 }]} numberOfLines={1}>
          {label}
        </Text>
        {!expanded && (
          <View
            style={{
              paddingHorizontal: SP['2'],
              paddingVertical: 2,
              backgroundColor: C.bg2,
              borderRadius: R.full,
            }}
          >
            <Text style={[T.caption, { color: C.text3, fontWeight: '700' }]}>{count}</Text>
          </View>
        )}
      </PressableScale>

      {/* 展開時のみ children を render — Layout.springify で兄弟 layout を spring 伸縮 */}
      {expanded && (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(BODY_FADE_MS)}
          exiting={reduceMotion ? undefined : FadeOut.duration(BODY_FADE_MS)}
          layout={
            reduceMotion
              ? undefined
              : Layout.springify()
                  .damping(COLLAPSE_SPRING.damping)
                  .stiffness(COLLAPSE_SPRING.stiffness)
                  .mass(COLLAPSE_SPRING.mass)
          }
          style={{
            marginTop: 4,
            // 左の薄いガイドバーで「折りたたみグループの内側」を示す。
            // CommentThreadItem のレール色 (C.border2) と一致させ同じ線体系に。
            borderLeftWidth: RAIL_W,
            borderLeftColor: C.border2,
            paddingLeft: SP['2'],
          }}
        >
          {children}
        </Animated.View>
      )}
    </View>
  );
}
