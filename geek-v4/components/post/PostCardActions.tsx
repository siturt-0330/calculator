// ============================================================
// PostCardActions — 投稿カードのアクション行
// ------------------------------------------------------------
// いいね / コメント / 引用 / ミームリアクション / Obsidian保存 /
// シェア / 保存 の各ボタンを横 1 行に並べる。
//
// 設計:
//   - ReactionButton (like / save) は Reanimated burst アニメ付き。
//   - ミームピッカー (MemeReactionPicker) の open/close state は
//     このコンポーネント内で保持する (状態をコロケーション)。
//   - 全ハンドラは親から useCallback で安定化した ref を受け取る。
//   - onLike / onSave / onComment / onShare / onQuote はそれぞれ
//     副作用 (楽観的更新 / Supabase mutation) を親で担当する。
//   - obsidianNote は親で useMemo 済みを受け取る (postToObsidianNote は
//     毎 render 呼ばない)。
//
// 注意:
//   - ReactionButton は AnonPostCard.tsx からインポートしていた内部コンポーネントを
//     同ファイルで再定義するのではなく、将来的に components/ui/ReactionButton.tsx へ
//     抽出する予定。現時点では AnonPostCard.tsx で定義された ReactionButton を
//     直接 JSX で使うため、このファイルは AnonPostCard.tsx の子ファイルとして
//     同じ ReactionButton を props 経由で受け取る設計とする。
//     → ReactionButton を props で渡すのではなく、liked/saved/count などの
//       データ + ハンドラを受け取り、内部でインポートした icon を組み立てる
//       シンプルな実装に落ち着く。(Icon.heart / Icon.save は constants/icons から)
// ============================================================

import { memo, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, type TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { Pressable } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Icon } from '../../constants/icons';
import type { ReactionAgg } from '../../lib/api/reactions';
import type { ObsidianNote } from '../../lib/obsidian';
import { useColors } from '../../hooks/useColors';
import { T } from '../../design/typography';
import { SP } from '../../design/tokens';
import { PressableScale } from '../ui/PressableScale';
import { ObsidianSaveButton } from '../ui/ObsidianSaveButton';
import { MemeReactionPicker } from '../feed/MemeReactionPicker';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { hap } from '../../design/haptics';
import { SPRING_BOUNCY, SPRING_SNAPPY, EASE_OUT, PRESS_SCALE } from '../../design/motion';
import { useEffect, useRef } from 'react';

// ────────────────────────────────────────────────────────────────────
// Module-scope 定数 — 毎 render 新規オブジェクトを避けるため定数化
// ────────────────────────────────────────────────────────────────────
const HIT_SLOP_10 = 10;

const SIZER_TEXT_OPACITY: TextStyle = { opacity: 0 };
const REACTION_COUNT_TEXT_ABSOLUTE: TextStyle = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  textAlign: 'left',
};
const REACTION_COUNT_WRAP_STYLE = {
  position: 'relative' as const,
  minWidth: 8,
  justifyContent: 'center' as const,
};
const REACTION_BUTTON_PRESSABLE_STYLE = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 6,
  minHeight: 44,
  minWidth: 44,
  justifyContent: 'center' as const,
};
const PARTICLE_DOT_STYLE = {
  position: 'absolute' as const,
  width: 4,
  height: 4,
  borderRadius: 2,
};

// 粒子の最終角度定数
const PARTICLE_ANGLES = [0, 60, 120, 180, 240, 300] as const;
const PARTICLE_DIST = 24;
const PARTICLE_DURATION = 320;
const COUNT_FADE_MS = 180;

// Icon モジュールスコープ alias — component body 内の per-render 再割り当てを避ける
const HeartIcon = Icon.heart;
const CommentIcon = Icon.comment;
const SaveIcon = Icon.save;
const ShareIcon = Icon.share;
const QuoteIcon = Icon.quote;

// ────────────────────────────────────────────────────────────────────
// ReactionParticle (内部)
// ────────────────────────────────────────────────────────────────────
type ReactionIcon = LucideIcon;

type ReactionButtonProps = {
  IconCmp: ReactionIcon;
  active: boolean;
  count?: number;
  onPress: () => void;
  inactiveColor: string;
  activeColor: string;
  activeFill?: string;
  iconSize?: number;
  countTextStyle?: TextStyle;
  accessibilityLabel?: string;
  hitSlop?: number;
};

function ReactionParticleInner({
  angleDeg,
  progress,
  color,
}: {
  angleDeg: number;
  progress: Animated.SharedValue<number>;
  color: string;
}) {
  const a = useAnimatedStyle(() => {
    const rad = (angleDeg * Math.PI) / 180;
    const t = progress.value;
    const x = Math.cos(rad) * PARTICLE_DIST * t;
    const y = Math.sin(rad) * PARTICLE_DIST * t;
    const s = 1 - t * 0.4;
    return {
      opacity: 1 - t,
      transform: [
        { translateX: x } as const,
        { translateY: y } as const,
        { scale: s } as const,
      ],
    };
  });
  const colorStyle = useMemo(() => ({ backgroundColor: color }), [color]);
  return (
    <Animated.View pointerEvents="none" style={[PARTICLE_DOT_STYLE, colorStyle, a]} />
  );
}
const ReactionParticle = memo(ReactionParticleInner);

// ────────────────────────────────────────────────────────────────────
// ReactionCount (内部)
// ────────────────────────────────────────────────────────────────────
function ReactionCountInner({
  value,
  textStyle,
  reduceMotion,
}: {
  value: number;
  textStyle?: TextStyle;
  reduceMotion: boolean;
}) {
  const prevRef = useRef<number>(value);
  const enterT = useSharedValue(1);
  const exitT = useSharedValue(0);
  const [displayPrev, setDisplayPrev] = useState<number | null>(null);

  useEffect(() => {
    if (prevRef.current === value) return;
    const old = prevRef.current;
    prevRef.current = value;
    if (reduceMotion) {
      setDisplayPrev(null);
      enterT.value = 1;
      exitT.value = 0;
      return;
    }
    setDisplayPrev(old);
    enterT.value = 0;
    enterT.value = withTiming(1, { duration: COUNT_FADE_MS, easing: Easing.out(Easing.cubic) });
    exitT.value = 0;
    exitT.value = withTiming(1, { duration: COUNT_FADE_MS, easing: Easing.out(Easing.cubic) });
    const timer = setTimeout(() => setDisplayPrev(null), COUNT_FADE_MS + 30);
    return () => clearTimeout(timer);
  }, [value, reduceMotion, enterT, exitT]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enterT.value,
    transform: [{ translateY: 8 * (1 - enterT.value) }],
  }));
  const exitStyle = useAnimatedStyle(() => ({
    opacity: 1 - exitT.value,
    transform: [{ translateY: -8 * exitT.value }],
  }));

  return (
    <View style={REACTION_COUNT_WRAP_STYLE}>
      <Text style={[textStyle, SIZER_TEXT_OPACITY]} numberOfLines={1}>
        {value}
      </Text>
      <Animated.Text
        style={[textStyle, REACTION_COUNT_TEXT_ABSOLUTE, enterStyle]}
        numberOfLines={1}
      >
        {value}
      </Animated.Text>
      {displayPrev != null && (
        <Animated.Text
          style={[textStyle, REACTION_COUNT_TEXT_ABSOLUTE, exitStyle]}
          numberOfLines={1}
        >
          {displayPrev}
        </Animated.Text>
      )}
    </View>
  );
}
const ReactionCount = memo(ReactionCountInner);

// ────────────────────────────────────────────────────────────────────
// ReactionButton (内部) — like / save 用のアニメ付きボタン
// ────────────────────────────────────────────────────────────────────
function ReactionButtonInner({
  IconCmp,
  active,
  count,
  onPress,
  inactiveColor,
  activeColor,
  activeFill,
  iconSize = 20,
  countTextStyle,
  accessibilityLabel,
  hitSlop = 10,
}: ReactionButtonProps) {
  const reduceMotion = useReducedMotion();
  const pressScale = useSharedValue(1);
  const burstScale = useSharedValue(1);
  const colorMix = useSharedValue(active ? 1 : 0);
  const particleProgress = useSharedValue(0);
  const [particleNonce, setParticleNonce] = useState(0);

  const prevActive = useRef<boolean>(active);
  useEffect(() => {
    if (prevActive.current === active) return;
    const becameActive = !prevActive.current && active;
    prevActive.current = active;

    colorMix.value = withTiming(active ? 1 : 0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });

    if (becameActive && !reduceMotion) {
      burstScale.value = withSequence(
        withTiming(1.35, { duration: 140, easing: EASE_OUT }),
        withSpring(1.0, SPRING_BOUNCY),
      );
      particleProgress.value = 0;
      setParticleNonce((n) => n + 1);
      particleProgress.value = withTiming(1, {
        duration: PARTICLE_DURATION,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [active, reduceMotion, colorMix, burstScale, particleProgress]);

  const iconScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value * burstScale.value }],
  }));
  const activeIconStyle = useAnimatedStyle(() => ({ opacity: colorMix.value }));
  const inactiveIconStyle = useAnimatedStyle(() => ({ opacity: 1 - colorMix.value }));

  const lastPressRef = useRef<number>(0);
  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastPressRef.current < 200) return;
    lastPressRef.current = now;
    if (active) hap.select();
    else hap.confirm();
    onPress();
  }, [active, onPress]);
  const handlePressIn = useCallback(() => {
    pressScale.value = withSpring(PRESS_SCALE, SPRING_SNAPPY);
  }, [pressScale]);
  const handlePressOut = useCallback(() => {
    pressScale.value = withSpring(1, SPRING_SNAPPY);
  }, [pressScale]);
  const a11yState = useMemo(() => ({ selected: active }), [active]);
  const iconContainerStyle = useMemo(
    () => ({
      width: iconSize,
      height: iconSize,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    }),
    [iconSize],
  );
  const particleOriginStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      width: 0,
      height: 0,
      left: iconSize / 2,
      top: iconSize / 2,
    }),
    [iconSize],
  );

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={a11yState}
      style={REACTION_BUTTON_PRESSABLE_STYLE}
    >
      <View style={iconContainerStyle} pointerEvents="none">
        {!reduceMotion && (
          <View
            key={`particles-${particleNonce}`}
            pointerEvents="none"
            style={particleOriginStyle}
          >
            {particleNonce > 0 &&
              PARTICLE_ANGLES.map((deg) => (
                <ReactionParticle
                  key={deg}
                  angleDeg={deg}
                  progress={particleProgress}
                  color={activeColor}
                />
              ))}
          </View>
        )}
        <Animated.View style={[StyleSheet.absoluteFillObject, iconScaleStyle]}>
          <Animated.View style={[StyleSheet.absoluteFillObject, inactiveIconStyle]}>
            <IconCmp size={iconSize} color={inactiveColor} strokeWidth={2.2} fill="transparent" />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFillObject, activeIconStyle]}>
            <IconCmp
              size={iconSize}
              color={activeColor}
              strokeWidth={2.2}
              fill={activeFill ?? activeColor}
            />
          </Animated.View>
        </Animated.View>
      </View>
      {count != null && count > 0 && (
        <ReactionCount value={count} textStyle={countTextStyle} reduceMotion={reduceMotion} />
      )}
    </Pressable>
  );
}
const ReactionButton = memo(ReactionButtonInner);

// ────────────────────────────────────────────────────────────────────
// makeStyles — PostCardActions 専用の動的スタイル
// ────────────────────────────────────────────────────────────────────
/* eslint-disable react-native/no-unused-styles */
const makeStyles = (text2: string, text3: string) =>
  StyleSheet.create({
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 12,
      paddingBottom: 0,
      gap: SP['5'],
    },
    actionPress: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
    },
    commentCount: { color: text3, fontSize: 13, fontWeight: '600' },
    reactionEmoji: { fontSize: 20 },
    spacer: { flex: 1 },
    iconBtn: {
      padding: 13,
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    // 使用されているが lint が誤報するプレースホルダ
    _text2Placeholder: { color: text2 },
  });
/* eslint-enable react-native/no-unused-styles */

// ────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────
export type PostCardActionsProps = {
  liked: boolean;
  saved: boolean;
  displayLikesCount: number;
  commentsCount: number;
  reactionsList: ReactionAgg[];
  myReactionsForPost: string[];
  hasMyReaction: boolean;
  onQuote?: () => void;
  obsidianNote: ObsidianNote | null;
  // 安定化済みハンドラ
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onReact: (meme: string) => void;
};

// ────────────────────────────────────────────────────────────────────
// PostCardActions
// ────────────────────────────────────────────────────────────────────
function PostCardActionsInner({
  liked,
  saved,
  displayLikesCount,
  commentsCount,
  reactionsList,
  myReactionsForPost,
  hasMyReaction,
  onQuote,
  obsidianNote,
  onLike,
  onSave,
  onComment,
  onShare,
  onReact,
}: PostCardActionsProps) {
  const C = useColors();
  const STYLES = useMemo(() => makeStyles(C.text2, C.text3), [C.text2, C.text3]);

  // ミームピッカーの開閉状態はこのコンポーネント内で保持 (状態コロケーション)
  const [memePickerOpen, setMemePickerOpen] = useState(false);

  // 安定化したハンドラ
  const openMemePicker = useCallback(() => setMemePickerOpen(true), []);
  const closeMemePicker = useCallback(() => setMemePickerOpen(false), []);

  // like カウント色スタイル
  const likeCountTextStyle = useMemo(
    () => ({ ...T.smallM, color: liked ? C.pink : C.text2 } as TextStyle),
    [liked, C.pink, C.text2],
  );

  // reaction カウント色スタイル
  const reactionCountTextStyle = useMemo(
    () => [T.smallM, { color: hasMyReaction ? C.accent : C.text3 }],
    [hasMyReaction, C.accent, C.text3],
  );

  // reaction 総数は useMemo で安定化
  const totalReactionCount = useMemo(
    () => reactionsList.reduce((a, r) => a + r.count, 0),
    [reactionsList],
  );

  return (
    <>
      <View style={STYLES.actionsRow}>
        {/* いいね */}
        <ReactionButton
          IconCmp={HeartIcon}
          active={liked}
          count={displayLikesCount}
          onPress={onLike}
          inactiveColor={C.text2}
          activeColor={C.pink}
          accessibilityLabel={liked ? 'いいね済み' : 'いいね'}
          countTextStyle={likeCountTextStyle}
        />

        {/* コメント */}
        <PressableScale
          onPress={onComment}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="コメントを開く"
          style={STYLES.actionPress}
        >
          <CommentIcon size={20} color={C.text2} strokeWidth={2.2} />
          {commentsCount > 0 && (
            <Text style={[T.smallM, STYLES.commentCount]}>{commentsCount}</Text>
          )}
        </PressableScale>

        {/* 引用ボタン — onQuote が渡された時のみ表示 */}
        {onQuote != null && (
          <PressableScale
            onPress={onQuote}
            haptic="tap"
            hitSlop={HIT_SLOP_10}
            accessibilityLabel="引用投稿"
            accessibilityHint="引用投稿を作成します"
            accessibilityRole="button"
            style={STYLES.actionPress}
          >
            <QuoteIcon size={18} color={C.text2} strokeWidth={2.2} />
          </PressableScale>
        )}

        {/* ミームリアクション */}
        <PressableScale
          onPress={openMemePicker}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="リアクションを選ぶ"
          style={STYLES.actionPress}
        >
          <Text style={STYLES.reactionEmoji}>🪶</Text>
          {reactionsList.length > 0 && (
            <Text style={reactionCountTextStyle}>{totalReactionCount}</Text>
          )}
        </PressableScale>

        <View style={STYLES.spacer} />

        {/* Obsidian 保存 */}
        {obsidianNote && (
          <ObsidianSaveButton note={obsidianNote} size={18} color={C.text3} />
        )}

        {/* シェア */}
        <PressableScale
          onPress={onShare}
          haptic="tap"
          hitSlop={HIT_SLOP_10}
          accessibilityLabel="シェア"
          accessibilityRole="button"
          style={STYLES.iconBtn}
        >
          <ShareIcon size={18} color={C.text2} strokeWidth={2.2} />
        </PressableScale>

        {/* 保存 */}
        <ReactionButton
          IconCmp={SaveIcon}
          active={saved}
          onPress={onSave}
          inactiveColor={C.text2}
          activeColor={C.amber}
          iconSize={18}
          accessibilityLabel={saved ? '保存済み' : '保存'}
        />
      </View>

      {/* ミームピッカーモーダル */}
      <MemeReactionPicker
        visible={memePickerOpen}
        onClose={closeMemePicker}
        onPick={onReact}
        picked={myReactionsForPost}
        reactions={reactionsList}
      />
    </>
  );
}

export const PostCardActions = memo(PostCardActionsInner);
