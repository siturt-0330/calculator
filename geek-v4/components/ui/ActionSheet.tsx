import { View, Text, Modal, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from './PressableScale';
import { Divider } from './Divider';
// ★ 2026-06-12 P0-2: grabber を「引っ張れる契約」にする
import { SheetSwipeDown } from './SheetSwipeDown';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';
import type { LucideIcon } from 'lucide-react-native';

export type Action = {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  destructive?: boolean;
};

export function ActionSheet({
  title,
  actions,
  onClose,
}: {
  title?: string;
  actions: Action[];
  onClose?: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['8'] }}>
      {title && (
        <Text style={[T.smallM, { color: C.text3, marginBottom: SP['3'] }]}>{title}</Text>
      )}
      {actions.map((a, i) => (
        <View key={a.label}>
          <PressableScale
            onPress={() => { a.onPress(); onClose?.(); }}
            haptic={a.destructive ? 'warn' : 'tap'}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['3'],
              paddingVertical: SP['4'],
            }}
          >
            {a.icon && (
              <a.icon
                size={22}
                color={a.destructive ? C.red : C.text}
                strokeWidth={2.2}
              />
            )}
            <Text
              style={[T.body, { color: a.destructive ? C.red : C.text, flex: 1 }]}
            >
              {a.label}
            </Text>
          </PressableScale>
          {i < actions.length - 1 && <Divider />}
        </View>
      ))}
    </View>
  );
}

// ============================================================
// ActionSheetModal — Modal ホスト込みの ActionSheet (自己完結版)
// ------------------------------------------------------------
// Alert.alert のボタン付きメニューは react-native-web では **no-op**
// (タップしても何も起きない) [実証済: 本番 web で投稿カードの「…」が無反応
// 2026-06-12]。Alert.alert のメニュー用途はこのコンポーネントに置き換える。
// mypage.tsx の Modal+ActionSheet 手組みパターンを 1 コンポーネント化したもの。
//   - backdrop タップ / キャンセル相当は onClose
//   - action 選択時は onClose してから onPress (ActionSheet 側で実行順は逆だが
//     onPress 内で別 modal を開くケースに備えここでは閉じる→実行の順にしない。
//     既存 ActionSheet の挙動 (onPress→onClose) を踏襲)
// ============================================================
export function ActionSheetModal({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  actions: Action[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const TC = useColors(); // theme-aware palette (static C と区別)
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: TC.scrim, justifyContent: 'flex-end' }}
      >
        {/* シート本体 — onPress を握って backdrop タップ(閉じる)と分離 */}
        <SheetSwipeDown onClose={onClose}>
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: TC.bg2,
            borderTopLeftRadius: R.xl,
            borderTopRightRadius: R.xl,
            paddingBottom: insets.bottom + SP['2'],
            borderTopWidth: 1,
            borderColor: TC.border,
          }}
        >
          {/* grabber */}
          <View style={{ alignItems: 'center', paddingTop: SP['3'] }}>
            <View
              style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: TC.border }}
            />
          </View>
          <ActionSheet title={title} actions={actions} onClose={onClose} />
        </Pressable>
        </SheetSwipeDown>
      </Pressable>
    </Modal>
  );
}
