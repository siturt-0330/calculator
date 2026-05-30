// =============================================================================
// EditorialTagEditor — EDITORIAL「特集」言語の主題(タグ)入力エディタ
// -----------------------------------------------------------------------------
// 司書台帳の「主題分類」欄を踏襲した presentational なタグエディタ。
//   1) 選択済みタグの pill 群 … 塗りなし・細罫・#accent マーク + × で外す
//   2) 台帳記入欄(ledger rule)入力 … 行頭の縦罫が focus で divider→accent に灯る
//      左に Icon.hash・placeholder「タグを追加 (アニメ、ゲーム…)」・returnKey done
//   3) 罫線リストのサジェスト … # name + 「N投稿」+ Icon.plus(PressableScale)
//      最終行に「新しいタグ "#input" を作る」を accent の縦柱付きで肯定表示
// 黒地 + 1px hairline + 大型タイポ + 紫(accent)を要所に集中。塗りカード/濃い影なし。
// fetch/router/store を持たず、挙動はすべて props 注入。例外は入力の focus 内部 state と
// 縦罫の色アニメ(focusP)のみ(仕様で許可された唯一の内部状態)。
// =============================================================================

import { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '../../constants/icons';
import { C, R, SIZE, SP } from '../../design/tokens';
import { TIMING_NORM } from '../../design/motion';
import { FONT, T } from '../../design/typography';
import { HighlightedText } from '../ui/HighlightedText';
import { PressableScale } from '../ui/PressableScale';

// -----------------------------------------------------------------------------
// Props — すべて親注入(presentational)
// -----------------------------------------------------------------------------
type Suggestion = { name: string; post_count: number };

export type EditorialTagEditorProps = {
  /** 選択済みタグ */
  tags: string[];
  /** タグを外す */
  onRemove: (tag: string) => void;
  /** 入力中テキスト(制御) */
  input: string;
  /** 入力変更 */
  onInputChange: (text: string) => void;
  /** 入力確定(returnKey / submit)→ 現在の input をタグ化 */
  onSubmitTag: () => void;
  /** 補完候補 */
  suggestions: Suggestion[];
  /** 「新しいタグを作る」行を出すか */
  showCreateNew: boolean;
  /** 候補を採用 */
  onPickSuggestion: (name: string) => void;
  /** 新規タグを作成 */
  onCreateNew: () => void;
  /** 上限(任意・既定なし)。指定時はカウンタ表示 + 到達で入力停止 */
  max?: number;
};

export function EditorialTagEditor(props: EditorialTagEditorProps) {
  const reduce = useReducedMotion();
  const [focused, setFocused] = useState(false);

  // 行頭縦罫(ledger rule)の focus アニメ。色は worklet で divider→accent。
  const focusP = useSharedValue(0);

  // TIMING_NORM = { duration: 220, easing: EASE_OUT } (config をそのまま渡す)
  const onFocus = () => {
    setFocused(true);
    focusP.value = withTiming(1, TIMING_NORM);
  };
  const onBlur = () => {
    setFocused(false);
    focusP.value = withTiming(0, TIMING_NORM);
  };

  const ruleStyle = useAnimatedStyle(() => ({
    // reduce-motion 時は太さの伸縮を止め、色変化のみ(size animation を退避)
    width: reduce ? 2.5 : interpolate(focusP.value, [0, 1], [2, 3], Extrapolation.CLAMP),
    backgroundColor: interpolateColor(focusP.value, [0, 1], [C.divider, C.accent]),
  }));

  const trimmed = props.input.trim();
  const atLimit = props.max != null && props.tags.length >= props.max;
  const placeholder = atLimit ? '上限に達しました' : 'タグを追加 (アニメ、ゲーム…)';

  // input が空でなく(候補>0 || 新規作成可)の時だけサジェストを開く。上限到達時は閉じる。
  const showList = !atLimit && trimmed.length > 0 && (props.suggestions.length > 0 || props.showCreateNew);

  return (
    <View style={styles.root}>
      {/* (1) 選択済み pill 群 ------------------------------------------------ */}
      {props.tags.length > 0 && (
        <View style={styles.pillWrap}>
          {props.tags.map((tag) => (
            <Animated.View
              key={tag}
              entering={reduce ? undefined : FadeIn.duration(120)}
              exiting={reduce ? undefined : FadeOut.duration(120)}
              style={styles.pill}
            >
              <Icon.hash size={12} color={C.accent} />
              <Text style={styles.pillText} numberOfLines={1}>
                {tag}
              </Text>
              <PressableScale
                onPress={() => props.onRemove(tag)}
                haptic="select"
                hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`${tag} を外す`}
                style={styles.pillClose}
              >
                <Icon.close size={12} color={C.text3} />
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}

      {/* (2) 台帳記入欄(ledger rule)入力 ----------------------------------- */}
      <View style={[styles.inputRow, { marginTop: props.tags.length > 0 ? SP[3] : 0 }]}>
        <Animated.View style={[styles.rule, ruleStyle]} />
        <Icon.hash size={14} color={focused ? C.accent : C.text3} />
        <TextInput
          value={props.input}
          onChangeText={props.onInputChange}
          onSubmitEditing={props.onSubmitTag}
          onFocus={onFocus}
          onBlur={onBlur}
          editable={!atLimit}
          placeholder={placeholder}
          placeholderTextColor={C.text3}
          selectionColor={C.accent}
          cursorColor={C.accent}
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          style={[
            styles.input,
            // Web: ブラウザ既定のフォーカス枠線(OS accent 由来のオレンジ等)を消す。
            Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none' } as object) : null,
          ]}
        />
        {props.max != null && (
          <Text style={[styles.counter, { color: atLimit ? C.amber : C.text4 }]}>
            {`${props.tags.length}/${props.max}`}
          </Text>
        )}
      </View>

      {/* (3) 罫線リストのサジェスト ----------------------------------------- */}
      {showList && (
        <Animated.View
          entering={reduce ? undefined : FadeIn.duration(120)}
          style={styles.list}
        >
          {props.suggestions.map((s, i) => {
            const isLast = i === props.suggestions.length - 1 && !props.showCreateNew;
            return (
              <PressableScale
                key={s.name}
                onPress={() => props.onPickSuggestion(s.name)}
                haptic="confirm"
                accessibilityRole="button"
                accessibilityLabel={`#${s.name} を追加`}
                style={[styles.suggRow, !isLast && styles.rowDivider]}
              >
                <Icon.hash size={12} color={C.text3} />
                <View style={styles.suggNameWrap}>
                  <HighlightedText
                    text={s.name}
                    terms={[trimmed]}
                    style={styles.suggName}
                    highlightColor={C.accentLight}
                    numberOfLines={1}
                  />
                </View>
                <View style={styles.suggCount}>
                  <Text style={styles.suggCountNum}>{String(s.post_count)}</Text>
                  <Text style={styles.suggCountUnit}>投稿</Text>
                </View>
                <Icon.plus size={14} color={C.text3} />
              </PressableScale>
            );
          })}

          {/* 新規作成行 — 行頭の accent 縦柱で「無いものを作る」を肯定 */}
          {props.showCreateNew && (
            <PressableScale
              key="__create"
              onPress={props.onCreateNew}
              haptic="confirm"
              accessibilityRole="button"
              accessibilityLabel={`新しいタグ #${trimmed} を作る`}
              style={styles.createRow}
            >
              <View style={styles.createRule} />
              <Icon.plus size={14} color={C.accent} />
              <Text style={styles.createText} numberOfLines={1}>
                {`新しいタグ "#${trimmed}" を作る`}
              </Text>
            </PressableScale>
          )}
        </Animated.View>
      )}
    </View>
  );
}

// -----------------------------------------------------------------------------
// styles — 静的トークンで統一(塗りなし・1px hairline・余白でリズム)
// -----------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: {
    paddingHorizontal: SP[5],
    paddingVertical: SP[4],
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },

  // --- pill 群 ---
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP[2],
  },
  pill: {
    height: 28,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.full,
    paddingLeft: SP[3],
    paddingRight: SP[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[1],
  },
  pillText: {
    ...T.smallM,
    fontFamily: FONT.jpM,
    fontSize: 12,
    lineHeight: 16,
    color: C.text,
  },
  pillClose: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // --- ledger-rule 入力 ---
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
    // 入力欄は枠線なしの subtle な塗りのみで明示(背景と同化して分かりづらい問題の解消)。
    backgroundColor: C.bg2,
    borderRadius: R.md,
    paddingHorizontal: SP[3],
  },
  rule: {
    alignSelf: 'stretch',
    width: 2,
    borderRadius: 1,
    backgroundColor: C.divider,
  },
  input: {
    flex: 1,
    paddingVertical: SP[2],
    paddingHorizontal: 0,
    ...T.body,
    fontFamily: FONT.jp,
    fontSize: 15,
    lineHeight: 22,
    color: C.text,
  },
  counter: {
    ...T.num,
    fontFamily: FONT.ui,
    fontSize: 11,
    lineHeight: 14,
    color: C.text4,
  },

  // --- サジェストリスト ---
  list: {
    marginTop: SP[2],
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },
  suggRow: {
    minHeight: SIZE.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
  },
  suggNameWrap: {
    flex: 1,
  },
  suggName: {
    ...T.body,
    fontFamily: FONT.jp,
    fontSize: 15,
    lineHeight: 22,
    color: C.text2,
  },
  suggCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  suggCountNum: {
    ...T.num,
    fontFamily: FONT.ui,
    fontSize: 11,
    lineHeight: 14,
    color: C.text4,
  },
  suggCountUnit: {
    ...T.caption,
    fontFamily: FONT.jp,
    fontSize: 11,
    lineHeight: 14,
    color: C.text4,
  },

  // --- 新規作成行 ---
  createRow: {
    minHeight: SIZE.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
  },
  createRule: {
    alignSelf: 'stretch',
    width: 2,
    borderRadius: 1,
    backgroundColor: C.accent,
  },
  createText: {
    ...T.bodyMd,
    fontFamily: FONT.jpM,
    fontSize: 15,
    lineHeight: 22,
    color: C.accent,
    flex: 1,
  },
});
