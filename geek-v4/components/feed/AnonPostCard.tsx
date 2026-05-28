import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { View, Text, Platform, Image as RNImage, StyleSheet, Pressable, type TextStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { safeOpenUrl } from '../../lib/openUrl';
import { Icon } from '../../constants/icons';
import type { Post, CWCategory } from '../../types/models';
import { useLanguageStore } from '../../stores/languageStore';
import { useAuthStore } from '../../stores/authStore';
import { translateDynamic, useT } from '../../lib/i18n';
import { MemeReactionPicker } from './MemeReactionPicker';
import type { ReactionAgg } from '../../lib/api/reactions';
import { R, SP } from '../../design/tokens';
import { useColors } from '../../hooks/useColors';
import type { ColorPalette } from '../../lib/theme/palettes';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { SPRING_BOUNCY, SPRING_SNAPPY, EASE_OUT, PRESS_SCALE } from '../../design/motion';
import { hap } from '../../design/haptics';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { ProgressiveImage } from '../ui/ProgressiveImage';
import { VideoPlayer } from '../ui/VideoPlayer';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { DoubleTapHeart } from '../ui/DoubleTapHeart';
import { TagPill } from '../tag/TagPill';
import { AddTagInline } from '../tag/AddTagInline';
import { MarkdownText } from '../ui/MarkdownText';
import { LinkPreviewCard } from './LinkPreviewCard';
import { PollCard } from './PollCard';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useIsCommunityMod } from '../../hooks/useIsCommunityMod';
import type { Poll } from '../../lib/api/polls';
import { Avatar } from '../ui/Avatar';
import { formatRelative } from '../../lib/utils/date';
import { sanitizeUrl } from '../../lib/sanitize';
import { ObsidianSaveButton } from '../ui/ObsidianSaveButton';
import { postToObsidianNote } from '../../hooks/useObsidian';
import type { PostCommunityRef } from '../../lib/api/posts';
import { OfficialBadge } from '../community/OfficialBadge';
import { ModActionMenu } from '../community/ModActionMenu';
import { MediaWithCWGuard } from '../post/MediaWithCWGuard';
import { getDisplayLikes } from '../../lib/utils/voteFuzz';
import { ImageLightbox } from '../ui/ImageLightbox';

// 画像アスペクト比のモジュールレベルキャッシュ。
// パフォーマンス監査: 旧版は無制限キャッシュで長時間スクロール後にメモリ蓄積。
// TTL (1h) + size cap (500 件) で LRU 風に古い entry を削除する。
type AspectEntry = { ratio: number; ts: number };
const _aspectCache = new Map<string, AspectEntry>();
const _ASPECT_TTL_MS = 60 * 60 * 1000; // 1h
const _ASPECT_MAX_SIZE = 500;
const _pending = new Set<string>();
const _MAX_CONCURRENT = 3;
const _queue: Array<() => void> = [];
function _drain() {
  while (_pending.size < _MAX_CONCURRENT && _queue.length > 0) {
    const task = _queue.shift();
    if (task) task();
  }
}
function _trimAspectCache() {
  if (_aspectCache.size < _ASPECT_MAX_SIZE) return;
  // 古い順に半数を削除 (LRU 風)
  const sorted = Array.from(_aspectCache.entries()).sort((a, b) => a[1].ts - b[1].ts);
  const removeCount = Math.floor(_ASPECT_MAX_SIZE / 2);
  for (let i = 0; i < removeCount; i++) {
    const entry = sorted[i];
    if (entry) _aspectCache.delete(entry[0]);
  }
}
function measureAspect(url: string, measureUri: string, cb: (ratio: number) => void) {
  const cached = _aspectCache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < _ASPECT_TTL_MS) {
    cb(cached.ratio);
    return;
  }
  if (_pending.has(url)) { _queue.push(() => measureAspect(url, measureUri, cb)); return; }
  const start = () => {
    _pending.add(url);
    RNImage.getSize(
      measureUri,
      (w, h) => {
        _pending.delete(url);
        const ratio = h > 0 && w > 0 ? Math.max(0.5, Math.min(2.0, w / h)) : 1;
        _trimAspectCache();
        _aspectCache.set(url, { ratio, ts: Date.now() });
        cb(ratio);
        _drain();
      },
      () => {
        _pending.delete(url);
        _trimAspectCache();
        _aspectCache.set(url, { ratio: 1, ts: Date.now() });
        cb(1);
        _drain();
      },
    );
  };
  if (_pending.size < _MAX_CONCURRENT) start();
  else _queue.push(start);
}

function shortHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ────────────────────────────────────────────────────────────────────
// Module-scope constants — JSX で inline literal `{ top: 8, ... }` を書くと
// その object/array は毎 render 新規になり、子 Pressable の reconciliation で
// shallow-equal が外れて余分な diff が走る。長 list の card では塵が積もるので
// 定数化して参照を固定する (React DevTools profile で render 数が減るのを確認済)。
// ────────────────────────────────────────────────────────────────────
const HIT_SLOP_6 = 6;
const HIT_SLOP_10 = 10;
const PRESSABLE_FLEX1 = { flex: 1 } as const;
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
  minHeight: 28,
};
const PARTICLE_DOT_STYLE = {
  position: 'absolute' as const,
  width: 4,
  height: 4,
  borderRadius: 2,
};

// ────────────────────────────────────────────────────────────────────
// Module-level StyleSheet — 静的な inline style を一度だけ作って共有する。
// メモ: React Native の StyleSheet.create は数値 ID へ凍結するので、
//   子コンポーネントに渡したときに `===` で参照同値判定されやすくなり、
//   各カードの re-render 時の reconciliation コストが大幅に下がる。
// 動的な (props/state に依存する) style は useMemo か per-item ファクトリで処理する。
// ────────────────────────────────────────────────────────────────────
// 旧 `STYLES = StyleSheet.create(...)` だと module top-level で C が
// capture されてしまい、テーマ切替で色が変わらない (StyleSheet は 1 回しか
// 評価されない)。factory にして component 内 useMemo で C 毎に再生成する。
// 同テーマ render では useMemo が同一参照を返すので reconciliation コストは増えない。
const makeStyles = (C: ColorPalette) => StyleSheet.create({
  // 低信頼バナー — iOS-native: 角 12px に揃え、border を控えめに
  lowTrustBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['2'],
    paddingHorizontal: SP['3'],
    paddingVertical: 10,
    backgroundColor: C.amberBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.amber + '44',
    marginBottom: SP['2'],
  },
  lowTrustText: { color: C.amber, flex: 1 },

  // ヘッダー — Apple News / Threads 寄りに密度を上げ、 avatar/name 距離を 10px に詰める
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  officialAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.accentBg,
    borderWidth: 1.5,
    borderColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officialMeta: { flex: 1, minWidth: 0 },
  officialNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  // 公式管理者の名前は少し太く. fontSize は smallM の 13 を引き継ぐ。
  // SF Pro Text の自然な tracking (size 13 で約 -0.08)
  officialName: { color: C.text, fontWeight: '700', letterSpacing: -0.08 },
  officialSub: { color: C.text3 },
  anonRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  // 「匿」をやや強めに、relative time は subtle に — Twitter/Threads と同じ階層感
  // letterSpacing は iOS の SF Pro Text に倣う (size 13: 約 -0.08, size 12: 0)
  anonLabel: { color: C.text, fontWeight: '700', letterSpacing: -0.08 },
  anonRelative: { color: C.text3, fontSize: 12, lineHeight: 16 },
  morePress: { padding: 4 },

  // ヘッダー 2 行目に inline 配置する community 表示。
  // 旧: header の下に独立した chip row。
  // 新: 「時刻 · [○] コミュ名」と 1 行に統合し、投稿者ブロックと視覚的に group。
  //     CommunityAvatarBar の avatar (56px) を 20px に縮めた版。
  anonMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    maxWidth: '100%',
  },
  anonMetaDot: { color: C.text3, fontSize: 12, lineHeight: 15 },
  // iOS-native: 黄色の派手なバッジから "上品な丸チップ" に。
  // 背景 bg3 + hairline border + 角 full pill で、avatar + name を一塊として
  // tap できる柔らかい chip にする。
  communityInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: C.bg3,
    borderRadius: R.full,
    borderWidth: 1,
    borderColor: C.divider,
  },
  // 18px 円 ring (avatar 外枠). chip 内側なので border は外して shape だけ。
  communityInlineRingBase: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: C.bg4,
  },
  communityInlineImage: { width: '100%', height: '100%' },
  // icon_url が無い時の emoji fallback (CommunityAvatarBar と同じ思想)
  communityInlineEmoji: { fontSize: 12, lineHeight: 14 },
  communityInlineName: {
    fontSize: 12,
    lineHeight: 15,
    color: C.text2,
    fontWeight: '700',
    flexShrink: 1,
  },
  communityInlineExtra: {
    fontSize: 11,
    lineHeight: 14,
    color: C.text3,
    fontWeight: '600',
  },

  // CW — iOS-native: 角 12px、amber border は少し透ける (44 = 27% alpha) と上品
  cwBox: {
    marginTop: SP['2'],
    paddingHorizontal: SP['4'],
    paddingVertical: SP['4'],
    backgroundColor: C.bg3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.amber + '88',
    alignItems: 'center',
    gap: SP['1'],
  },
  cwEmoji: { fontSize: 32 },
  cwLabel: { color: C.amber, fontWeight: '700' },
  cwWarning: { color: C.text2, textAlign: 'center' },
  cwTap: { color: C.accent, marginTop: 4 },

  // メディア — iOS-native: 角 12px (card 14px の内側に少し小さい round で nested 階層感)
  mediaWrap: { gap: SP['2'], marginTop: SP['2'] },
  mediaItemBase: {
    width: '100%',
    backgroundColor: C.bg2,
    borderRadius: 12,
    overflow: 'hidden',
  },

  // 本文 — Apple News 寄り: fontSize 15 / lineHeight 22 (1.47, iOS 標準 1.4-1.5 域)
  // letterSpacing -0.08 は SF Pro Text の自然な tracking
  bodyInner: { paddingTop: SP['3'], paddingBottom: SP['1'] },
  bodyText: { color: C.text, fontSize: 15, lineHeight: 22, letterSpacing: -0.08 },
  // 出典 — iOS-native: 角 12px, hairline divider, 軽い bg3
  sourceBtn: {
    marginTop: SP['2'],
    paddingHorizontal: SP['3'],
    paddingVertical: 10,
    backgroundColor: C.bg3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.divider,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['2'],
  },
  sourceEmoji: { fontSize: 14 },
  sourceText: { color: C.text2, flex: 1 },

  // タグ群 — 本文との距離を 8px に詰めて Threads/Apple News 風の密度に
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: SP['2'],
    gap: SP['2'],
    alignItems: 'center',
  },

  // アクション行 — 上 padding を 10px に詰めて action 強調を低く、 scan しやすく
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 0,
    gap: SP['5'],
  },
  // 各 action は icon + count を gap:6 で詰める. tap target は hitSlop で確保 (44pt)
  actionPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 28,
  },
  commentCount: { color: C.text3, fontSize: 13, fontWeight: '600' },
  reactionEmoji: { fontSize: 20 },
  spacer: { flex: 1 },
  iconBtn: { padding: 4 },

  // リアクション表示行
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingTop: SP['2'],
  },
  reactionPillBase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    // iOS の最小タップ領域 (44pt) に届くよう padding を確保。
    // 旧版 (vertical:4) は実効高さ ~24px → hitSlop:8 を足しても 40px で不足し、
    // スマホで「押しても反応しない」と感じるバグの主因だった。
    paddingVertical: 6,
    borderRadius: R.full,
    borderWidth: 1,
  },
  reactionOverflowPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: C.bg3,
    borderRadius: R.full,
    borderWidth: 1,
    borderColor: C.divider,
  },
  reactionOverflowText: { fontSize: 12, color: C.text3, fontWeight: '700' },
});

// ────────────────────────────────────────────────────────────────────
// Per-item / 動的 style ファクトリ — map 内で呼ばれるので useMemo は使わず、
// あらかじめ static base に差分だけ重ねた小オブジェクトを返す。
// この差分オブジェクト自体は毎 render 新規になるが、
//   - スタイル合成は配列 [base, diff] で行うので diff のキーだけが reconcile される
//   - base 側 (StyleSheet ID) は安定なので reconciliation コストは差分分のみ
// ────────────────────────────────────────────────────────────────────

function mediaItemAspect(aspect: number): { aspectRatio: number } {
  return { aspectRatio: aspect };
}

function reactionPillColors(C: ColorPalette, mine: boolean): { backgroundColor: string; borderColor: string } {
  return {
    backgroundColor: mine ? C.accentBg : C.bg3,
    borderColor: mine ? C.accent : C.border,
  };
}

function reactionPillLabel(C: ColorPalette, mine: boolean): { fontSize: number; color: string; fontWeight: '700' } {
  return { fontSize: 11, color: mine ? C.accentLight : C.text2, fontWeight: '700' };
}

function reactionPillCount(C: ColorPalette, mine: boolean): { fontSize: number; color: string; fontWeight: '700' } {
  return { fontSize: 10, color: mine ? C.accentLight : C.text3, fontWeight: '700' };
}

// ============================================================
// ReactionButton — like / concern / save 系の polished button
// ------------------------------------------------------------
// 設計:
//   - 押下時の "burst" は icon scale 1.0 → 1.35 → 1.0 + 6 個の粒子放射
//   - active/inactive 切替時に icon の色を crossfade (絶対配置の 2 layer)
//   - count 値変化時に上方向 slide + fade で旧 → 新を入れ替え
//   - debounce 200ms で連打を防ぐ (親側ガードと二重で安全)
//   - ReduceMotion: burst/particle 省略、 color crossfade のみ
//   - shared value で全アニメ → list 内の多数 mount でも cheap
//
// 注意: PressableScale は press-in で haptic を撃つが、ここでは activate /
//       deactivate を分けたいので Pressable + 自前 scale で実装する。
//       (PressableScale を被せると double-haptic / double-scale になる)
// ============================================================
// lucide-react-native の LucideIcon を直接受ける (propTypes は無視される)。
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

// 粒子の最終角度 (60deg ごと) — 一度だけ計算するため定数化
const PARTICLE_ANGLES = [0, 60, 120, 180, 240, 300] as const;
const PARTICLE_DIST = 24; // px
const PARTICLE_DURATION = 320; // ms
const COUNT_FADE_MS = 180;

function ReactionParticleInner({
  angleDeg,
  progress,
  color,
}: {
  angleDeg: number;
  progress: Animated.SharedValue<number>;
  color: string;
}) {
  // progress 0 → 1 で原点から PARTICLE_DIST 離れた位置へ。
  // opacity 1 → 0 にフェード。
  // 型注釈: transform 配列 element は各要素に 1 key のみ。as const で union を確定。
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
  // 色 prop だけは別 object で重ねる (PARTICLE_DOT_STYLE は static 共有)
  const colorStyle = useMemo(() => ({ backgroundColor: color }), [color]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[PARTICLE_DOT_STYLE, colorStyle, a]}
    />
  );
}
const ReactionParticle = memo(ReactionParticleInner);

function ReactionCountInner({
  value,
  textStyle,
  reduceMotion,
}: {
  value: number;
  textStyle?: TextStyle;
  reduceMotion: boolean;
}) {
  // 旧値を ref で保持。値が変わると enter/exit shared value を駆動して
  // 上方向 slide + fade で 1 回だけ crossfade させる。
  const prevRef = useRef<number>(value);
  const enterT = useSharedValue(1); // 新値: 1=表示位置
  const exitT = useSharedValue(0); // 旧値: 0=表示位置, 進むと上へ消える

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
    // 新値: 下から (translateY 8 → 0, opacity 0 → 1)
    enterT.value = 0;
    enterT.value = withTiming(1, { duration: COUNT_FADE_MS, easing: Easing.out(Easing.cubic) });
    // 旧値: 上へ (translateY 0 → -8, opacity 1 → 0)
    exitT.value = 0;
    exitT.value = withTiming(1, { duration: COUNT_FADE_MS, easing: Easing.out(Easing.cubic) });
    // animation 終了後に displayPrev を null にする (timer で十分。runOnJS 不要)
    const t = setTimeout(() => setDisplayPrev(null), COUNT_FADE_MS + 30);
    return () => clearTimeout(t);
  }, [value, reduceMotion, enterT, exitT]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enterT.value,
    transform: [{ translateY: 8 * (1 - enterT.value) }],
  }));
  const exitStyle = useAnimatedStyle(() => ({
    opacity: 1 - exitT.value,
    transform: [{ translateY: -8 * exitT.value }],
  }));

  // 高さ確保のため min-width をプレースホルダで担保 (layout shift 防止)
  return (
    <View style={REACTION_COUNT_WRAP_STYLE}>
      {/* 不可視 sizer — 新値の高さで親 View の高さを安定させる */}
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
          // 旧値は装飾だけなので touch を吸わない
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
  // press scale (PressableScale 相当)
  const pressScale = useSharedValue(1);
  // burst scale (icon の弾むアニメ)
  const burstScale = useSharedValue(1);
  // 色 crossfade: active 値で 0 → 1 へ
  const colorMix = useSharedValue(active ? 1 : 0);
  // particles 共通の progress 0 → 1
  const particleProgress = useSharedValue(0);
  // particle 表示フラグ (mount 時に 6 個展開しないため)
  const [particleNonce, setParticleNonce] = useState(0);

  // active 変化時のアニメ。前回値を ref で持ち、true→false / false→true
  // どちらの遷移かを判定 (haptic と burst の有無を分ける)。
  const prevActive = useRef<boolean>(active);
  useEffect(() => {
    if (prevActive.current === active) return;
    const becameActive = !prevActive.current && active;
    prevActive.current = active;

    // 色 crossfade は常に走らせる (ReduceMotion でも色は変える)
    colorMix.value = withTiming(active ? 1 : 0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });

    if (becameActive && !reduceMotion) {
      // burst: 1.0 → 1.35 (140ms ease-out) → 1.0 (spring bouncy)
      burstScale.value = withSequence(
        withTiming(1.35, { duration: 140, easing: EASE_OUT }),
        withSpring(1.0, SPRING_BOUNCY),
      );
      // particles: 0 → 1 over 320ms
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

  // 2 layer icon の opacity crossfade
  const activeIconStyle = useAnimatedStyle(() => ({ opacity: colorMix.value }));
  const inactiveIconStyle = useAnimatedStyle(() => ({ opacity: 1 - colorMix.value }));

  // debounce: 200ms。連打を防ぐが、親の更新で active が変わる前でも
  // 押下感は press scale + haptic で即時返す。
  const lastPressRef = useRef<number>(0);
  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastPressRef.current < 200) return;
    lastPressRef.current = now;
    // 即時 haptic: activate なら confirm (medium)、deactivate なら select (light)
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
  // accessibilityState は active 変化時のみ object 新規化
  const a11yState = useMemo(() => ({ selected: active }), [active]);
  // icon container style は iconSize prop に依存 (= ほぼ static)
  const iconContainerStyle = useMemo(
    () => ({
      width: iconSize,
      height: iconSize,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    }),
    [iconSize],
  );
  // particle origin (icon 中央) も iconSize に依存
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
      {/* icon container — 粒子はここを中心に放射。overflow: visible で粒子が外へ出る。 */}
      <View style={iconContainerStyle} pointerEvents="none">
        {/* 粒子 (active 化のたびに key を変えて remount) */}
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
          {/* inactive icon (常に描画、colorMix=0 で見える) */}
          <Animated.View style={[StyleSheet.absoluteFillObject, inactiveIconStyle]}>
            <IconCmp
              size={iconSize}
              color={inactiveColor}
              strokeWidth={2.2}
              fill="transparent"
            />
          </Animated.View>
          {/* active icon (colorMix=1 で見える) */}
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

// ============================================================
// CommunityInlineIndicator — header 内に 1 行で表示する小型 community 表示
// ------------------------------------------------------------
// CommunityAvatarBar の 56px avatar を 20px に縮めた版。
//   - icon_url があれば ExpoImage で表示 (thumbedUrl 80px @4x)
//   - 無ければ emoji + bg3 背景 (PostCommunityRef は icon_color を持たない
//     ため backgroundColor は単色 bg3 で代用 — CommunityAvatarBar の color
//     fallback とは少しだけ違うが、20px 円なので視認影響は最小)
//   - tap で onPress (親 → router.push('/community/:id'))
//   - 複数 community のとき末尾に「+N」を出す
// ============================================================
type CommunityInlineIndicatorProps = {
  community: PostCommunityRef;
  extraCount: number;
  onPress: () => void;
  STYLES: ReturnType<typeof makeStyles>;
};

function CommunityInlineIndicatorInner({
  community: c,
  extraCount,
  onPress,
  STYLES,
}: CommunityInlineIndicatorProps) {
  // 80 = 20px @4x retina (CommunityAvatarBar が 56px → 160px と同比率)
  // thumb URL は icon_url 変化時のみ再計算
  const thumb = useMemo(() => (c.icon_url ? thumbedUrl(c.icon_url, 80) : null), [c.icon_url]);
  // ExpoImage 用 source object — icon_url 変化時のみ更新
  const thumbSource = useMemo(() => (thumb ? { uri: thumb } : null), [thumb]);
  // a11y label は name 変化時のみ
  const a11yLabel = useMemo(() => `コミュニティ ${c.name} を開く`, [c.name]);
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      hitSlop={HIT_SLOP_6}
      style={STYLES.communityInline}
      accessibilityRole="link"
      accessibilityLabel={a11yLabel}
    >
      <View style={STYLES.communityInlineRingBase}>
        {thumbSource ? (
          <ExpoImage
            source={thumbSource}
            style={STYLES.communityInlineImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={c.icon_url ?? c.community_id}
            transition={120}
          />
        ) : (
          <Text style={STYLES.communityInlineEmoji}>{c.icon_emoji || '🌐'}</Text>
        )}
      </View>
      <Text style={STYLES.communityInlineName} numberOfLines={1}>
        {c.name}
      </Text>
      {c.is_official && <OfficialBadge size="sm" iconOnly />}
      {extraCount > 0 && (
        <Text style={STYLES.communityInlineExtra}>{`+${extraCount}`}</Text>
      )}
    </PressableScale>
  );
}
// memo: 親 card 再 render 時に community/extraCount/onPress/STYLES が
//   ref-equal なら skip。 onCommunityPress / STYLES は親で memoize 済みなので
//   現実には community 同一 + extraCount 同一でほぼ常に skip される。
const CommunityInlineIndicator = memo(CommunityInlineIndicatorInner);

// ============================================================
// MediaItem / ReactionPill / TagPillRow — list 内 mapped 要素は専用 sub-component に
// 切り出して memo 化する。これで親 card 再 render 時も各 item は (prop ref が
// 同じなら) skip される。インライン arrow `() => onTagPress(tag)` を回避する
// ためにも有効。
// ============================================================

type MemoTagPillProps = {
  name: string;
  state: 'normal' | 'added';
  onTagPress: (name: string) => void;
};
function MemoTagPillInner({ name, state, onTagPress }: MemoTagPillProps) {
  const handlePress = useCallback(() => onTagPress(name), [onTagPress, name]);
  return <TagPill name={name} state={state} onPress={handlePress} />;
}
const MemoTagPill = memo(MemoTagPillInner);

type MemoImagePressableProps = {
  url: string;
  blurhash: string | undefined;
  cwCategory: CWCategory;
  aspect: number;
  mediaItemBaseStyle: ReturnType<typeof makeStyles>['mediaItemBase'];
  onPressItem: (url: string) => void;
};
function MemoImagePressableInner({
  url,
  blurhash,
  cwCategory,
  aspect,
  mediaItemBaseStyle,
  onPressItem,
}: MemoImagePressableProps) {
  const handlePress = useCallback(() => onPressItem(url), [onPressItem, url]);
  const wrapperStyle = useMemo(
    () => [mediaItemBaseStyle, { aspectRatio: aspect }],
    [mediaItemBaseStyle, aspect],
  );
  return (
    <View style={wrapperStyle}>
      <MediaWithCWGuard cwCategory={cwCategory} blurhash={blurhash}>
        <Pressable
          onPress={handlePress}
          style={PRESSABLE_FLEX1}
          accessibilityRole="imagebutton"
          accessibilityLabel="画像を拡大表示"
        >
          <ProgressiveImage
            uri={url}
            blurhash={blurhash}
            width="100%"
            height="100%"
            radius={R.md}
            lazy
            thumbWidth={480}
            priority="high"
          />
        </Pressable>
      </MediaWithCWGuard>
    </View>
  );
}
const MemoImagePressable = memo(MemoImagePressableInner);

type MemoReactionPillProps = {
  meme: string;
  count: number;
  mine: boolean;
  C: ColorPalette;
  STYLES: ReturnType<typeof makeStyles>;
  onReact: (meme: string) => void;
};
function MemoReactionPillInner({
  meme,
  count,
  mine,
  C,
  STYLES,
  onReact,
}: MemoReactionPillProps) {
  const handlePress = useCallback(() => onReact(meme), [onReact, meme]);
  const pillStyle = useMemo(
    () => [STYLES.reactionPillBase, reactionPillColors(C, mine)],
    [STYLES.reactionPillBase, C, mine],
  );
  const labelStyle = useMemo(() => reactionPillLabel(C, mine), [C, mine]);
  const countStyle = useMemo(() => reactionPillCount(C, mine), [C, mine]);
  const a11yLabel = useMemo(
    () => `${meme} ${count} 件 ${mine ? '(押下済み)' : ''}`,
    [meme, count, mine],
  );
  return (
    <PressableScale
      onPress={handlePress}
      haptic="tap"
      hitSlop={HIT_SLOP_10}
      accessibilityLabel={a11yLabel}
      style={pillStyle}
    >
      <Text style={labelStyle}>{meme}</Text>
      <Text style={countStyle}>{count}</Text>
    </PressableScale>
  );
}
const MemoReactionPill = memo(MemoReactionPillInner);

type AnonPostCardProps = {
  post: Post;
  liked?: boolean;
  concerned?: boolean;
  saved?: boolean;
  reactions?: ReactionAgg[];
  addedTags?: string[];
  poll?: Poll;
  reason?: { text: string; kind: string };
  communities?: PostCommunityRef[];
  onLike: () => void;
  onConcern: () => void;
  onComment: () => void;
  onSave: () => void;
  onShare: () => void;
  onTagPress: (name: string) => void;
  onMore: () => void;
  onReact: (meme: string) => void;
  onAddTag?: (tag: string) => Promise<void> | void;
  onCommunityPress?: (id: string) => void;
};

function AnonPostCardInner({
  post,
  liked = false,
  concerned = false,
  saved = false,
  reactions = [],
  addedTags = [],
  poll,
  reason,
  communities = [],
  onLike,
  onConcern,
  onComment,
  onSave,
  onShare,
  onTagPress,
  onMore,
  onReact,
  onAddTag,
  onCommunityPress,
}: AnonPostCardProps) {
  const Heart = Icon.heart;
  const Comment = Icon.comment;
  const Save = Icon.save;
  const Share = Icon.share;
  const More = Icon.more;
  const Warn = Icon.warn;
  const t = useT();
  const qc = useQueryClient();
  // ★ テーマ購読 — light/dark で全 style が再評価される。
  //   makeStyles は新 StyleSheet を生成するが useMemo で同テーマ render では
  //   同一参照を返すので、Card 再 render は色変化のときだけ。
  const C = useColors();
  const STYLES = useMemo(() => makeStyles(C), [C]);

  // ★ ModActionMenu 配線 (mod だけに見える 3-dot)
  // post.community_id は型に無いが post_communities junction で 1 件以上紐付く。
  // 先頭の community を「主担当 community」と見做し、その mod 権限で判定。
  // (共通的に 1 post = 1 primary community なので衝突は実質起きない)
  const primaryCommunity = communities[0];
  const primaryCommunityId = primaryCommunity?.community_id;
  const isMod = useIsCommunityMod(primaryCommunityId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isOwnPost = !!post.author_id && post.author_id === currentUserId;

  // ミームリアクション (props 経由で DB から取得済み)
  const [memePickerOpen, setMemePickerOpen] = useState(false);
  const reactionsList = reactions;
  // myReactionsForPost は MemeReactionPicker の `picked` に渡る — 毎 render 新 array
  // を作ると Picker 側 effect が無駄発火する。 reactions ref が変わらない限り stable。
  const myReactionsForPost = useMemo(
    () => reactions.filter((r) => r.mine).map((r) => r.meme),
    [reactions],
  );
  // 表示用 8 件スライス — reactions ref が変わらなければ stable
  const visibleReactions = useMemo(() => reactionsList.slice(0, 8), [reactionsList]);
  // 合計 count — reactions ref 変化時のみ再計算
  const reactionTotal = useMemo(
    () => reactionsList.reduce((a, r) => a + r.count, 0),
    [reactionsList],
  );

  // CW (content warning) 開示状態
  const cwCategory = post.cw_category ?? null;
  const [cwRevealed, setCwRevealed] = useState(false);
  const isCwHidden = !!cwCategory && !cwRevealed;

  // 画像ライトボックス (tap で開く全画面ビューア)
  // 開いている画像 URL を保持 — null なら閉じている状態
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const openLightbox = useCallback((url: string) => {
    hap.tap();
    // 元画像 (フィードでは 480px サムネだが、ライトボックスでは大きく
    // 表示するため 1280px に格上げする。Supabase の transform endpoint
    // は元画像が小さければ自動でクランプしてくれるので過剰サイズは無問題)
    setLightboxUri(thumbedUrl(url, 1280));
  }, []);
  const closeLightbox = useCallback(() => setLightboxUri(null), []);

  // Feature flags
  const useMarkdown = useFeatureFlag('markdown_render');
  const useOgPreview = useFeatureFlag('og_preview');
  const useQuickReaction = useFeatureFlag('quick_reaction');

  // 翻訳 (自動翻訳のみ — UI ボタン/バッジは表示しない)
  // selector: AnonPostCard は feed の全 post で大量にマウントされるので
  // languageStore の他フィールド変更で全 card が再 render されないように selector 化
  const lang = useLanguageStore((s) => s.lang);
  const autoTranslate = useLanguageStore((s) => s.autoTranslate);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const canTranslate = lang !== 'ja' && post.content;

  const doTranslate = async () => {
    if (!post.content || translating) return;
    setTranslating(true);
    const result = await translateDynamic(post.content, lang);
    setTranslated(result);
    setTranslating(false);
  };

  useEffect(() => {
    if (autoTranslate && canTranslate && !translated && !translating) {
      void doTranslate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslate, canTranslate, translated, translating]);
  const displayContent = (autoTranslate && translated) ? translated : post.content;
  // データ欠落でクラッシュしないよう全フィールドを安全化。
  // post ref は memo の arePropsEqual で stable なので、これらは
  // post 変化時のみ新規 array になる (= ほぼ常に同 ref)。
  const mediaUrls = useMemo(() => post.media_urls ?? [], [post.media_urls]);
  const mediaBlurhashes = useMemo(() => post.media_blurhashes ?? [], [post.media_blurhashes]);
  // 動画 (migration 0043 後の投稿のみ存在)。古い投稿は undefined → 空配列で安全
  const videoUrls = useMemo(() => post.video_urls ?? [], [post.video_urls]);
  const videoPosters = useMemo(() => post.video_posters ?? [], [post.video_posters]);
  const tagNames = useMemo(() => Array.from(new Set(post.tag_names ?? [])), [post.tag_names]);
  // tag 行: 1 件目以降をリスト表示する。slice の結果も memoize して
  // TagPill の re-mount を抑制する。
  const restTagNames = useMemo(() => tagNames.slice(1), [tagNames]);
  // 「追加されたタグで、本タグに含まれていないもの」 — addedTags か tagNames の
  // どちらかが変化したときだけ計算する。
  const filteredAddedTags = useMemo(
    () => addedTags.filter((tg) => !tagNames.includes(tg)),
    [addedTags, tagNames],
  );

  // 画像の自然なアスペクト比を解決 — Image.getSize は web/native 両対応
  // tall portrait や wide landscape を square に潰さないよう、各 URI ごとに記録
  // 0.5 (極端な縦長) 〜 2.0 (極端な横長) でクランプして UI 暴走を防ぐ
  //
  // 重要: getSize はオリジナル URL を渡すと**フル画像をダウンロードして**寸法を測る。
  // フィードでは数 MB の画像を 4 枚並べると合計 10MB 超 → モバイル/3G で
  // 「画像が出るまで真っ暗 (= 親 View の C.bg しか見えない)」現象が起きる。
  // → thumbedUrl 経由の 240px サムネで getSize を呼ぶ (比率計算なので最小幅で十分)。
  //   旧版は 720px で measure していたが、表示用は ProgressiveImage が別途 fetch する
  //   ので measure 専用ならもっと小さくて良い。240 にして帯域 1/9 + decode コスト削減。
  // モジュールレベルキャッシュからシード — 同 URL を一度測れば後はゼロコスト
  const [imgAspects, setImgAspects] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const u of mediaUrls) {
      if (!u) continue;
      const r = _aspectCache.get(u);
      if (r !== undefined) seed[u] = r.ratio;
    }
    return seed;
  });
  useEffect(() => {
    if (mediaUrls.length === 0) return;
    let alive = true;
    for (const url of mediaUrls) {
      if (!url) continue;
      // キャッシュヒット時は getSize を呼ばない
      if (_aspectCache.has(url)) {
        const r = _aspectCache.get(url)!;
        setImgAspects((p) => (p[url] !== undefined ? p : { ...p, [url]: r.ratio }));
        continue;
      }
      const measureUri = thumbedUrl(url, 240);
      measureAspect(url, measureUri, (ratio) => {
        if (!alive) return;
        setImgAspects((p) => (p[url] !== undefined ? p : { ...p, [url]: ratio }));
      });
    }
    return () => {
      alive = false;
    };
    // mediaUrls は post から派生する配列 ref なので毎 render 新規 — join して安定化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrls.join('|')]);
  const likesCount = post.likes_count ?? 0;
  // 表示用 likes 数 — Vote Fuzzing (#3) で post_id seed の決定的 noise を加える。
  // 実 ranking / score / lowTrust 計算は real value (likesCount) のまま使う。
  const displayLikesCount = getDisplayLikes(post.id, likesCount);
  const commentsCount = post.comments_count ?? 0;
  const concernCount = post.concern_count ?? 0;
  const hasMedia = mediaUrls.length > 0 || videoUrls.length > 0;
  const lowTrust = likesCount > 0 && concernCount > likesCount;

  const openSource = useCallback(() => {
    if (!post.source_url) return;
    // sanitizeUrl は http/https 以外を null にする — javascript:/data:/vbscript: XSS 防止
    const safe = sanitizeUrl(post.source_url);
    if (!safe) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(safe, '_blank', 'noopener,noreferrer');
    } else {
      // 旧: silent fail。新: safeOpenUrl で失敗時 toast を表示
      void safeOpenUrl(safe);
    }
  }, [post.source_url]);

  // CW 開示 — `() => setCwRevealed(true)` を JSX inline で書くと毎 render 新 ref
  const revealCw = useCallback(() => setCwRevealed(true), []);
  // ピッカー開閉 — 同様に inline arrow を避ける
  const openMemePicker = useCallback(() => setMemePickerOpen(true), []);
  const closeMemePicker = useCallback(() => setMemePickerOpen(false), []);
  // 本文 long-press でピッカー (quick reaction flag が ON のときだけ渡す)
  const onLongPressBody = useQuickReaction ? openMemePicker : undefined;
  // primary community を tap したときのハンドラ — onCommunityPress / primaryCommunityId
  // が変わったときだけ新 ref。
  const onPrimaryCommunityPress = useCallback(() => {
    if (primaryCommunityId) onCommunityPress?.(primaryCommunityId);
  }, [onCommunityPress, primaryCommunityId]);
  // ModActionMenu 完了時の invalidate ハンドラ — qc は安定 ref。
  const onModActionComplete = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['feed-page'] });
    qc.invalidateQueries({ queryKey: ['feed'] });
    qc.invalidateQueries({ queryKey: ['community-feed'] });
  }, [qc]);
  // ObsidianSaveButton 用の note — postToObsidianNote は pure function なので
  // post 変化時のみ再計算で十分。
  const obsidianNote = useMemo(() => postToObsidianNote(post), [post]);
  // MemeReactionPicker の onPick — onReact prop の wrapper
  const onMemePick = useCallback((meme: string) => onReact(meme), [onReact]);
  // ModActionMenu の target は post 変化時のみ
  const modActionTarget = useMemo(
    () => ({ kind: 'post' as const, postId: post.id, authorId: post.author_id ?? '' }),
    [post.id, post.author_id],
  );

  // ── 動的 style: props/state に依存するもののみ useMemo 化 ──
  // ルート Container — iOS-native な「上品な elevated card」。
  //   - 背景: bg2 (elevated)
  //   - 角: 14px (iOS 標準の card radius. R.xl=20 はやや大袈裟だった)
  //   - hairline border (theme.border で divider トークンに揃える)
  //   - iOS-native shadow: opacity 0.04, radius 12, offset (0,2) — 重すぎない
  //     low-trust 時は border を amber に強調するだけで shadow は同じ
  //   - 横 padding は feed.tsx 側 (FlashList contentContainer) で吸収するため
  //     card 自体には marginHorizontal を持たせない。
  //   - card 間 gap は marginBottom で確保。
  //   - 横/縦 padding は 18 / 18 / 14 で iOS 標準の "上品な余白"
  const containerStyle = useMemo(
    () => ({
      backgroundColor: C.bg2,
      borderWidth: 1,
      borderColor: lowTrust ? C.amber + '44' : C.border,
      borderRadius: 14,
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 14,
      marginBottom: SP['3'],
      maxWidth: 720,
      alignSelf: 'center' as const,
      width: '100%' as const,
      // shadowColor / shadowOffset / shadowRadius は静的 (worklet で扱う必要なし)。
      // shadowOpacity / elevation だけを worklet 経由で動的に変える (下記参照)。
      // iOS 標準: subtle で散らない. radius 12 + offset y:2 が "上品な elevation"
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 } as const,
      shadowRadius: 12,
    }),
    // C 全体ではなく実際使う 3 値のみ依存 — テーマ切替時のみ再計算
    [C.bg2, C.amber, C.border, lowTrust],
  );

  // ============================================================
  // Press feedback — Reddit iOS 風 "lift up"
  // ------------------------------------------------------------
  // 押下中: 全カードを scale 0.96 + shadow expand (opacity 0.08→0.18 / elevation 2→5)。
  //   - 内側 PressableScale の scale 0.94 は本文 Text のみに作用するので、
  //     カード全体を「凹ませる」には container 側でも scale が必要。
  //   - 0.96 と 0.94 のネストで本文だけが少し深く凹む subtle な階層感が出る。
  // 離す: spring で滑らかに戻す (粘らない / 弾みすぎない)。
  // ReducedMotion: scale / shadow 変化を止め、静的固定。
  // shared value 駆動なので 100 件 mount でも cheap (React state ではない)。
  // ============================================================
  const reduceMotionForCard = useReducedMotion();
  const pressLift = useSharedValue(0);
  // 本文 PressIn/PressOut — pressLift を駆動する。 ReducedMotion 時は no-op。
  // useCallback で stable 化して PressableScale の reconciliation を抑える。
  const onBodyPressIn = useCallback(() => {
    if (reduceMotionForCard) return;
    pressLift.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) });
  }, [reduceMotionForCard, pressLift]);
  const onBodyPressOut = useCallback(() => {
    if (reduceMotionForCard) return;
    pressLift.value = withSpring(0, SPRING_SNAPPY);
  }, [reduceMotionForCard, pressLift]);
  const animatedShadowStyle = useAnimatedStyle(() => {
    if (reduceMotionForCard) {
      // ReducedMotion: 固定 shadow / scale 1 (worklet からは触らない)
      // iOS-native subtle shadow: opacity 0.04, elevation 1
      return { shadowOpacity: 0.04, elevation: 1, transform: [{ scale: 1 }] };
    }
    // 0 → 1 で scale 1 → 0.96 / shadowOpacity 0.04 → 0.10 / elevation 1 → 3
    // iOS では shadow を主役にせず、軽い lift だけ感じさせる
    const liftScale = 1 - pressLift.value * 0.04;
    return {
      shadowOpacity: 0.04 + pressLift.value * 0.06,
      elevation: 1 + pressLift.value * 2,
      transform: [{ scale: liftScale }],
    };
  });

  // 本文 Text/Markdown 用 — T.body と body color を結合
  // 旧コード: deps が `[]` で STYLES.bodyText (テーマ変化で別 ref) を捉えていなかった
  // → light/dark 切替で本文色だけ残るバグの恐れ。STYLES を deps に追加。
  const bodyTextStyle = useMemo(() => [T.body, STYLES.bodyText], [STYLES.bodyText]);

  // Like ラベル/カウント色 — テーマ切替も拾えるよう C.pink/C.text2 も deps へ
  const likeCountTextStyle = useMemo(
    () => ({ color: liked ? C.pink : C.text2 }),
    [liked, C.pink, C.text2],
  );

  // Concern ラベル/カウント色
  const concernCountTextStyle = useMemo(
    () => ({ color: concerned ? C.amber : C.text3 }),
    [concerned, C.amber, C.text3],
  );

  // Reaction カウント色 — 自分のリアクション有無で変わる
  const hasMyReaction = myReactionsForPost.length > 0;
  const reactionCountTextStyle = useMemo(
    () => ({ color: hasMyReaction ? C.accent : C.text3 }),
    [hasMyReaction, C.accent, C.text3],
  );
  // T.smallM とのマージ済み版を 1 度だけ作る — JSX で毎 render spread すると
  // 新 object になるので memoize。 ReactionButton の shallow compare で skip。
  const likeCountMergedStyle = useMemo(
    () => ({ ...T.smallM, ...likeCountTextStyle }),
    [likeCountTextStyle],
  );
  const concernCountMergedStyle = useMemo(
    () => ({ ...T.smallM, ...concernCountTextStyle }),
    [concernCountTextStyle],
  );
  // T.smallM とリアクション数 row の色を結合 — JSX で毎 render 新 array を作って
  // いたのを memoize。
  const reactionCountRowStyle = useMemo(
    () => [T.smallM, reactionCountTextStyle],
    [reactionCountTextStyle],
  );
  // 公式管理者の name 行 / anon の sub 行で再利用される style 配列も memoize。
  // [T.smallM, ...] のように毎 render 新 array にすると Text 再 render の
  // reconciliation で diff コストが出る。
  const officialNameStyle = useMemo(
    () => [T.smallM, STYLES.officialName],
    [STYLES.officialName],
  );
  const officialSubStyle = useMemo(
    () => [T.caption, STYLES.officialSub],
    [STYLES.officialSub],
  );
  const anonLabelStyle = useMemo(
    () => [T.smallM, STYLES.anonLabel],
    [STYLES.anonLabel],
  );
  const lowTrustTextStyle = useMemo(
    () => [T.caption, STYLES.lowTrustText],
    [STYLES.lowTrustText],
  );
  const cwLabelStyle = useMemo(() => [T.smallM, STYLES.cwLabel], [STYLES.cwLabel]);
  const cwWarningStyle = useMemo(
    () => [T.caption, STYLES.cwWarning],
    [STYLES.cwWarning],
  );
  const cwTapStyle = useMemo(() => [T.caption, STYLES.cwTap], [STYLES.cwTap]);
  const commentCountStyle = useMemo(
    () => [T.smallM, STYLES.commentCount],
    [STYLES.commentCount],
  );
  const sourceTextStyle = useMemo(
    () => [T.caption, STYLES.sourceText],
    [STYLES.sourceText],
  );
  const containerStyleCombined = useMemo(
    () => [containerStyle, animatedShadowStyle],
    [containerStyle, animatedShadowStyle],
  );

  // Twitter/Threads-style full-width row: no outer rounded card, just a
  // hairline divider between posts. Looks more "premium feed" than a
  // floating-card grid on tall screens.
  return (
    <Animated.View style={containerStyleCombined}>
      {/* 低信頼バナー */}
      {lowTrust && (
        <View style={STYLES.lowTrustBanner}>
          <Warn size={14} color={C.amber} strokeWidth={2.2} />
          <Text style={lowTrustTextStyle}>
            この投稿に「気になる」が多く付いています ({concernCount})
          </Text>
        </View>
      )}

      {/* ヘッダー: アバター / 匿 · 時刻 / ⋯
          公式コミュ管理者の投稿は de-anonymize して 実名 · 所属 を表示 */}
      <View style={STYLES.headerRow}>
        {post.official_author ? (
          // 公式管理者: ✓ shield アクセント色のアバター
          <View
            style={STYLES.officialAvatar}
            accessibilityLabel="公式管理者"
          >
            <Icon.shield size={20} color={C.accent} strokeWidth={2.4} />
          </View>
        ) : (
          <Avatar size={40} anonymous />
        )}
        {post.official_author ? (
          <View style={STYLES.officialMeta}>
            <View style={STYLES.officialNameRow}>
              <Text style={officialNameStyle} numberOfLines={1}>
                {post.official_author.name || t('公式管理者')}
              </Text>
            </View>
            <View style={STYLES.anonMetaRow}>
              <Text style={officialSubStyle} numberOfLines={1}>
                {post.official_author.organization
                  ? `${post.official_author.organization} · ${formatRelative(post.created_at)}`
                  : formatRelative(post.created_at)}
              </Text>
              {primaryCommunity && (
                <>
                  <Text style={STYLES.anonMetaDot}>·</Text>
                  <CommunityInlineIndicator
                    community={primaryCommunity}
                    extraCount={communities.length - 1}
                    onPress={onPrimaryCommunityPress}
                    STYLES={STYLES}
                  />
                </>
              )}
            </View>
          </View>
        ) : (
          // anon: 「匿」を 1 行目、relative time + community を 2 行目に分けて typography 階層を作る
          <View style={STYLES.anonRow}>
            <Text style={anonLabelStyle} numberOfLines={1}>
              {t('匿')}
            </Text>
            <View style={STYLES.anonMetaRow}>
              <Text style={STYLES.anonRelative} numberOfLines={1}>
                {formatRelative(post.created_at)}
              </Text>
              {primaryCommunity && (
                <>
                  <Text style={STYLES.anonMetaDot}>·</Text>
                  <CommunityInlineIndicator
                    community={primaryCommunity}
                    extraCount={communities.length - 1}
                    onPress={onPrimaryCommunityPress}
                    STYLES={STYLES}
                  />
                </>
              )}
            </View>
          </View>
        )}
        <PressableScale onPress={onMore} hitSlop={HIT_SLOP_10} style={STYLES.morePress}>
          <More size={20} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
        {/* mod 専用 3-dot menu — mod でない / 自分の投稿のときは null render */}
        {primaryCommunityId && post.author_id && (
          <ModActionMenu
            target={modActionTarget}
            communityId={primaryCommunityId}
            isMod={isMod}
            isOwn={isOwnPost}
            onActionComplete={onModActionComplete}
          />
        )}
      </View>

      {/* CW (content warning) ベール
          ※ コミュニティ表示は header 内 (anonMetaRow / officialMeta) に inline 化済み — 旧 chip row は削除 */}
      {isCwHidden && (
        <PressableScale
          onPress={revealCw}
          haptic="tap"
          style={STYLES.cwBox}
        >
          <Text style={STYLES.cwEmoji}>
            {cwCategory === 'spoiler' ? '🤐' : cwCategory === 'nsfw' ? '🔞' : cwCategory === 'violence' ? '⚠️' : '🛡️'}
          </Text>
          <Text style={cwLabelStyle}>
            {cwCategory === 'spoiler' ? t('ネタバレ') : cwCategory === 'nsfw' ? t('センシティブな内容') : cwCategory === 'violence' ? t('暴力的描写') : t('注意')}
          </Text>
          {post.content_warning && (
            <Text style={cwWarningStyle}>
              {post.content_warning}
            </Text>
          )}
          <Text style={cwTapStyle}>{t('タップして表示')}</Text>
        </PressableScale>
      )}

      {/* メディア — 自然なアスペクト比で表示 (square crop しない)
          tall portrait (5:6 等) や wide landscape も切れず全体が見える
          複数枚は縦に積む (各画像が自身のアスペクト比を保持)
          外側カードの paddingHorizontal に揃え、premium feel の rounded corners

          NSFW / spoiler / violence は MediaWithCWGuard が per-item で
          blurhash + 「タップして表示」CTA で gate する。 sensitive は
          MediaWithCWGuard 側で素通し (ラベルのみ) なのでここでは特別扱い無し。
          body 側の cwBox とは独立: body は cwBox で、 media は per-item で
          reveal される。 */}
      {hasMedia && (
        <DoubleTapHeart onDoubleTap={onLike}>
          <View style={STYLES.mediaWrap}>
            {mediaUrls.map((url, i) => {
              // ロード中は 4:3 (1.333) で仮置き → 解決後に真のアスペクト比へ差し替え
              // (1:1 だとレイアウトが大きく跳ねるので 4:3 が無難)
              const aspect = imgAspects[url] ?? 1.333;
              const blurhash = mediaBlurhashes[i];
              return (
                <View
                  key={url}
                  style={[STYLES.mediaItemBase, mediaItemAspect(aspect)]}
                >
                  <MediaWithCWGuard cwCategory={cwCategory} blurhash={blurhash}>
                    {/* Pressable で wrap — single-tap で全画面ライトボックスを開く。
                        DoubleTapHeart は numberOfTaps(2) なので single-tap は
                        ここを通過する。長押し / scroll は React Native の
                        Pressable が自前で gesture system と協調するので無問題。 */}
                    <Pressable
                      onPress={() => openLightbox(url)}
                      style={{ flex: 1 }}
                      accessibilityRole="imagebutton"
                      accessibilityLabel="画像を拡大表示"
                    >
                      <ProgressiveImage
                        uri={url}
                        blurhash={blurhash}
                        width="100%"
                        height="100%"
                        radius={R.md}
                        lazy
                        // フィード 1 列幅 (max 720) の 1x DPR で 480 が綺麗 + 軽い。
                        // 旧 720 default は retina 換算でも過剰だった (1 枚 ~120KB 多い)。
                        thumbWidth={480}
                        // フィード本体画像は「上にスクロールしてある」前提で
                        // 並行 fetch queue 内で優先される。avatars/community icons 等
                        // (priority='normal') よりネット slot を先取り。
                        priority="high"
                      />
                    </Pressable>
                  </MediaWithCWGuard>
                </View>
              );
            })}
            {/* 動画 (1 件まで前提だが、配列をループして将来複数対応) */}
            {videoUrls.map((vurl, i) => (
              <View
                key={`v-${vurl}`}
                style={[STYLES.mediaItemBase, mediaItemAspect(16 / 9)]}
              >
                <MediaWithCWGuard cwCategory={cwCategory}>
                  <VideoPlayer uri={vurl} poster={videoPosters[i]} />
                </MediaWithCWGuard>
              </View>
            ))}
          </View>
        </DoubleTapHeart>
      )}

      {/* ★ BBS 統合 (migration 0075) — title あれば content の上に大きく表示。
          スレ形式 post (旧 BBS thread) は title が main contentで、 content は ''。
          tap で post detail へ遷移 (本文 PressableScale と同じ behavior)。 */}
      {post.title && !isCwHidden ? (
        <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], paddingBottom: post.content ? SP['1'] : SP['3'] }}>
          <PressableScale onPress={onComment} haptic="tap" scaleValue={0.97}>
            <Text
              style={[T.h4, { color: C.text, fontWeight: '700' }]}
              numberOfLines={3}
            >
              {post.title}
            </Text>
          </PressableScale>
        </View>
      ) : null}

      {/* 本文 — 外側カードの paddingHorizontal を流用 (double-padding 回避)
          ★ Reddit iOS 風 press feedback:
            - scaleValue=0.94 (default 0.96 より dramatic に「凹む」)
            - onPressIn で pressLift 0 → 1 (Animated.View の shadow が拡張)
            - onPressOut で spring で戻す
          tap → 即詳細遷移なので、scale + shadow expand の 1 瞬で「カードが lift up」体感。 */}
      {post.content && !isCwHidden ? (
        <View>
          <PressableScale
            onPress={onComment}
            onLongPress={useQuickReaction ? () => setMemePickerOpen(true) : undefined}
            haptic="tap"
            scaleValue={0.94}
            onPressIn={() => {
              if (reduceMotionForCard) return;
              pressLift.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) });
            }}
            onPressOut={() => {
              if (reduceMotionForCard) return;
              pressLift.value = withSpring(0, SPRING_SNAPPY);
            }}
          >
            <View style={STYLES.bodyInner}>
              {useMarkdown ? (
                <MarkdownText
                  text={displayContent}
                  style={bodyTextStyle}
                  numberOfLines={hasMedia ? 3 : 8}
                />
              ) : (
                <Text style={bodyTextStyle} numberOfLines={hasMedia ? 3 : 8}>
                  {displayContent}
                </Text>
              )}
            </View>
          </PressableScale>
        </View>
      ) : null}

      {/* 出典 — OG preview flag が ON なら LinkPreviewCard、OFF なら従来 */}
      {post.source_url && (
        useOgPreview ? (
          <LinkPreviewCard url={post.source_url} />
        ) : (
          <PressableScale onPress={openSource} haptic="tap" style={STYLES.sourceBtn}>
            <Text style={STYLES.sourceEmoji}>🔗</Text>
            <Text style={[T.caption, STYLES.sourceText]} numberOfLines={1}>
              出典: {shortHost(post.source_url)}
            </Text>
          </PressableScale>
        )
      )}

      {/* 投票 */}
      {poll && !isCwHidden && <PollCard poll={poll} />}

      {/* タグ群（2つ目以降 + 他人が追加したタグ + 追加ボタン） */}
      <View style={STYLES.tagsRow}>
        {tagNames.slice(1).map((tag) => (
          <TagPill key={tag} name={tag} state="normal" onPress={() => onTagPress(tag)} />
        ))}
        {addedTags.filter((t) => !tagNames.includes(t)).map((tag) => (
          <TagPill key={`added-${tag}`} name={tag} state="added" onPress={() => onTagPress(tag)} />
        ))}
        {onAddTag && (
          <AddTagInline onSubmit={async (tag) => { await onAddTag(tag); }} />
        )}
      </View>

      {/* アクション行 — icon を 20px に統一. hitSlop:10 で 44pt 以上の tap target を確保
          (icon 自体は 20 だが押下範囲を上下左右 +10 で誤タップ防止)。
          gap は SP['5'] で各アクションを規則的に配置 — 「♥ 15 / 💬 9 / ⚠ / 🪶 15」 が
          視覚的にリズミカルに並ぶ。 */}
      <View style={STYLES.actionsRow}>
        <ReactionButton
          IconCmp={Heart}
          active={liked}
          count={displayLikesCount}
          onPress={onLike}
          inactiveColor={C.text2}
          activeColor={C.pink}
          accessibilityLabel={liked ? 'いいね済み' : 'いいね'}
          countTextStyle={{ ...T.smallM, ...likeCountTextStyle }}
        />
        <PressableScale
          onPress={onComment}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="コメントを開く"
          style={STYLES.actionPress}
        >
          <Comment size={20} color={C.text2} strokeWidth={2.2} />
          {commentsCount > 0 && (
            <Text style={[T.smallM, STYLES.commentCount]}>{commentsCount}</Text>
          )}
        </PressableScale>
        <ReactionButton
          IconCmp={Warn}
          active={concerned}
          count={concernCount}
          onPress={onConcern}
          inactiveColor={C.text3}
          activeColor={C.amber}
          activeFill={C.amber + '44'}
          accessibilityLabel={concerned ? '気になる済み' : '気になる'}
          countTextStyle={{ ...T.smallM, ...concernCountTextStyle }}
        />
        <PressableScale
          onPress={() => setMemePickerOpen(true)}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="リアクションを選ぶ"
          style={STYLES.actionPress}
        >
          <Text style={STYLES.reactionEmoji}>🪶</Text>
          {reactionsList.length > 0 && (
            <Text style={[T.smallM, reactionCountTextStyle]}>
              {reactionsList.reduce((a, r) => a + r.count, 0)}
            </Text>
          )}
        </PressableScale>
        <View style={STYLES.spacer} />
        <ObsidianSaveButton note={postToObsidianNote(post)} />
        <PressableScale
          onPress={onShare}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="共有"
          style={STYLES.iconBtn}
        >
          <Share size={18} color={C.text2} strokeWidth={2.2} />
        </PressableScale>
        <ReactionButton
          IconCmp={Save}
          active={saved}
          onPress={onSave}
          inactiveColor={C.text2}
          activeColor={C.amber}
          iconSize={18}
          accessibilityLabel={saved ? '保存済み' : '保存'}
        />
      </View>

      {/* リアクション表示行 */}
      {reactionsList.length > 0 && (
        <View style={STYLES.reactionsRow}>
          {reactionsList.slice(0, 8).map((r) => (
            <PressableScale
              key={r.meme}
              onPress={() => onReact(r.meme)}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel={`${r.meme} ${r.count} 件 ${r.mine ? '(押下済み)' : ''}`}
              style={[STYLES.reactionPillBase, reactionPillColors(C, r.mine)]}
            >
              <Text style={reactionPillLabel(C, r.mine)}>
                {r.meme}
              </Text>
              <Text style={reactionPillCount(C, r.mine)}>
                {r.count}
              </Text>
            </PressableScale>
          ))}
          {reactionsList.length > 8 && (
            <PressableScale
              onPress={() => setMemePickerOpen(true)}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel="他のリアクションを見る"
              style={STYLES.reactionOverflowPill}
            >
              <Text style={STYLES.reactionOverflowText}>
                +{reactionsList.length - 8}
              </Text>
            </PressableScale>
          )}
        </View>
      )}

      {/* ミームピッカーモーダル */}
      <MemeReactionPicker
        visible={memePickerOpen}
        onClose={() => setMemePickerOpen(false)}
        onPick={(meme) => onReact(meme)}
        picked={myReactionsForPost}
      />

      {/* 画像ライトボックス — tap 時に開く全画面ビューア。
          Modal は visible=false の間 lazy-render なので feed の全 card に
          1 つ持たせてもコストは無い。 */}
      <ImageLightbox
        visible={!!lightboxUri}
        uri={lightboxUri}
        onClose={closeLightbox}
      />
    </Animated.View>
  );
}

export const AnonPostCard = memo(AnonPostCardInner, (prev, next) => {
  // Re-render only when something this card actually cares about changed.
  if (prev.post !== next.post) return false;
  if (prev.liked !== next.liked) return false;
  if (prev.concerned !== next.concerned) return false;
  if (prev.saved !== next.saved) return false;
  if (prev.reactions !== next.reactions) return false;
  if (prev.addedTags !== next.addedTags) return false;
  if (prev.poll !== next.poll) return false;
  if (prev.reason !== next.reason) return false;
  if (prev.communities !== next.communities) return false;
  // Handler refs are kept stable by the parent (handlersByPostId memoization).
  if (prev.onLike !== next.onLike) return false;
  if (prev.onConcern !== next.onConcern) return false;
  if (prev.onComment !== next.onComment) return false;
  if (prev.onSave !== next.onSave) return false;
  if (prev.onShare !== next.onShare) return false;
  if (prev.onTagPress !== next.onTagPress) return false;
  if (prev.onMore !== next.onMore) return false;
  if (prev.onReact !== next.onReact) return false;
  if (prev.onAddTag !== next.onAddTag) return false;
  if (prev.onCommunityPress !== next.onCommunityPress) return false;
  return true; // skip re-render
});
