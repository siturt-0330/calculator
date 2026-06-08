// ============================================================
// components/post/PostAuthorSheet.tsx — 自分の投稿に対する操作シート (編集 / 削除)
// ------------------------------------------------------------
// 「…」(more) を著者本人 (is_own) が押したときに出す。他人の投稿は ReportSheet。
// ReportSheet と同じ RN 標準 Modal のスライドアップで自己完結。
//   props: visible / onClose / onEdit / onDelete
// 削除は誤操作防止に「2 タップ確認」(1 回目で赤く確認文に変わり、2 回目で確定)。
//   ※ Alert.alert は web (react-native-web) で挙動が不安定なため使わない。
// ============================================================

import { useState } from 'react';
import { Modal, View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '../ui/PressableScale';
import { useColors } from '../../hooks/useColors';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';

const DANGER = '#ef4444';

export function PostAuthorSheet({
  visible,
  onClose,
  onEdit,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const insets = useSafeAreaInsets();
  const C = useColors();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const close = () => {
    setConfirmDelete(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        onPress={close}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
      >
        {/* カード本体 — タップを capture して backdrop close を防ぐ */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: C.bg,
            borderTopLeftRadius: R.lg,
            borderTopRightRadius: R.lg,
            paddingTop: SP['3'],
            paddingBottom: insets.bottom + SP['4'],
            paddingHorizontal: SP['4'],
          }}
        >
          {/* grabber */}
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: C.border,
              marginBottom: SP['3'],
            }}
          />
          <Text style={[T.h4, { color: C.text, marginBottom: SP['2'] }]}>投稿の操作</Text>

          {/* 編集 */}
          <PressableScale
            onPress={() => {
              close();
              onEdit();
            }}
            haptic="tap"
            accessibilityRole="button"
            accessibilityLabel="投稿を編集"
            style={{ paddingVertical: SP['4'], borderTopWidth: 1, borderTopColor: C.border }}
          >
            <Text style={[T.body, { color: C.text }]}>編集する</Text>
          </PressableScale>

          {/* 削除 — 2 タップ確認 */}
          <PressableScale
            onPress={() => {
              if (confirmDelete) {
                close();
                onDelete();
              } else {
                setConfirmDelete(true);
              }
            }}
            haptic="tap"
            accessibilityRole="button"
            accessibilityLabel={confirmDelete ? '削除を確定' : '投稿を削除'}
            style={{ paddingVertical: SP['4'], borderTopWidth: 1, borderTopColor: C.border }}
          >
            <Text style={[T.body, { color: DANGER }]}>
              {confirmDelete ? 'もう一度タップで削除' : '削除する'}
            </Text>
          </PressableScale>

          <PressableScale
            onPress={close}
            haptic="tap"
            accessibilityRole="button"
            accessibilityLabel="キャンセル"
            style={{
              marginTop: SP['4'],
              paddingVertical: SP['3'],
              alignItems: 'center',
              borderRadius: R.md,
              backgroundColor: C.bg2,
            }}
          >
            <Text style={[T.bodyB, { color: C.text2 }]}>キャンセル</Text>
          </PressableScale>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
