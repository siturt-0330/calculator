// ============================================================
// app/settings/language.tsx
// ------------------------------------------------------------
// 言語と自動翻訳の設定画面 (onboarding 後にも変更できる)。
// onboarding/language.tsx と UI コアは共通だが:
//   - 進行ステップ表示なし
//   - "次へ" ボタンなし (タップで即保存)
//   - 戻るボタンで設定一覧へ戻る
// ============================================================

import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { useLanguageStore, LANG_OPTIONS, type Lang } from '../../stores/languageStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export default function LanguageSettingsScreen() {
  const insets = useSafeAreaInsets();
  // selector 化 — hydrated 変化や他フィールド変更で無駄に再描画されないように
  const lang = useLanguageStore((s) => s.lang);
  const setLang = useLanguageStore((s) => s.setLang);
  const autoTranslate = useLanguageStore((s) => s.autoTranslate);
  const setAutoTranslate = useLanguageStore((s) => s.setAutoTranslate);

  // setLang は副作用で autoTranslate を自動 ON/OFF する仕様だが、ユーザーが
  // 後から手動で切り替えたい場合のために autoTranslate トグルを独立して提供。

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="言語設定" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
      >
        {/* 説明 */}
        <View style={{ gap: SP['1'] }}>
          <Text style={[T.h4, { color: C.text }]}>表示言語</Text>
          <Text style={[T.small, { color: C.text3 }]}>
            アプリ内 UI の表示言語を選択します。
          </Text>
        </View>

        {/* 言語選択 */}
        <View style={{ gap: SP['2'] }}>
          {LANG_OPTIONS.map((opt) => {
            const isSelected = lang === opt.code;
            return (
              <PressableScale
                key={opt.code}
                onPress={() => setLang(opt.code as Lang)}
                haptic="confirm"
                accessibilityLabel={`${opt.native} を選択${isSelected ? ' (選択中)' : ''}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SP['3'],
                  padding: SP['4'],
                  backgroundColor: isSelected ? C.accentBg : C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 2,
                  borderColor: isSelected ? C.accent : C.border,
                }}
              >
                <Text style={{ fontSize: 28 }}>{opt.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]}>{opt.native}</Text>
                  <Text style={[T.caption, { color: C.text3 }]}>{opt.name}</Text>
                </View>
                {isSelected && (
                  <View style={{
                    width: 22, height: 22, borderRadius: 11,
                    backgroundColor: C.accent,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 13, color: '#fff', fontWeight: '800' }}>✓</Text>
                  </View>
                )}
              </PressableScale>
            );
          })}
        </View>

        {/* 自動翻訳設定 — 日本語以外を選んだ時に出す */}
        {lang !== 'ja' && (
          <View style={{
            padding: SP['4'],
            backgroundColor: 'rgba(124,177,255,0.13)',
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: 'rgba(124,177,255,0.4)',
            gap: SP['3'],
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={{ fontSize: 22 }}>🤖</Text>
              <View style={{ flex: 1 }}>
                <Text style={[T.bodyMd, { color: '#7CB1FF', fontWeight: '700' }]}>
                  投稿を自動翻訳
                </Text>
                <Text style={[T.caption, { color: C.text2 }]}>
                  日本語の投稿をあなたの言語に自動翻訳して表示します。
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: SP['2'] }}>
              <PressableScale
                onPress={() => setAutoTranslate(true)}
                haptic="confirm"
                accessibilityLabel="自動翻訳 ON"
                style={{
                  flex: 1,
                  paddingVertical: SP['2'],
                  backgroundColor: autoTranslate ? '#7CB1FF' : C.bg3,
                  borderRadius: R.md,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: autoTranslate ? '#7CB1FF' : C.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: autoTranslate ? '#fff' : C.text2 }}>
                  ✓ ON
                </Text>
              </PressableScale>
              <PressableScale
                onPress={() => setAutoTranslate(false)}
                haptic="tap"
                accessibilityLabel="自動翻訳 OFF"
                style={{
                  flex: 1,
                  paddingVertical: SP['2'],
                  backgroundColor: !autoTranslate ? C.bg4 : C.bg3,
                  borderRadius: R.md,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: !autoTranslate ? C.text2 : C.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: !autoTranslate ? C.text : C.text3 }}>
                  OFF
                </Text>
              </PressableScale>
            </View>
          </View>
        )}

        {/* 補足: 翻訳の限界について */}
        <View style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          gap: SP['2'],
        }}>
          <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>翻訳について</Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            ・自動翻訳は機械翻訳エンジン (MyMemory) を利用しています。{'\n'}
            ・固有名詞 (Geek 等) は翻訳されず原文のまま表示されます。{'\n'}
            ・翻訳精度は完璧ではないため、重要な内容は原文で確認することをおすすめします。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
