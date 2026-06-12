// ============================================================
// components/community/ReasonPickerDialog.tsx
// ------------------------------------------------------------
// モデレーション処置 (投稿削除 / キック / BAN) の確認ダイアログ。
// ConfirmDialog と違い「理由」を選択/入力できる:
//   - プリセット理由を chip でワンタップ選択 (constants/modReasons.ts)
//   - 自由記述 (任意)
// 選んだ理由は対象本人へ通知される (Reddit 流の透明性)。理由は任意 (空でも実行可)。
//
// ConfirmDialog (children 非対応・固定レイアウト) を拡張するのではなく専用に作る。
// 演出 (backdrop fade / box zoom) は ConfirmDialog と揃える。
// ============================================================
import { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, TextInput, ScrollView } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { Button } from '../ui/Button';
import { PressableScale } from '../ui/PressableScale';
import { MOD_REMOVAL_REASONS } from '../../constants/modReasons';

export function ReasonPickerDialog({
  visible,
  title,
  message,
  confirmLabel = '実行',
  cancelLabel = 'キャンセル',
  destructive = true,
  presets = MOD_REMOVAL_REASONS,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  presets?: readonly string[];
  /** 理由つきで確定 (理由は trim 済み・空文字あり得る) */
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  // プリセット選択と自由記述を ★独立 state で持つ (結合させると chip タップで
  // 入力中テキストが消える/上書きされる事故になる)。送信値は「プリセット優先・無ければ自由記述」。
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState('');
  const finalReason = (selectedPreset ?? customReason).trim();

  // 開くたびにリセット (前回の理由を持ち越さない)
  useEffect(() => {
    if (visible) {
      setSelectedPreset(null);
      setCustomReason('');
    }
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onCancel}>
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(160)}
        style={{
          flex: 1,
          backgroundColor: C.scrim,
          alignItems: 'center',
          justifyContent: 'center',
          padding: SP['6'],
        }}
      >
        <Pressable
          onPress={onCancel}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <Animated.View
          entering={ZoomIn.duration(220)}
          exiting={ZoomOut.duration(160)}
          style={{
            width: '100%',
            maxWidth: 420,
            backgroundColor: C.bg2,
            borderRadius: R.xl,
            padding: SP['6'],
            gap: SP['3'],
            borderWidth: 1,
            borderColor: C.border,
            ...SHADOW.card,
          }}
        >
          <Text style={[T.h3, { color: C.text, fontWeight: '700' }]}>{title}</Text>
          {message ? (
            <Text style={[T.body, { color: C.text2, lineHeight: 22 }]}>{message}</Text>
          ) : null}

          <Text style={[T.small, { color: C.text3 }]}>理由 (任意・本人に通知されます)</Text>

          {/* プリセット理由 chip */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: SP['2'], paddingVertical: 2 }}
          >
            {presets.map((p) => {
              const active = selectedPreset === p;
              return (
                <PressableScale
                  key={p}
                  onPress={() => {
                    // chip 選択は自由記述と独立。選ぶと自由記述はクリア (どちらか一方)。
                    if (active) {
                      setSelectedPreset(null);
                    } else {
                      setSelectedPreset(p);
                      setCustomReason('');
                    }
                  }}
                  haptic="select"
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    paddingHorizontal: SP['3'],
                    paddingVertical: 6,
                    borderRadius: R.full,
                    backgroundColor: active ? C.accent : C.bg3,
                    borderWidth: 1,
                    borderColor: active ? C.accent : C.border,
                  }}
                >
                  <Text
                    style={[
                      T.caption,
                      { color: active ? '#fff' : C.text2, fontWeight: '700' },
                    ]}
                  >
                    {p}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>

          {/* 自由記述 */}
          <TextInput
            value={customReason}
            onChangeText={(t) => {
              // 自由記述を打ち始めたら chip 選択は解除 (どちらか一方)
              setCustomReason(t);
              if (selectedPreset !== null) setSelectedPreset(null);
            }}
            placeholder="理由を入力 (任意)"
            placeholderTextColor={C.text3}
            multiline
            maxLength={300}
            style={{
              minHeight: 60,
              maxHeight: 120,
              backgroundColor: C.bg,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              paddingHorizontal: SP['3'],
              paddingVertical: SP['2'] + 2,
              color: C.text,
              fontSize: 14,
              textAlignVertical: 'top',
            }}
          />

          <View style={{ gap: SP['2'], marginTop: SP['1'] }}>
            <Button
              label={confirmLabel}
              onPress={() => onConfirm(finalReason)}
              variant={destructive ? 'danger' : 'primary'}
              size="lg"
              fullWidth
              haptic={destructive ? 'warn' : 'confirm'}
            />
            <Button
              label={cancelLabel}
              onPress={onCancel}
              variant="ghost"
              size="lg"
              fullWidth
              haptic="tap"
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
