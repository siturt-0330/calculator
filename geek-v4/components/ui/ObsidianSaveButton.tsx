import { useState } from 'react';
import { PressableScale } from './PressableScale';
import { Icon } from '../../constants/icons';
import { C } from '../../design/tokens';
import { useToastStore } from '../../stores/toastStore';
import { saveNoteToObsidian, OBSIDIAN_AVAILABLE, type ObsidianNote } from '../../lib/obsidian';
import { useObsidianEnabled } from '../../hooks/useObsidian';
import type { ViewStyle } from 'react-native';

// 共通の「Obsidian に保存」ボタン
// - 連携 OFF 時は何も表示しない (render null)
// - tap で saveNoteToObsidian → toast でフィードバック
// - parent から ObsidianNote を渡す
type Props = {
  note: ObsidianNote;
  size?: number;
  color?: string;
  style?: ViewStyle;
  /** 連携 OFF でもボタンは表示し、tap 時に設定画面誘導する場合 true */
  showWhenDisabled?: boolean;
};

export function ObsidianSaveButton({ note, size = 20, color = C.accent, style, showWhenDisabled }: Props) {
  const { enabled } = useObsidianEnabled();
  const [saving, setSaving] = useState(false);
  const { show } = useToastStore();
  // 開発者専用 — production では完全に非表示
  if (!OBSIDIAN_AVAILABLE) return null;
  if (!enabled && !showWhenDisabled) return null;

  const handlePress = async () => {
    if (saving) return;
    if (!enabled) {
      show('マイページ → Obsidian で連携を有効にしてください', 'warn');
      return;
    }
    setSaving(true);
    try {
      const r = await saveNoteToObsidian(note);
      if (r.ok) {
        show('Obsidian にノートを送信しました', 'success');
      } else if (r.reason === 'vault_not_set') {
        show('Vault 名が未設定です。マイページ → Obsidian で設定してください。', 'warn');
      } else if (r.reason === 'obsidian_not_installed') {
        show('Obsidian がインストールされていません', 'error');
      } else {
        show('送信に失敗しました', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <PressableScale
      onPress={handlePress}
      haptic="tap"
      disabled={saving}
      hitSlop={8}
      style={[{ padding: 2, opacity: saving ? 0.5 : 1 }, style]}
      accessibilityLabel="Obsidian に保存"
      accessibilityRole="button"
    >
      <Icon.edit size={size} color={color} strokeWidth={2.2} />
    </PressableScale>
  );
}
