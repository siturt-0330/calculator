// =============================================================================
// EditorialSubmitBar — EDITORIAL「特集」言語の確定(submit)バー
// -----------------------------------------------------------------------------
// 役割:
//   コミュニティ作成フォーム最下部の「刷る(=作成)」ボタン。誌面語彙(黒地 +
//   1px hairline + accent 一点集中)で、確定操作だけを静かに強く提示する。
//
//   構成(縦):
//     (1) 誌面注記(disabled かつ disabledReason がある時のみ)
//         上下 hairline で挟んだ欄外註。Icon.warn(amber)+ 理由テキスト
//         (T.caption / C.amber)。責めず「なぜ今押せないか」だけを示す。
//     (2) 本体ボタン
//         EDITORIAL: 角丸 R.lg の accent 塗りの横長ボタン。
//         disabled 時は C.bg4 + opacity で「不能」を罫線でなく沈黙で示す。
//         loading 時は白の ActivityIndicator を中央に出し二重送信を防ぐ。
//
//   presentational に徹する: 表示文言・色・disabled/loading・理由は全て props。
//   内部 state を持たない(アニメ sharedValue も不要 = 純表示)。
//
// 規約:
//   - 日本語(本体 label・注記)は FONT.jpB / FONT.jp。Syne(FONT.display)は
//     欧文専用なので和文には使わない(CJK 豆腐回避)。
//   - label と背景のコントラストを確保(accent 塗り時は白、不能時は C.text3)。
//   - iOS/Android/Web 全対応・BlurView 不使用(フラット = Web 同一品質)。
// =============================================================================

import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

import { C, SP, R, SIZE } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';

// -----------------------------------------------------------------------------
// props
// -----------------------------------------------------------------------------
export interface EditorialSubmitBarProps {
  /** ボタン本体の文言(例: 'コミュニティを作成') */
  label: string;
  /** 押下時(disabled / loading 中は親側で抑止される) */
  onPress: () => void;
  /** 送信中: 中央に白の ActivityIndicator を出し、押下を無効化する */
  loading?: boolean;
  /** 不能: accent 塗りをやめ C.bg4 + opacity で沈黙させ、押下を無効化する */
  disabled?: boolean;
  /**
   * 不能の理由(disabled の時だけ意味を持つ)。
   * 値があれば本体ボタンの上に「誌面注記(欄外註)」として表示する。
   * null / undefined のときは注記を一切出さない(誤誘導回避)。
   */
  disabledReason?: string | null;
}

// -----------------------------------------------------------------------------
// component
// -----------------------------------------------------------------------------
export function EditorialSubmitBar({
  label,
  onPress,
  loading = false,
  disabled = false,
  disabledReason,
}: EditorialSubmitBarProps) {
  // loading 中も実質 disabled(二重送信防止)。press 自体を殺す。
  const isInactive = disabled || loading;

  // 誌面注記は「不能 かつ 理由がある」時のみ。loading だけでは注記を出さない
  // (送信中はボタン内のインジケータで状態が伝わるため)。
  const showNote =
    disabled && typeof disabledReason === 'string' && disabledReason.trim().length > 0;

  // ラベル色: 有効時=白(accent 塗りとのコントラスト確保) / 不能時=C.text3。
  const labelColor = isInactive ? C.text3 : '#ffffff';

  return (
    <View style={styles.root}>
      {/* (1) 誌面注記 — 上下 hairline で挟んだ欄外註(amber) */}
      {showNote ? (
        <View style={styles.note}>
          <View style={styles.noteHairline} />
          <View style={styles.noteBody}>
            <Icon.warn size={14} color={C.amber} />
            <Text style={styles.noteText}>{disabledReason}</Text>
          </View>
          <View style={styles.noteHairline} />
        </View>
      ) : null}

      {/* (2) 本体ボタン — accent 塗りの横長(不能時 C.bg4 + opacity) */}
      <PressableScale
        onPress={onPress}
        haptic="confirm"
        disabled={isInactive}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isInactive, busy: loading }}
        style={[
          styles.button,
          isInactive ? styles.buttonInactive : styles.buttonActive,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <View style={styles.buttonInner}>
            <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>
              {label}
            </Text>
            {!isInactive ? <Icon.check size={18} color="#ffffff" /> : null}
          </View>
        )}
      </PressableScale>
    </View>
  );
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: {
    paddingHorizontal: SP['5'],
  },

  // --- 誌面注記(欄外註) ---
  note: {
    marginBottom: SP['4'],
  },
  noteHairline: {
    height: 1,
    backgroundColor: C.divider,
  },
  noteBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['2'],
    paddingVertical: SP['3'],
  },
  noteText: {
    ...T.caption,
    fontFamily: FONT.jp,
    color: C.amber,
    flex: 1,
  },

  // --- 本体ボタン ---
  button: {
    height: SIZE.touchLarge,
    borderRadius: R.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP['5'],
  },
  buttonActive: {
    backgroundColor: C.accent,
  },
  buttonInactive: {
    backgroundColor: C.bg4,
    opacity: 0.6,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP['2'],
  },
  label: {
    ...T.h4,
    fontFamily: FONT.jpB,
    fontSize: 16,
    lineHeight: 22,
  },
});
