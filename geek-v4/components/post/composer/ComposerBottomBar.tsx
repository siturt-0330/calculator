// ============================================================
// components/post/composer/ComposerBottomBar.tsx
// ============================================================
// 投稿コンポーザーの最下部に、キーボードの上へピン留めする
// X (Twitter) 風の横並びアクションバー。左クラスタのみ:
//   - LEFT: 44×44 の円形 ghost アイコンボタン群
//       画像 / 動画 / 投票 / 書式 のトグル。
//
// 設計判断:
//   - 純 presentational。fetch / nav / store は一切持たず、
//     全アクションは callback に委譲する (press の Animated は内部 OK)。
//   - 上辺に hairline border (C.border) を引き、bg を敷いて
//     「バー」として読ませる。height ~52 + bottomInset を padding-bottom に。
//   - アクティブな toggle (poll/format) は accent tint:
//       icon を C.accent、背後に faint な C.accentBg の円を出す。
//   - 無効 (imagesFull/hasVideo/picking*) は opacity ~0.4 に沈めて
//     press を握り潰す (onPress を undefined にして PressableScale に渡す)。
//   - レジストリに無いアイコン (Film/BarChart3/Type) は
//     lucide-react-native から直接 import する。
// ============================================================

import { View } from 'react-native';
import { BarChart3, Film, Type } from 'lucide-react-native';
import { useColors } from '../../../hooks/useColors';
import { SP, SIZE } from '../../../design/tokens';
import { Icon } from '../../../constants/icons';
import { PressableScale } from '../../ui/PressableScale';

// ============================================================
// 定数: バー高 / アイコンサイズ / トグル円
// ============================================================
const BAR_HEIGHT = 52; // バー本体の高さ (bottomInset は別途 padding に足す)
const BTN = SIZE.touch; // 44 — 各アイコンボタンのタップ領域
const ICON_SIZE = 22; // 左クラスタのアイコン実寸
const DIM_OPACITY = 0.4; // 無効時の減光

// ============================================================
// Props
// ============================================================
export interface ComposerBottomBarProps {
  onPickImage: () => void;
  onPickVideo: () => void;
  onTogglePoll: () => void;
  onToggleFormat: () => void;
  pickingImage?: boolean; // 画像選択中 → 画像ボタンを subtle に loading/disabled
  pickingVideo?: boolean; // 動画選択中 → 動画ボタンを subtle に loading/disabled
  imagesFull?: boolean; // 画像が上限 → 画像ボタンを disabled + dim
  hasVideo?: boolean; // 既に動画あり → 動画ボタンを disabled + dim
  pollActive?: boolean; // 投票エディタ展開中 → 投票ボタンを highlight (accent tint)
  formatActive?: boolean; // 書式ツールバー展開中 → 書式ボタンを highlight (accent tint)
  hideVideo?: boolean; // 編集モード等で動画ボタンを出さない (動画は編集対象外)
  hidePoll?: boolean; // 編集モード等で投票ボタンを出さない (投票は編集対象外)
  bottomInset: number; // safe-area 下端ぶんの padding
}

// ============================================================
// ComposerBottomBar — 単一 export
// ============================================================
export function ComposerBottomBar({
  onPickImage,
  onPickVideo,
  onTogglePoll,
  onToggleFormat,
  pickingImage = false,
  pickingVideo = false,
  imagesFull = false,
  hasVideo = false,
  pollActive = false,
  formatActive = false,
  hideVideo = false,
  hidePoll = false,
  bottomInset,
}: ComposerBottomBarProps): JSX.Element {
  const C = useColors();

  const imageDisabled = imagesFull || pickingImage;
  const videoDisabled = hasVideo || pickingVideo;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        minHeight: BAR_HEIGHT,
        paddingTop: SP['1'],
        paddingBottom: SP['1'] + bottomInset,
        paddingHorizontal: SP['3'],
        backgroundColor: C.bg,
        borderTopWidth: 1,
        borderTopColor: C.border,
      }}
    >
      {/* ----- LEFT: アイコンボタンクラスタ ----- */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}>
        <IconActionButton
          C={C}
          renderIcon={(color) => <Icon.image size={ICON_SIZE} color={color} strokeWidth={2} />}
          accessibilityLabel="画像を追加"
          onPress={onPickImage}
          disabled={imageDisabled}
          dimmed={imagesFull}
          loading={pickingImage}
        />
        {!hideVideo && (
          <IconActionButton
            C={C}
            renderIcon={(color) => <Film size={ICON_SIZE} color={color} strokeWidth={2} />}
            accessibilityLabel="動画を追加"
            onPress={onPickVideo}
            disabled={videoDisabled}
            dimmed={hasVideo}
            loading={pickingVideo}
          />
        )}
        {!hidePoll && (
          <IconActionButton
            C={C}
            renderIcon={(color) => <BarChart3 size={ICON_SIZE} color={color} strokeWidth={2} />}
            accessibilityLabel="投票を追加"
            onPress={onTogglePoll}
            active={pollActive}
          />
        )}
        <IconActionButton
          C={C}
          renderIcon={(color) => <Type size={ICON_SIZE} color={color} strokeWidth={2} />}
          accessibilityLabel="書式を切り替え"
          onPress={onToggleFormat}
          active={formatActive}
        />
      </View>
    </View>
  );
}

// ============================================================
// IconActionButton — 44×44 の円形 ghost アイコンボタン
// ------------------------------------------------------------
// active 時は背後に faint な accentBg 円 + icon を accent に。
// disabled 時は opacity を下げ press を握り潰す (onPress を渡さない)。
// loading は subtle に減光してアイコンはそのまま残す (X 風の控えめさ)。
// ============================================================
function IconActionButton({
  C,
  renderIcon,
  accessibilityLabel,
  onPress,
  active = false,
  disabled = false,
  dimmed = false,
  loading = false,
}: {
  C: ReturnType<typeof useColors>;
  renderIcon: (color: string) => JSX.Element;
  accessibilityLabel: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  dimmed?: boolean; // 上限到達などで「機能的に使えない」減光 (DIM_OPACITY)
  loading?: boolean; // 処理中の subtle 減光
}): JSX.Element {
  // icon 色: active は accent、無効/減光は text3、通常は text2。
  const iconColor = active ? C.accent : disabled || dimmed ? C.text3 : C.text2;

  // opacity: 機能的に無効 (dimmed) が最優先で深く沈め、loading は控えめ。
  const opacity = dimmed ? DIM_OPACITY : loading ? 0.55 : 1;

  return (
    <PressableScale
      haptic="select"
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      style={{
        width: BTN,
        height: BTN,
        borderRadius: BTN / 2,
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        // active 時のみ faint な accent tint を背景に敷く。
        // 別途 absolute View を使うと Web (CSS) でアイコンが隠れるため
        // backgroundColor を直接 button に乗せる方式に統一。
        backgroundColor: active ? C.accentBg : 'transparent',
      }}
    >
      {renderIcon(iconColor)}
    </PressableScale>
  );
}
