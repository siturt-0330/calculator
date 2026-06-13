// ============================================================
// PollEditorSheet — 投稿アンケート (poll) を編集する bottom sheet
// ------------------------------------------------------------
// X (Twitter) のアンケート作成 + Reddit のオプション編集を融合した、
// composer 専用のフルコントロール sheet。GEEK の dark / light (紫アクセント)
// テーマに準拠し、白背景は使わず必ず theme token で塗る。
//
// 設計判断:
//   - 共有 Sheet component がまだ無いので、RN Modal + Reanimated 3
//     (FadeIn/Out backdrop + SlideInDown/Out panel) で inline 構築。
//     既存 components/post/TagPickerSheet.tsx と同一 pattern に揃える。
//   - 純 presentational: question / options / multiSelect / hours は
//     すべて props で受け取り、変更は callback で親へ返す。内部 state は
//     アニメーション・focus 以外に source of truth を持たない (= 親が
//     2..4 件の min/max や hours の妥当性を強制する責務を負う)。
//   - TextInput を含むため KeyboardAvoidingView (iOS: padding) で覆い、
//     キーボードで sheet が隠れないようにする。
//   - 配色は useColors() で購読 → テーマ切替に自動追従。Toggle は内部で
//     design/tokens の C (dark 固定) を使うが、本 sheet が扱う他の塗りは
//     すべて theme-aware。
//
// option 行の key について:
//   options は重複・空文字を許す plain string 配列なので、値ベースの key は
//   衝突する (例: ['', ''])。スロット位置こそが安定した identity なので、
//   `opt-${i}` (index ベース) を意図的に採用する。並べ替え UI は無く、
//   追加は末尾 append・削除は filter なので、index を key にしても
//   reconciliation の不整合 (state の取り違え) は起きない。
// ============================================================

import { useCallback } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BarChart3, Plus, X } from 'lucide-react-native';
import { useColors } from '../../../hooks/useColors';
import { useWebKeyboardInset } from '../../../hooks/useWebKeyboardInset';
import { R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { Icon } from '../../../constants/icons';
import { hap } from '../../../design/haptics';
import { PressableScale } from '../../ui/PressableScale';
import { Input } from '../../ui/Input';
import { Toggle } from '../../ui/Toggle';
// ★ 2026-06-12 P0-2: grabber を「引っ張れる契約」にする
import { SheetSwipeDown } from '../../ui/SheetSwipeDown';

// ============================================================
// constants
// ------------------------------------------------------------
// app/post/create.tsx の POLL_HOURS_OPTIONS と完全一致させる ([6,24,72,168])。
// 親 (create.tsx) は数値を保持し、表示用の日本語ラベルだけここで対応付ける。
// ============================================================

/** アンケート期間の候補 (時間)。create.tsx の POLL_HOURS_OPTIONS と一致 */
const POLL_HOURS_OPTIONS: readonly number[] = [6, 24, 72, 168];

/** 期間 (時間) → 日本語ラベル。未知値は素朴な "Nh" にフォールバック */
function hoursLabel(h: number): string {
  switch (h) {
    case 6:
      return '6時間';
    case 24:
      return '1日';
    case 72:
      return '3日';
    case 168:
      return '1週間';
    default:
      return `${h}時間`;
  }
}

/** 選択肢の上限・下限 (UI 表示用。実際の強制は親が行う) */
const MAX_OPTIONS = 4;
const MIN_OPTIONS = 2;

/** 質問・選択肢の最大文字数 */
const QUESTION_MAX_LEN = 100;
const OPTION_MAX_LEN = 40;

// ============================================================
// props
// ============================================================

export interface PollEditorSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 質問文 (任意・空でも可) */
  question: string;
  onQuestionChange: (v: string) => void;
  /** 選択肢の配列 (2..4 件)。親が min/max を強制する */
  options: string[];
  onOptionChange: (index: number, v: string) => void;
  /** 選択肢を 1 件追加 (親が max 4 を強制) */
  onAddOption: () => void;
  /** index の選択肢を削除 (親が min 2 を強制) */
  onRemoveOption: (index: number) => void;
  /** 複数選択を許可するか */
  multiSelect: boolean;
  onToggleMulti: (v: boolean) => void;
  /** 締切までの時間。POLL_HOURS_OPTIONS のいずれか */
  hours: number;
  onHoursChange: (h: number) => void;
  /** 任意: アンケート自体を削除するアクション (destructive) */
  onClear?: () => void;
}

// ============================================================
// PollEditorSheet
// ============================================================

export function PollEditorSheet({
  visible,
  onClose,
  question,
  onQuestionChange,
  options,
  onOptionChange,
  onAddOption,
  onRemoveOption,
  multiSelect,
  onToggleMulti,
  hours,
  onHoursChange,
  onClear,
}: PollEditorSheetProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  // web: ソフトキーボード高さ (native は 0)。RNW の KeyboardAvoidingView は no-op
  // なので scrim の下 padding に足して sheet をキーボードの上へ持ち上げる。
  const webKeyboardInset = useWebKeyboardInset();

  const canAdd = options.length < MAX_OPTIONS;
  const canRemove = options.length > MIN_OPTIONS;

  // × / backdrop で閉じる — 軽い tap haptic
  const handleClose = useCallback(() => {
    hap.tap();
    onClose();
  }, [onClose]);

  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    hap.tap();
    onAddOption();
  }, [canAdd, onAddOption]);

  const handleRemove = useCallback(
    (index: number) => {
      hap.pop();
      onRemoveOption(index);
    },
    [onRemoveOption],
  );

  const handleClear = useCallback(() => {
    if (!onClear) return;
    hap.warn();
    onClear();
  }, [onClear]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
    >
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        style={{
          flex: 1,
          backgroundColor: C.scrim,
          justifyContent: 'flex-end',
          // web のみ: キーボード高さ分 content box を縮め、sheet をキーボード上端へ。
          paddingBottom: webKeyboardInset,
        }}
      >
        {/* backdrop — tap で閉じる */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="アンケート編集を閉じる"
          onPress={handleClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}
        >
          <SheetSwipeDown onClose={handleClose}>
          <Animated.View
            entering={SlideInDown.duration(260)}
            exiting={SlideOutDown.duration(200)}
            accessibilityViewIsModal
            style={{
              backgroundColor: C.bg2,
              borderTopLeftRadius: R.xl,
              borderTopRightRadius: R.xl,
              borderTopWidth: 1,
              borderTopColor: C.border,
              // キーボード表示中 (web) は home indicator 用 safe-area を足さない。
              paddingBottom: (webKeyboardInset > 0 ? 0 : insets.bottom) + SP['3'],
              maxHeight: '92%',
            }}
          >
            {/* ===== drag indicator ===== */}
            <View style={{ alignItems: 'center', paddingTop: SP['2'] }}>
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: C.text4,
                }}
              />
            </View>

            {/* ===== header (icon + title + close) ===== */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                paddingHorizontal: SP['5'],
                paddingTop: SP['3'],
                paddingBottom: SP['3'],
              }}
            >
              <BarChart3 size={20} color={C.accent} strokeWidth={2.4} />
              <Text
                accessibilityRole="header"
                style={[T.h3, { color: C.text, flex: 1 }]}
              >
                アンケート
              </Text>
              <Pressable
                onPress={handleClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="閉じる"
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: pressed ? C.bg4 : C.bg3,
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <X size={18} color={C.text2} strokeWidth={2.2} />
              </Pressable>
            </View>

            <ScrollView
              // flexShrink: 1 — panel が縮んだ時 (web キーボード表示中) に中身を縮め、
              // 末尾がキーボードの裏に潜らないようにする (Yoga の既定 shrink は 0)。
              style={{ flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{
                paddingHorizontal: SP['5'],
                paddingTop: SP['1'],
                paddingBottom: SP['4'],
                gap: SP['5'],
              }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* ===== 1) 質問 ===== */}
              <View style={{ gap: SP['2'] }}>
                <Text style={[T.captionM, { color: C.text3 }]}>質問</Text>
                <Input
                  placeholder="質問 (任意)"
                  value={question}
                  onChangeText={onQuestionChange}
                  maxLength={QUESTION_MAX_LEN}
                  accessibilityLabel="アンケートの質問"
                />
              </View>

              {/* ===== 2) 選択肢 ===== */}
              <View style={{ gap: SP['2'] }}>
                <Text style={[T.captionM, { color: C.text3 }]}>
                  選択肢 ({options.length}/{MAX_OPTIONS})
                </Text>
                {options.map((opt, i) => {
                  // key は index ベース (`opt-${i}`) を意図的に採用。
                  // options は重複/空文字を許す plain string で値ベース key は
                  // 衝突するため、スロット位置を安定した identity とする。
                  const showRemove = options.length > MIN_OPTIONS;
                  return (
                    <View
                      key={`opt-${i}`}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: SP['2'],
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Input
                          placeholder={`選択肢 ${i + 1}`}
                          value={opt}
                          onChangeText={(v) => onOptionChange(i, v)}
                          maxLength={OPTION_MAX_LEN}
                          accessibilityLabel={`選択肢 ${i + 1}`}
                        />
                      </View>
                      {showRemove && (
                        <PressableScale
                          onPress={() => handleRemove(i)}
                          disabled={!canRemove}
                          accessibilityLabel={`選択肢 ${i + 1} を削除`}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: R.md,
                            backgroundColor: C.bg3,
                            borderWidth: 1,
                            borderColor: C.border,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Icon.trash size={16} color={C.text3} strokeWidth={2.2} />
                        </PressableScale>
                      )}
                    </View>
                  );
                })}

                {/* + 選択肢を追加 (max 4 で hide) */}
                {canAdd && (
                  <PressableScale
                    onPress={handleAdd}
                    accessibilityLabel="選択肢を追加"
                    accessibilityState={{ disabled: !canAdd }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      alignSelf: 'flex-start',
                      gap: 6,
                      paddingVertical: SP['2'],
                      paddingHorizontal: SP['3'],
                      borderRadius: R.full,
                      backgroundColor: C.accentBg,
                      borderWidth: 1,
                      borderColor: C.accentSoft,
                    }}
                  >
                    <Plus size={16} color={C.accent} strokeWidth={2.6} />
                    <Text style={[T.smallB, { color: C.accent }]}>選択肢を追加</Text>
                  </PressableScale>
                )}
              </View>

              {/* ===== 3) 複数選択を許可 ===== */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SP['3'],
                  paddingVertical: SP['1'],
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[T.bodyM, { color: C.text }]}>複数選択を許可</Text>
                  <Text style={[T.caption, { color: C.text3, marginTop: 2 }]}>
                    オンにすると複数の選択肢に投票できます
                  </Text>
                </View>
                <Toggle value={multiSelect} onChange={onToggleMulti} accessibilityLabel="複数選択を許可" />
              </View>

              {/* ===== 4) 期間 ===== */}
              <View style={{ gap: SP['2'] }}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <Icon.clock size={14} color={C.text3} strokeWidth={2.2} />
                  <Text style={[T.captionM, { color: C.text3 }]}>期間</Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: SP['2'],
                  }}
                  accessibilityRole="radiogroup"
                >
                  {POLL_HOURS_OPTIONS.map((h) => {
                    const active = hours === h;
                    return (
                      <PressableScale
                        key={h}
                        onPress={() => {
                          hap.select();
                          onHoursChange(h);
                        }}
                        accessibilityRole="radio"
                        accessibilityLabel={hoursLabel(h)}
                        accessibilityState={{ selected: active }}
                        style={{
                          paddingVertical: SP['2'],
                          paddingHorizontal: SP['4'],
                          borderRadius: R.full,
                          backgroundColor: active ? C.accentBg : C.bg3,
                          borderWidth: 1,
                          borderColor: active ? C.accent : C.border,
                        }}
                      >
                        <Text
                          style={[
                            T.smallB,
                            { color: active ? C.accent : C.text2 },
                          ]}
                        >
                          {hoursLabel(h)}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>
              </View>

              {/* ===== 5) アンケートを削除 (任意・destructive) ===== */}
              {onClear && (
                <PressableScale
                  onPress={handleClear}
                  accessibilityRole="button"
                  accessibilityLabel="アンケートを削除"
                  style={{
                    alignSelf: 'center',
                    paddingVertical: SP['2'],
                    paddingHorizontal: SP['4'],
                  }}
                >
                  <Text style={[T.smallB, { color: C.red }]}>アンケートを削除</Text>
                </PressableScale>
              )}
            </ScrollView>
          </Animated.View>
          </SheetSwipeDown>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}
