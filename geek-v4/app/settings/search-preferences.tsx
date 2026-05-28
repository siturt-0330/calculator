// ============================================================
// app/settings/search-preferences.tsx
// ------------------------------------------------------------
// 検索のパーソナライズ設定画面。
//
// セクション構成:
//   1. パーソナライズ
//      - 検索のパーソナライズを有効にする (master)
//      - 検索履歴を使用
//      - 位置情報を使用 (opt-in)
//   2. 多様性
//      - 結果の多様化
//   3. データ管理
//      - 検索履歴を消去 (destructive)
//
// フッターに「センシティブ情報を推測しません」の transparency note。
//
// 既存 settings 画面 (notifications.tsx / privacy.tsx) と統一した UI:
//   - TopBar + BackButton + ScrollView
//   - C.bg / C.bg2 / R.lg / SP / T tokens
//   - Switch は trackColor 紫、thumbColor 白
//   - ConfirmDialog + toastStore で destructive action を確認
// ============================================================

import { useState } from 'react';
import { View, Text, ScrollView, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Divider } from '../../components/ui/Divider';
import { PressableScale } from '../../components/ui/PressableScale';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import {
  useSearchPreferences,
  useUpdateSearchPreferences,
  useClearSearchHistory,
} from '../../hooks/useSearchPreferences';
import { useSearchHistory } from '../../hooks/useSearchHistory';
import { useToastStore } from '../../stores/toastStore';
import type { SearchPreferences } from '../../lib/api/searchPreferences';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

// ----------------------------------------------------------------
// セクション/Row 型 — 「toggle 用」と「destructive button 用」を統一
// ----------------------------------------------------------------
type ToggleRow = {
  kind: 'toggle';
  key: keyof SearchPreferences;
  label: string;
  description: string;
  icon: keyof typeof Icon;
  /** true の場合、master が OFF でも disabled にならない (master 自身など) */
  alwaysEnabled?: boolean;
};

export default function SearchPreferencesScreen() {
  const insets = useSafeAreaInsets();
  const { preferences, isLoading } = useSearchPreferences();
  const update = useUpdateSearchPreferences();
  const clearServerHistory = useClearSearchHistory();
  const { clearAll: clearLocalHistory } = useSearchHistory();
  const showToast = useToastStore((s) => s.show);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const masterOn = preferences.personalization_enabled;

  // master が OFF なら sub-toggle を grey-out + disabled に。
  // ただし master 自身は常に操作可能。
  const isRowDisabled = (row: ToggleRow): boolean => {
    if (row.alwaysEnabled) return false;
    return !masterOn;
  };

  const personalizeRows: ToggleRow[] = [
    {
      kind: 'toggle',
      key: 'personalization_enabled',
      label: '検索のパーソナライズを有効にする',
      description: 'OFF にすると、すべて新着順 / 関連度のみで並びます',
      icon: 'sparkles',
      alwaysEnabled: true,
    },
    {
      kind: 'toggle',
      key: 'use_history',
      label: '検索履歴を使用',
      description: '過去の検索を参考に最適化',
      icon: 'clock',
    },
    {
      kind: 'toggle',
      key: 'use_location',
      label: '位置情報を使用',
      description: '現在地に応じた結果',
      icon: 'map',
    },
  ];

  const diversityRows: ToggleRow[] = [
    {
      kind: 'toggle',
      key: 'diversify_results',
      label: '結果の多様化',
      description: '同じ視点の繰り返しを避け、幅広い結果を表示',
      icon: 'globe',
    },
  ];

  const onClearHistory = async () => {
    setConfirmClear(false);
    if (clearing) return;
    setClearing(true);
    try {
      // server + client の両方を一掃 (server に失敗しても client は残す)
      await clearServerHistory.mutateAsync();
      try {
        clearLocalHistory();
      } catch {
        // 端末側 store が壊れていても無視 — 主要副作用は server 側
      }
      showToast('検索履歴を消去しました', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '消去に失敗しました';
      showToast(msg, 'error');
    } finally {
      setClearing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="検索のパーソナライズ" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
      >
        {/* イントロ説明 */}
        <View
          style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['2'],
            flexDirection: 'row',
            alignItems: 'flex-start',
          }}
        >
          <Icon.sparkles size={20} color={C.accent} strokeWidth={2} />
          <Text style={[T.small, { color: C.text2, flex: 1 }]}>
            検索結果は、あなたの興味や使い方に合わせて並び順を最適化できます。いつでも無効化できます。
          </Text>
        </View>

        {/* 1. パーソナライズ */}
        <ToggleSection
          title="パーソナライズ"
          rows={personalizeRows}
          preferences={preferences}
          isLoading={isLoading}
          isRowDisabled={isRowDisabled}
          onChange={(key, value) => update.mutate({ [key]: value })}
        />

        {/* 2. 多様性 */}
        <ToggleSection
          title="多様性"
          rows={diversityRows}
          preferences={preferences}
          isLoading={isLoading}
          isRowDisabled={isRowDisabled}
          onChange={(key, value) => update.mutate({ [key]: value })}
        />

        {/* 3. データ管理 */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text3, paddingHorizontal: SP['2'] }]}>
            データ管理
          </Text>
          <View
            style={{
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              overflow: 'hidden',
            }}
          >
            <PressableScale
              onPress={() => setConfirmClear(true)}
              haptic="warn"
              accessibilityRole="button"
              accessibilityLabel="検索履歴を消去"
              disabled={clearing}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: SP['4'],
                gap: SP['3'],
                opacity: clearing ? 0.5 : 1,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: C.redBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon.trash size={16} color={C.red} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[T.body, { color: C.red }]}>
                  検索履歴を消去
                </Text>
                <Text style={[T.caption, { color: C.text3 }]}>
                  サーバーと端末の両方の検索履歴を削除します
                </Text>
              </View>
              <Icon.chevronR size={18} color={C.text3} strokeWidth={2} />
            </PressableScale>
          </View>
        </View>

        {/* Transparency footer */}
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
            <Icon.shield size={14} color={C.text3} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>
              透明性について
            </Text>
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            Geek は人種・宗教・政治思想などのセンシティブな情報を推測しません。検索結果のランキングには、あなたが明示的に共有した検索履歴・位置情報・興味タグのみが使われます。
          </Text>
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirmClear}
        title="検索履歴を消去しますか?"
        message="サーバーと端末の両方から検索履歴を削除します。この操作は元に戻せません。"
        confirmLabel="消去する"
        cancelLabel="キャンセル"
        destructive
        onConfirm={onClearHistory}
        onCancel={() => setConfirmClear(false)}
      />
    </View>
  );
}

// ============================================================
// ToggleSection — 1 セクション分の toggle 行をカードでまとめる
// ============================================================
function ToggleSection({
  title,
  rows,
  preferences,
  isLoading,
  isRowDisabled,
  onChange,
}: {
  title: string;
  rows: ToggleRow[];
  preferences: SearchPreferences;
  isLoading: boolean;
  isRowDisabled: (row: ToggleRow) => boolean;
  onChange: (key: keyof SearchPreferences, value: boolean) => void;
}) {
  return (
    <View style={{ gap: SP['2'] }}>
      <Text style={[T.smallM, { color: C.text3, paddingHorizontal: SP['2'] }]}>
        {title}
      </Text>
      <View
        style={{
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
          opacity: isLoading ? 0.6 : 1,
        }}
      >
        {rows.map((row, i) => {
          const IconCmp = Icon[row.icon];
          const value = preferences[row.key];
          const disabled = isRowDisabled(row);
          return (
            <View key={row.key}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: SP['4'],
                  gap: SP['3'],
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: C.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconCmp size={16} color={C.accent} strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[T.body, { color: C.text }]}>{row.label}</Text>
                  <Text style={[T.caption, { color: C.text3 }]}>
                    {row.description}
                  </Text>
                </View>
                <Switch
                  value={value}
                  onValueChange={(v) => onChange(row.key, v)}
                  disabled={disabled}
                  trackColor={{ false: C.bg4, true: C.accent }}
                  thumbColor="#fff"
                />
              </View>
              {i < rows.length - 1 && <Divider />}
            </View>
          );
        })}
      </View>
    </View>
  );
}
