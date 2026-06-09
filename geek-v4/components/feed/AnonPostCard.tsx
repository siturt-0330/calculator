import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { View, Text, Platform, useWindowDimensions, Image as RNImage, StyleSheet, Pressable, type TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { safeOpenUrl } from '../../lib/openUrl';
import { Icon } from '../../constants/icons';
import type { Post } from '../../types/models';
import { useLanguageStore } from '../../stores/languageStore';
import { useAuthStore } from '../../stores/authStore';
import { translateDynamic, useT } from '../../lib/i18n';
import { MemeReactionPicker } from './MemeReactionPicker';
import { ReactionListSheet } from './ReactionListSheet';
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
import { FeedMediaGrid } from './FeedMediaGrid';
import { mediaItemAspect } from './feedMediaLayout';
import { VideoPlayer } from '../ui/VideoPlayer';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { extractFirstUrl, stripPreviewUrl } from '../../lib/utils/extractUrl';
import { DoubleTapHeart } from '../ui/DoubleTapHeart';
// NOTE: tag chip と「+ タグ追加」 UI は撤去 (周りの人が他人投稿に tag を付与
// できないようにする方針 + ハッシュタグは feed カード上に表示しない方針)。
// DB 側の tag_names / added_tags は検索 index 用に残るが、ここでは render しない。
// TagPill / AddTagInline import は使わなくなったので削除。
import { MarkdownText } from '../ui/MarkdownText';
import { LinkPreviewCard } from './LinkPreviewCard';
import { PollCard } from './PollCard';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useIsCommunityMod } from '../../hooks/useIsCommunityMod';
import type { Poll } from '../../lib/api/polls';
import { Avatar } from '../ui/Avatar';
import { CommunityIcon } from '../ui/CommunityIcon';
import { formatRelative } from '../../lib/utils/date';
import { pseudonymFor } from '../../lib/utils/pseudonym';
import { sanitizeUrl } from '../../lib/sanitize';
import { ObsidianSaveButton } from '../ui/ObsidianSaveButton';
import { postToObsidianNote } from '../../hooks/useObsidian';
import type { PostCommunityRef } from '../../lib/api/posts';
import type { FeedPagePost } from '../../lib/api/feedPage';
import { stableKeyFor } from '../../lib/utils/queryKey';
import { OfficialBadge } from '../community/OfficialBadge';
import { ModActionMenu } from '../community/ModActionMenu';
import { MediaWithCWGuard } from '../post/MediaWithCWGuard';
import { getDisplayLikesForViewer } from '../../lib/utils/voteFuzz';
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

// 投稿詳細 (app/post/[id].tsx) からも同じアスペクト比キャッシュを使えるよう公開する。
// フィードカードで一度測った比率を詳細画面の初期 state にシードして、
// 4:3 (1.333) プレースホルダ → 実比率 のレイアウトシフトを消す (TTL 切れ/未測定は undefined)。
export function getCachedAspect(url: string): number | undefined {
  const cached = _aspectCache.get(url);
  if (cached && Date.now() - cached.ts < _ASPECT_TTL_MS) return cached.ratio;
  return undefined;
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
// makeStyles は factory 経由で STYLES.xxx として参照されるため、静的解析では
// no-unused-styles が全キーを未使用と誤報する。実際にはすべて JSX 内で使用済み。
/* eslint-disable react-native/no-unused-styles */
const makeStyles = (C: ColorPalette) => StyleSheet.create({
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
  anonLabel: { color: C.text, fontWeight: '800', letterSpacing: -0.08 },
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
    backgroundColor: 'transparent',
    borderRadius: R.full,
    borderWidth: 1,
    borderColor: C.border,
  },
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
    paddingHorizontal: 0,
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
  mediaWrap: { gap: 2, marginTop: SP['3'] },
  mediaItemBase: {
    // width は mediaItemAspect 側で決める (縦長は中央寄せの細box、横長は全幅)
    backgroundColor: C.bg2,
    borderRadius: 16,
    overflow: 'hidden',
    // web の recycled FlashList セルで aspectRatio 解決前に高さ 0 へ潰れるのを防ぐ floor
    minHeight: 200,
  },

  // 本文 — Apple News 寄り: fontSize 15 / lineHeight 22 (1.47, iOS 標準 1.4-1.5 域)
  // letterSpacing -0.08 は SF Pro Text の自然な tracking
  bodyInner: { paddingTop: SP['3'], paddingBottom: SP['1'] },
  bodyText: { color: C.text, fontSize: 15, lineHeight: 23, letterSpacing: -0.08 },
  // BBS タイトル見出し (T.h3 と結合して使用) — 本文との階層を立てる
  bbsTitle: { color: C.text, fontWeight: '700', letterSpacing: -0.3 },
  // 出典 — iOS-native: 角 12px, hairline divider, 軽い bg3
  sourceBtn: {
    marginTop: SP['2'],
    paddingHorizontal: SP['3'],
    paddingVertical: 10,
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.divider,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['2'],
  },
  sourceEmoji: { fontSize: 14 },
  sourceText: { color: C.text2, flex: 1 },

  // (tagsRow style は削除 — tag chip は feed カードに表示しない方針)

  // アクション行 — 上 padding を 10px に詰めて action 強調を低く、 scan しやすく
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
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
    gap: 6,
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
    backgroundColor: 'transparent',
    borderRadius: R.full,
    borderWidth: 1,
    borderColor: C.border,
  },
  reactionOverflowText: { fontSize: 12, color: C.text3, fontWeight: '700' },
});
/* eslint-enable react-native/no-unused-styles */

// ────────────────────────────────────────────────────────────────────
// Per-item / 動的 style ファクトリ — map 内で呼ばれるので useMemo は使わず、
// あらかじめ static base に差分だけ重ねた小オブジェクトを返す。
// この差分オブジェクト自体は毎 render 新規になるが、
//   - スタイル合成は配列 [base, diff] で行うので diff のキーだけが reconcile される
//   - base 側 (StyleSheet ID) は安定なので reconciliation コストは差分分のみ
// ────────────────────────────────────────────────────────────────────

// 単一画像の表示 box スタイルは components/feed/feedMediaLayout.ts に集約 (詳細/マイページと共有)。

function reactionPillColors(C: ColorPalette, mine: boolean): { backgroundColor: string; borderColor: string } {
  return {
    backgroundColor: mine ? C.accentBg : 'transparent',
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
// 18px の小型アイコン + コミュ名 + (任意で「+N」)。
//   - アイコンは共有 <CommunityIcon> に集約 (commit f8267aa)。画像優先 +
//     contentFit="contain" で「必ず表示 / 拡大しない」を保証 (onError で
//     emoji → 頭文字 → community グリフへ自動 fallback)。
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
      {/* 18px = 旧 communityInlineRingBase の径。画像優先 + contain で
          「必ず表示 / 拡大しない」を共有 <CommunityIcon> に集約 (commit f8267aa)。 */}
      <CommunityIcon size={18} iconUrl={c.icon_url} iconEmoji={c.icon_emoji} name={c.name} />
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



type AnonPostCardProps = {
  post: Post;
  liked?: boolean;
  concerned?: boolean;
  saved?: boolean;
  // de-anon Phase2: 「自分の投稿か」を server 供給の boolean で受け取る (author_id 非依存)。
  isOwn?: boolean;
  reactions?: ReactionAgg[];
  addedTags?: string[];
  poll?: Poll;
  reason?: { text: string; kind: string };
  communities?: PostCommunityRef[];
  // Reddit スタイル表示の切り替え。
  //   'home'      (既定): コミュニティ icon + 名前を主役に表示 (ホーム / コミュニティタブ / 検索 / タグページ等)
  //   'community' : 投稿者本人のアバター + 擬似ハンドル(id)を主役に表示 (コミュニティ詳細ページのみ・de-anon Phase2)
  viewContext?: 'home' | 'community';
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
  isOwn,
  reactions = [],
  addedTags: _addedTags = [],
  poll,
  reason: _reason,
  communities = [],
  onLike,
  onComment,
  onSave,
  onShare,
  onTagPress: _onTagPress,
  onMore,
  onReact,
  onAddTag: _onAddTag,
  onCommunityPress,
  viewContext = 'home',
}: AnonPostCardProps) {
  const Heart = Icon.heart;
  const Comment = Icon.comment;
  const Save = Icon.save;
  const Share = Icon.share;
  const More = Icon.more;
  const t = useT();
  const qc = useQueryClient();
  // ★ テーマ購読 — light/dark で全 style が再評価される。
  //   makeStyles は新 StyleSheet を生成するが useMemo で同テーマ render では
  //   同一参照を返すので、Card 再 render は色変化のときだけ。
  const C = useColors();
  const STYLES = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();

  // ★ de-anon Phase2: コミュニティ詳細 (viewContext='community') では投稿者本人の
  //   アバター + 擬似ハンドルを表示する。identity は server 供給の pseudonym_id から
  //   決定的に導出 (author_id 非依存・comment / 投稿詳細と同方針)。tap で擬似プロフィールへ。
  const pseudonymId = post.pseudonym_id ?? null;
  const pseudo = useMemo(() => pseudonymFor(pseudonymId), [pseudonymId]);
  const goToPseudoProfile = useCallback(() => {
    if (pseudonymId) router.push(`/user/${pseudonymId}` as never);
  }, [router, pseudonymId]);

  // ★ ModActionMenu 配線 (mod だけに見える 3-dot)
  // post.community_id は型に無いが post_communities junction で 1 件以上紐付く。
  // 先頭の community を「主担当 community」と見做し、その mod 権限で判定。
  // (共通的に 1 post = 1 primary community なので衝突は実質起きない)
  const primaryCommunity = communities[0];
  const primaryCommunityId = primaryCommunity?.community_id;
  const isMod = useIsCommunityMod(primaryCommunityId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  // de-anon Phase2: server 供給の is_own を優先 (author_id 非依存)。is_own 未配線の経路
  //   (周辺データ未ロード中など) では従来の author_id 比較に fallback (2b で author_id 除去後は false)。
  const isOwnPost = isOwn ?? (!!post.author_id && post.author_id === currentUserId);

  // ミームリアクション (props 経由で DB から取得済み)
  const [memePickerOpen, setMemePickerOpen] = useState(false);
  // 「…」タップで「押された全スタンプ」一覧シートを開く
  const [reactionsDetailOpen, setReactionsDetailOpen] = useState(false);
  const reactionsList = reactions;
  // myReactionsForPost は MemeReactionPicker の `picked` に渡る — 毎 render 新 array
  // を作ると Picker 側 effect が無駄発火する。 reactions ref が変わらない限り stable。
  const myReactionsForPost = useMemo(
    () => reactions.filter((r) => r.mine).map((r) => r.meme),
    [reactions],
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

  // 縦長写真がフィードを占有しないための絶対最大高さ (mediaItemAspect に渡す)。
  // 「デカすぎる」フィードバックを受けてさらに縮小 (Threads 体感に寄せる):
  // web 340px / モバイルは画面高の 42%。contain 表示なので box 内に写真全体が収まる。
  const { height: winH } = useWindowDimensions();
  const portraitMaxH = Platform.OS === 'web' ? 340 : Math.round(winH * 0.42);

  // OG カード対象 URL: 明示的な source_url を優先し、無ければ本文中の最初の URL を拾う。
  const previewUrl = useMemo(
    () => post.source_url || extractFirstUrl(post.content),
    [post.source_url, post.content],
  );

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
  // リンクカードを出すときは本文から対象 URL/「[リンク]」を隠す (URLはカードに置き換え)
  const displayContent = stripPreviewUrl(
    (autoTranslate && translated) ? translated : post.content,
    (previewUrl && useOgPreview) ? previewUrl : null,
  );
  // データ欠落でクラッシュしないよう全フィールドを安全化。
  // post ref は memo の arePropsEqual で stable なので、これらは
  // post 変化時のみ新規 array になる (= ほぼ常に同 ref)。
  const mediaUrls = useMemo(() => post.media_urls ?? [], [post.media_urls]);
  const mediaBlurhashes = useMemo(() => post.media_blurhashes ?? [], [post.media_blurhashes]);
  // 動画 (migration 0043 後の投稿のみ存在)。古い投稿は undefined → 空配列で安全
  const videoUrls = useMemo(() => post.video_urls ?? [], [post.video_urls]);
  const videoPosters = useMemo(() => post.video_posters ?? [], [post.video_posters]);
  // tag_names / addedTags は検索 index 用に props で受け取り続けるが、
  //   - feed カード UI には render しない (ハッシュタグ非表示方針)
  //   - 「+ タグ追加」 UI も廃止 (周りの人が他人投稿に tag を付与できない)
  // 旧コードの tagNames / restTagNames / filteredAddedTags useMemo は撤去。

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
  // ★ 自分の like 由来の ±1 は fuzz に飲み込ませず必ず反映させる (getDisplayLikesForViewer)。
  //   fuzz を「自分を除いた票数」に対して計算 → tier 境界 (10↔11 等) でも自分の操作が
  //   表示上で確実に ±1 になる。「いいね押しても数字が変わらない」UX バグの根本修正。
  const displayLikesCount = getDisplayLikesForViewer(post.id, likesCount, liked);
  const commentsCount = post.comments_count ?? 0;
  const hasMedia = mediaUrls.length > 0 || videoUrls.length > 0;

  const openSource = useCallback(() => {
    if (!previewUrl) return;
    // sanitizeUrl は http/https 以外を null にする — javascript:/data:/vbscript: XSS 防止
    const safe = sanitizeUrl(previewUrl);
    if (!safe) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(safe, '_blank', 'noopener,noreferrer');
    } else {
      // 旧: silent fail。新: safeOpenUrl で失敗時 toast を表示
      void safeOpenUrl(safe);
    }
  }, [previewUrl]);

  // CW 開示 — `() => setCwRevealed(true)` を JSX inline で書くと毎 render 新 ref
  const revealCw = useCallback(() => setCwRevealed(true), []);
  // ピッカー開閉 — 同様に inline arrow を避ける
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
  // MemeReactionPicker の onPick は JSX で直接インライン化
  // ModActionMenu の target は post 変化時のみ
  const modActionTarget = useMemo(
    () => ({ kind: 'post' as const, postId: post.id }),
    [post.id],
  );

  // ============================================================
  // 投稿詳細を「即開く」prefetch + seed (latency 改善 / spinner 撲滅)
  // ------------------------------------------------------------
  // カードタップで /post/:id へ遷移する瞬間、詳細画面が再 fetch する
  // ['post', id] と ['feed-page', userId, [id]] の 2 cache を、カードが
  // 既に持っているデータ (post / reactions / communities / liked 等) から
  // 先回りでシードする。これにより PostDetail は mount 時に cache hit で
  // 即描画でき、postLoading spinner と 2 RTT (fetchPostById + get_feed_page)
  // が critical path から消える。
  //   - setQueryData は `(prev) => prev ?? seed` で既存 (より新しい) cache を
  //     上書きしない。詳細側は staleTime 経過後に background revalidate するので
  //     初期描画は即時、データ鮮度も保たれる。
  //   - ['feed-page'] の key は useFeedPage と完全一致させる
  //     ([prefix, userId ?? 'anon', stableKeyFor([id])])。
  const handleOpenDetail = useCallback(() => {
    try {
      // 1) 投稿本文 — fetchPostById は Post を返すので post prop をそのままシード
      qc.setQueryData<Post | null>(['post', post.id], (prev) => prev ?? post);
      // 2) 周辺データ (reactions / my_* / communities / poll) — 単一 id 用 feed-page cache
      const feedPageSeed: FeedPagePost = {
        ...post,
        communities,
        official_author: post.official_author ?? null,
        my_like: liked,
        my_concern: concerned,
        my_save: saved,
        reactions: reactionsList,
        added_tags: _addedTags,
        poll: poll ?? null,
        is_own: isOwnPost,
        // deanon: 表示は community-first に戻したが、詳細画面 (Stage2b) 用に
        //   avatar/pseudonym は seed に通しておく (FeedPagePost が要求)。
        avatar_url: post.avatar_url ?? null,
        avatar_emoji: post.avatar_emoji ?? null,
        pseudonym_id: post.pseudonym_id ?? null,
      };
      const feedPageKey = ['feed-page', currentUserId ?? 'anon', stableKeyFor([post.id])];
      qc.setQueryData<FeedPagePost[]>(feedPageKey, (prev) => prev ?? [feedPageSeed]);
    } catch {
      // seed は best-effort。失敗しても通常遷移にフォールバックする (UX 影響なし)
    }
    onComment();
  }, [
    qc,
    post,
    communities,
    liked,
    concerned,
    saved,
    reactionsList,
    _addedTags,
    poll,
    currentUserId,
    onComment,
    isOwnPost,
  ]);

  // ── 動的 style: props/state に依存するもののみ useMemo 化 ──
  // ルート Container — X(旧Twitter)/Threads 風の「フラットな全幅行」。
  //   - 背景: transparent (カード面 bg2 を撤廃。地 (C.bg) に溶ける。light でも正)
  //   - 角丸 / 全周 border / shadow / 投稿間 gap(marginBottom) を全て撤廃
  //   - 区切りは下罫線 hairline (C.divider) のみ。隙間を空けず罫線で分ける。
  //   - 横/縦 padding は 16 / 12 / 12 で全行の左端を 16px に一元化。
  //   - low-trust は外枠で強調せず、行内の lowTrustBanner が担う。
  //   - maxWidth:720 + alignSelf:center は PC 幅で中央 720 列に寄せる (X と同様)。
  const containerStyle = useMemo(
    () => ({
      backgroundColor: 'transparent' as const,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: C.divider,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
      maxWidth: 720,
      alignSelf: 'center' as const,
      width: '100%' as const,
    }),
    [C.divider],
  );

  // ============================================================
  // Press feedback — フラット行の「背景ハイライト」
  // ------------------------------------------------------------
  // カードを撤廃したので scale/shadow の "lift" はやめ、行タップ中に背景を
  // transparent → C.bg2 へ薄く差し込む X/Threads 風ハイライトに置換する。
  //   - pressLift 0→1 を本文/タイトルの onPressIn/onPressOut が駆動 (流用)。
  //   - interpolateColor で transparent↔bg2 を補間 → 行全体がふっと沈む。
  // 離す: spring で滑らかに戻す。ReducedMotion: 常に transparent (変化なし)。
  // shared value 駆動なので 100 件 mount でも cheap (React state ではない)。
  // ============================================================
  const reduceMotionForCard = useReducedMotion();
  const pressLift = useSharedValue(0);
  const animatedShadowStyle = useAnimatedStyle(() => {
    if (reduceMotionForCard) {
      return { backgroundColor: 'transparent' };
    }
    return {
      backgroundColor: interpolateColor(
        pressLift.value,
        [0, 1],
        ['transparent', C.bg2],
      ),
    };
  });

  // 本文 Text/Markdown 用 — T.body と body color を結合
  // 旧コード: deps が `[]` で STYLES.bodyText (テーマ変化で別 ref) を捉えていなかった
  // → light/dark 切替で本文色だけ残るバグの恐れ。STYLES を deps に追加。
  const bodyTextStyle = useMemo(() => [T.body, STYLES.bodyText], [STYLES.bodyText]);
  // BBS タイトル — T.h3(18/26) に格上げして本文(15)との見出し階層を立てる。
  const bbsTitleStyle = useMemo(() => [T.h3, STYLES.bbsTitle], [STYLES.bbsTitle]);

  // Like ラベル/カウント色 — テーマ切替も拾えるよう C.pink/C.text2 も deps へ
  const likeCountTextStyle = useMemo(
    () => ({ color: liked ? C.pink : C.text2 }),
    [liked, C.pink, C.text2],
  );

  // Reaction カウント色 — 自分のリアクション有無で変わる
  const hasMyReaction = myReactionsForPost.length > 0;
  const reactionCountTextStyle = useMemo(
    () => ({ color: hasMyReaction ? C.accent : C.text3 }),
    [hasMyReaction, C.accent, C.text3],
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
  const cwLabelStyle = useMemo(() => [T.smallM, STYLES.cwLabel], [STYLES.cwLabel]);
  const cwWarningStyle = useMemo(
    () => [T.caption, STYLES.cwWarning],
    [STYLES.cwWarning],
  );
  const cwTapStyle = useMemo(() => [T.caption, STYLES.cwTap], [STYLES.cwTap]);
  const containerStyleCombined = useMemo(
    () => [containerStyle, animatedShadowStyle],
    [containerStyle, animatedShadowStyle],
  );

  // Twitter/Threads-style full-width row: no outer rounded card, just a
  // hairline divider between posts. Looks more "premium feed" than a
  // floating-card grid on tall screens.
  return (
    <Animated.View style={containerStyleCombined}>
      {/* ヘッダー: アバター / メイン表示 / ⋯
          - 公式管理者: shield + 実名 · 所属 (de-anonymize)
          - viewContext='community': 投稿者本人の avatar + 擬似ハンドル(id) (コミュニティ詳細ページ・de-anon Phase2)
          - viewContext='home' (既定): コミュニティ icon + 名前 (Reddit の r/ サブレ表示スタイル) */}
      <View style={STYLES.headerRow}>
        {/* ===== アバター ===== */}
        {post.official_author ? (
          // 公式管理者: shield アイコン
          <View style={STYLES.officialAvatar} accessibilityLabel="公式管理者">
            <Icon.shield size={20} color={C.accent} strokeWidth={2.4} />
          </View>
        ) : viewContext === 'community' ? (
          // コミュニティ詳細: 投稿者本人のアバター + 擬似ハンドル (de-anon Phase2)。
          //   画像優先 → emoji → 擬似色+頭文字 fallback。tap で擬似プロフィールへ。
          <PressableScale onPress={goToPseudoProfile} hitSlop={4} disabled={!pseudonymId}>
            <Avatar
              size={40}
              uri={post.avatar_url}
              emoji={post.avatar_url ? undefined : post.avatar_emoji}
              color={pseudo.color}
              name={pseudo.initial}
            />
          </PressableScale>
        ) : (
          // ホーム/デフォルト: コミュニティアイコン (タップでコミュニティへ遷移)
          <PressableScale
            onPressIn={undefined}
            onPress={onPrimaryCommunityPress}
            hitSlop={4}
            disabled={!primaryCommunity}
          >
            {/* コミュニティアイコンは共有 <CommunityIcon> に集約 (commit f8267aa)。
                画像優先 + contentFit="contain" で「必ず表示 / 拡大しない」。
                (Avatar は emoji 優先なので uploaded icon_url が emoji に隠れていた) */}
            <CommunityIcon
              size={40}
              iconUrl={primaryCommunity?.icon_url}
              iconEmoji={primaryCommunity?.icon_emoji}
              name={primaryCommunity?.name}
            />
          </PressableScale>
        )}

        {/* ===== メタ (名前 + 時刻) ===== */}
        {post.official_author ? (
          // 公式管理者
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
        ) : viewContext === 'community' ? (
          // コミュニティ詳細: 投稿者の擬似ハンドル (tap で擬似プロフィール) + 時刻
          <View style={STYLES.anonRow}>
            <PressableScale
              onPress={goToPseudoProfile}
              disabled={!pseudonymId}
              scaleValue={0.98}
            >
              <Text style={[anonLabelStyle, { color: pseudo.color }]} numberOfLines={1}>
                {pseudo.handle}
              </Text>
            </PressableScale>
            <View style={STYLES.anonMetaRow}>
              <Text style={STYLES.anonRelative} numberOfLines={1}>
                {formatRelative(post.created_at)}
              </Text>
            </View>
          </View>
        ) : (
          // ホーム/デフォルト: コミュニティ名 (タップ可) + 時刻
          <View style={STYLES.anonRow}>
            <PressableScale
              onPress={onPrimaryCommunityPress}
              disabled={!primaryCommunity}
              scaleValue={0.98}
            >
              <Text style={anonLabelStyle} numberOfLines={1}>
                {primaryCommunity?.name ?? t('コミュニティ')}
              </Text>
            </PressableScale>
            <View style={STYLES.anonMetaRow}>
              <Text style={STYLES.anonRelative} numberOfLines={1}>
                {formatRelative(post.created_at)}
              </Text>
              {communities.length > 1 && (
                <>
                  <Text style={STYLES.anonMetaDot}>·</Text>
                  <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                    +{communities.length - 1}
                  </Text>
                </>
              )}
            </View>
          </View>
        )}

        <PressableScale onPress={onMore} hitSlop={HIT_SLOP_10} style={STYLES.morePress}>
          <More size={20} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
        {/* mod 専用 3-dot menu — mod でない / 自分の投稿のときは null render。
            ★ author_id 非依存 (匿名マスクで他人の author_id は null になるため、
              isMod で gate し kick/ban は content ベース RPC へ)。 */}
        {primaryCommunityId && isMod && (
          <ModActionMenu
            target={modActionTarget}
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

      {/* ★ BBS 統合 (migration 0075) — title あれば content の上に大きく表示。
          スレ形式 post (旧 BBS thread) は title が main contentで、 content は ''。
          tap で post detail へ遷移 (本文 PressableScale と同じ behavior)。 */}
      {post.title && !isCwHidden ? (
        <View style={{ paddingTop: SP['3'], paddingBottom: post.content ? SP['1'] : SP['3'] }}>
          <PressableScale onPress={handleOpenDetail} haptic="tap" scaleValue={1}>
            <Text style={bbsTitleStyle} numberOfLines={3}>
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
            onPress={handleOpenDetail}
            onLongPress={useQuickReaction ? () => setMemePickerOpen(true) : undefined}
            haptic="tap"
            scaleValue={1}
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

      {/* メディア — 文章の下に表示 (文章 → 写真/動画 の順)。
          自然なアスペクト比で表示 (square crop しない)
          縦長は 4:5 (MEDIA_MIN_ASPECT) を上限にクロップ表示しフィードを占有させない
          (画像全体はタップ→ライトボックスで確認可)。横長はそのまま全体表示
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
            {/* 複数画像 = X/IG/Reddit 流のグリッド (cover でセンタークロップ)。
                縦積みは縦長で「コンパクトでない」ため 2〜4 枚をグリッド化。 */}
            {mediaUrls.length >= 2 ? (
              <MediaWithCWGuard cwCategory={cwCategory} blurhash={mediaBlurhashes[0]}>
                <FeedMediaGrid
                  items={mediaUrls.map((u, i) => ({ uri: u, blurhash: mediaBlurhashes[i], aspect: imgAspects[u] }))}
                  onPress={(idx) => openLightbox(mediaUrls[idx]!)}
                />
              </MediaWithCWGuard>
            ) : (
              mediaUrls.map((url, i) => {
                // ロード中は 4:3 (1.333) で仮置き → 解決後に真のアスペクト比へ差し替え
                const aspect = imgAspects[url] ?? 1.333;
                const blurhash = mediaBlurhashes[i];
                return (
                  <View
                    key={url}
                    style={[STYLES.mediaItemBase, mediaItemAspect(aspect, portraitMaxH)]}
                  >
                    <MediaWithCWGuard cwCategory={cwCategory} blurhash={blurhash}>
                      {/* single-tap でライトボックス。DoubleTapHeart(numberOfTaps 2) は通過。 */}
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
                          radius={16}
                          // ★ contain: 写真全体を必ず表示する (cover はズームに見えて不評だった)。
                          //   枠は 4:5〜1.91 にクランプ。範囲内は枠=画像比で letterbox 無し、
                          //   範囲外 (極端な縦長/横長) のみ bg2 で letterbox。全体はタップ→ライトボックス。
                          contentFit="contain"
                          lazy
                          thumbWidth={480}
                          priority="high"
                        />
                      </Pressable>
                    </MediaWithCWGuard>
                  </View>
                );
              })
            )}
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

      {/* リンクプレビュー — source_url か本文中の URL を OG カード化。
          flag ON: LinkPreviewCard (サーバーが取得した og:title/description/image)。
          flag OFF: 従来の出典バー。 */}
      {previewUrl && (
        useOgPreview ? (
          <LinkPreviewCard url={previewUrl} />
        ) : (
          <PressableScale onPress={openSource} haptic="tap" style={STYLES.sourceBtn}>
            <Text style={STYLES.sourceEmoji}>🔗</Text>
            <Text style={[T.caption, STYLES.sourceText]} numberOfLines={1}>
              出典: {shortHost(previewUrl)}
            </Text>
          </PressableScale>
        )
      )}

      {/* 投票 */}
      {poll && !isCwHidden && <PollCard poll={poll} />}

      {/* タグ群は feed カードでは非表示
          - ハッシュタグは見せない方針 (UI 雑音 + 押し付け感を排除)
          - 「+ タグ追加」UI も削除 (周りの人が他人投稿に tag を付与できないようにする)
          - DB の tag_names / added_tags は検索 index 用に残る */}

      {/* アクション行 — icon を 20px に統一. hitSlop:10 で 44pt 以上の tap target を確保
          (icon 自体は 20 だが押下範囲を上下左右 +10 で誤タップ防止)。
          gap は SP['5'] で各アクションを規則的に配置 — 「♥ 15 / 💬 9 / 🪶 15」 が
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
          onPress={handleOpenDetail}
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
          {reactionsList.slice(0, 5).map((r) => (
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
          {reactionsList.length > 5 && (
            <PressableScale
              onPress={() => setReactionsDetailOpen(true)}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel="押された全スタンプを見る"
              style={STYLES.reactionOverflowPill}
            >
              <Text style={STYLES.reactionOverflowText}>…</Text>
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
        reactions={reactionsList}
      />

      {/* 「…」から開く: 押された全スタンプの一覧 (閲覧 + タップでトグル) */}
      <ReactionListSheet
        visible={reactionsDetailOpen}
        onClose={() => setReactionsDetailOpen(false)}
        reactions={reactionsList}
        onReact={onReact}
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
  if (prev.viewContext !== next.viewContext) return false;
  return true; // skip re-render
});
