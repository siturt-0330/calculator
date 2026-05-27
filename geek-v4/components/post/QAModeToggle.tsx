import { useState, useCallback } from 'react';
import { View, Text, Switch } from 'react-native';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';
import { togglePostQAMode } from '../../lib/api/posts';
import { swallow } from '../../lib/swallow';

// ============================================================
// QAModeToggle — Q&A モードを post author だけが切替えられる ListItem 風 row
// ------------------------------------------------------------
// Reddit ガイド #17 (4.6 / 5.4 章) — post 詳細画面の "投稿主用 admin row" に
// 配置する想定。isAuthor=false の場合は null render (= 通常ユーザーには
// この row 自体が見えない)。
//
// Geek UI 統一:
//   - 左: Icon.help (lucide HelpCircle) サイズ 18, color C.accent
//   - 中央: 「Q&A モード」label (T.smallM, color C.text)
//   - 右: native Switch (trackColor false=C.bg4 true=C.accent, thumb #fff)
//   - padding: SP['3'] / SP['4']
//   - radius: R.sm
//   - border: 1px C.border
//   - 背景: C.bg2
//
// 楽観 update:
//   1) Switch を即座に enabled へ
//   2) togglePostQAMode を await
//   3) error なら revert + swallow で breadcrumb 残す
//
// onToggle prop (任意) — 親側で post.qa_mode の cache を patch するなど
// 追加の同期が必要なら使う。失敗時は呼ばない (revert 後)。
// ============================================================

export function QAModeToggle({
  postId,
  currentState,
  onToggle,
  isAuthor,
}: {
  postId: string;
  currentState: boolean;
  onToggle?: (next: boolean) => void;
  isAuthor: boolean;
}) {
  const [value, setValue] = useState<boolean>(currentState);
  const [pending, setPending] = useState<boolean>(false);
  const Help = Icon.help;

  // currentState が外から変わったら同期 (= 別経路で qa_mode が refetch された)
  // ※ useEffect は意図的に使わず、render 中の prop 差分検知で済ます
  //   (React の derived state パターン)。
  if (currentState !== value && !pending) {
    setValue(currentState);
  }

  const handleChange = useCallback(
    async (next: boolean) => {
      if (pending) return;
      setValue(next);
      setPending(true);
      try {
        await togglePostQAMode(postId, next);
        onToggle?.(next);
      } catch (e) {
        // revert
        setValue(!next);
        swallow('post.qaModeToggle', e);
      } finally {
        setPending(false);
      }
    },
    [postId, onToggle, pending],
  );

  if (!isAuthor) return null;

  return (
    <View
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: pending }}
      accessibilityLabel="Q&A モード"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        paddingHorizontal: SP['4'],
        paddingVertical: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.sm,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <Help size={18} color={C.accent} strokeWidth={2.2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
          Q&A モード
        </Text>
        <Text style={[T.caption, { color: C.text2 }]}>
          自分が返信したコメントを上位表示します
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={handleChange}
        disabled={pending}
        trackColor={{ false: C.bg4, true: C.accent }}
        thumbColor="#fff"
      />
    </View>
  );
}
