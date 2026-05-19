import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { useToastStore } from '@/stores/toastStore';
import { Icon } from '@/constants/icons';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import {
  getObsidianVault,
  setObsidianVault,
  isObsidianEnabled,
  setObsidianEnabled,
  openObsidianVault,
  saveToObsidian,
} from '@/lib/obsidian';

export default function ObsidianSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { show } = useToastStore();
  const [vault, setVault] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const v = await getObsidianVault();
      const e = await isObsidianEnabled();
      if (v) setVault(v);
      setEnabled(e);
      setLoading(false);
    })();
  }, []);

  const handleSaveVault = async () => {
    const t = vault.trim();
    if (!t) {
      show('Vault 名を入力してください', 'warn');
      return;
    }
    await setObsidianVault(t);
    show('Vault 名を保存しました', 'success');
  };

  const handleToggle = async (next: boolean) => {
    if (next && !vault.trim()) {
      show('先に Vault 名を入力してください', 'warn');
      return;
    }
    if (next && vault.trim() !== (await getObsidianVault())) {
      await setObsidianVault(vault.trim());
    }
    await setObsidianEnabled(next);
    setEnabled(next);
    show(next ? '連携を有効にしました' : '連携を無効にしました', 'success');
  };

  const handleTest = async () => {
    const ok = await openObsidianVault();
    if (!ok) {
      show('Obsidian を起動できませんでした。インストール済か確認してください。', 'error');
    }
  };

  const handleTestSave = async () => {
    if (!enabled) {
      show('まず連携を ON にしてください', 'warn');
      return;
    }
    const result = await saveToObsidian({
      id: 'test',
      content: '# Geek 連携テスト\n\nこれは Geek アプリから送られたテストノートです。',
      tagNames: ['geek', 'test'],
      createdAt: new Date().toISOString(),
    });
    if (result.ok) {
      show('Obsidian にテストノートを送信しました', 'success');
    } else if (result.reason === 'vault_not_set') {
      show('Vault 名を保存してください', 'warn');
    } else if (result.reason === 'obsidian_not_installed') {
      show('Obsidian がインストールされていません', 'error');
    } else {
      show('送信に失敗しました', 'error');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <TopBar title="Obsidian 連携" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 説明 */}
        <View
          style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['2'],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Text style={{ fontSize: 28 }}>📝</Text>
            <Text style={[T.h3, { color: C.text }]}>Obsidian と繋ぐ</Text>
          </View>
          <Text style={[T.body, { color: C.text2 }]}>
            気になる投稿を 1 タップで Obsidian Vault にノートとして保存できます。タグ・日付・元 URL は frontmatter として自動付与。
          </Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            動作要件: 同一デバイスに Obsidian がインストールされていること。
          </Text>
        </View>

        {/* Vault 名 */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>Vault 名</Text>
          <Input
            value={vault}
            onChangeText={setVault}
            placeholder="例: MyVault"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardAppearance="dark"
            selectionColor={C.accent}
          />
          <Text style={[T.caption, { color: C.text3 }]}>
            Obsidian の左下に表示されている Vault の名前を入力してください。
          </Text>
          <Button label="Vault 名を保存" onPress={handleSaveVault} size="sm" disabled={loading} />
        </View>

        {/* 連携 toggle */}
        <View
          style={{
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['3'],
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]}>連携を有効にする</Text>
            <Text style={[T.caption, { color: C.text3, marginTop: 2 }]}>
              ON にすると投稿カードに「Obsidian に保存」ボタンが出ます。
            </Text>
          </View>
          <PressableScale
            onPress={() => handleToggle(!enabled)}
            haptic="select"
            hitSlop={8}
            style={{
              width: 52,
              height: 30,
              borderRadius: 15,
              backgroundColor: enabled ? C.accent : C.bg4,
              justifyContent: 'center',
              padding: 3,
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: '#fff',
                alignSelf: enabled ? 'flex-end' : 'flex-start',
              }}
            />
          </PressableScale>
        </View>

        {/* テスト */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>動作確認</Text>
          <PressableScale
            onPress={handleTest}
            haptic="tap"
            style={{
              padding: SP['3'],
              backgroundColor: C.bg3,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
            }}
          >
            <Icon.globe size={18} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.bodyMd, { color: C.text }]}>Vault を Obsidian で開く</Text>
          </PressableScale>
          <PressableScale
            onPress={handleTestSave}
            haptic="tap"
            disabled={!enabled}
            style={{
              padding: SP['3'],
              backgroundColor: enabled ? C.accentBg : C.bg3,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: enabled ? C.accent + '55' : C.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              opacity: enabled ? 1 : 0.5,
            }}
          >
            <Icon.send size={18} color={enabled ? C.accent : C.text3} strokeWidth={2.2} />
            <Text style={[T.bodyMd, { color: enabled ? C.accent : C.text3, fontWeight: '600' }]}>
              テストノートを送信
            </Text>
          </PressableScale>
        </View>

        {/* ヘルプ */}
        <View
          style={{
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['1'],
          }}
        >
          <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>うまく動かないときは</Text>
          <Text style={[T.caption, { color: C.text2, lineHeight: 18 }]}>
            • Obsidian アプリ (デスクトップ / モバイル) がインストールされているか確認
          </Text>
          <Text style={[T.caption, { color: C.text2, lineHeight: 18 }]}>
            • Vault 名の半角/全角・スペースを正確に
          </Text>
          <Text style={[T.caption, { color: C.text2, lineHeight: 18 }]}>
            • iOS Safari は URL スキームに制限あり — Obsidian モバイル経由でテスト推奨
          </Text>
          <Text style={[T.caption, { color: C.text2, lineHeight: 18 }]}>
            • Vault が「Sync」中だと表示が遅延することあり
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
