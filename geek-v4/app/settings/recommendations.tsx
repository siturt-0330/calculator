// ============================================================
// Settings → おすすめ・自動化
// ============================================================
// このアプリの「おすすめ」「自動化」関連の設定を集約する画面。
// 現在の項目:
//   - タグ自動グループ化 (autoApplyTagClusters)
//     ON: 高信頼クラスタが検出されると自動でタググラフに追加される
//     OFF: 候補表示のみ — ユーザーが「グループ化」ボタンを押して accept
// 将来追加予定:
//   - Feed personalize via cluster signals
//   - Search related-tag expansion
//   - Trending personalize
// ============================================================
import { View, Text, ScrollView, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { useSettingsStore } from '../../stores/settingsStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

export default function RecommendationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const autoApplyTagClusters = useSettingsStore((s) => s.autoApplyTagClusters);
  const update = useSettingsStore((s) => s.update);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="おすすめ・自動化" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['4'],
        }}
      >
        {/* タグ自動グループ化 */}
        <View
          style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['3'],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: C.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.sparkles size={18} color={C.accent} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[T.bodyM, { color: C.text, fontWeight: '700' }]}>
                タグ自動グループ化
              </Text>
              <Text style={[T.caption, { color: C.text3 }]}>
                信頼度の高いクラスタを自動でタググラフに追加
              </Text>
            </View>
            <Switch
              value={autoApplyTagClusters}
              onValueChange={(v) => update('autoApplyTagClusters', v)}
              trackColor={{ false: C.bg4, true: C.accent }}
              thumbColor="#fff"
            />
          </View>

          <View
            style={{
              padding: SP['3'],
              backgroundColor: C.bg3,
              borderRadius: R.md,
              gap: SP['2'],
            }}
          >
            <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>
              ON にすると:
            </Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              ・ 共起 + 同義タグが強く繋がっているクラスタを自動で追加します
            </Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              ・ 追加直後に「元に戻す」トーストが表示されます (5 秒以内)
            </Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              ・ 同セッション中は同じクラスタを再追加しません
            </Text>
          </View>

          <Text style={[T.caption, { color: C.text3 }]}>
            OFF (デフォルト) の場合は、タググラフ画面で候補を確認してから
            手動で「グループ化」ボタンを押す必要があります。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
