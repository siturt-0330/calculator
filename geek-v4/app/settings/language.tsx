// ============================================================
// 設定 → 言語
// ------------------------------------------------------------
// なぜ必要か:
//   オンボーディングで誤って 🇺🇸 English 等を選んでしまうと、
//   その後 lang を戻す UI が存在せず、JA 投稿が auto-translate で
//   英語化されたまま使い続ける事故が起きた (2026-05)。
//   設定画面から後付けで変更できるようにしてこの事故を解消する。
//
// 設計判断:
//   1. 即時保存 (Save ボタンなし)。タップ = 確定 + トースト
//   2. lang と autoTranslate を**独立トグル**にする
//      旧仕様: setLang(non-ja) すると autoTranslate も自動 ON
//      新仕様: lang のみ変更、autoTranslate は別 UI でユーザーが明示制御
//      → 「英語にしたら自動翻訳も勝手にオン」事故が再発しない
//   3. 現在選択中の lang はピル表示で視覚的にハイライト
// ============================================================
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Icon } from '../../constants/icons';
import { useLanguageStore, LANG_OPTIONS, type Lang } from '../../stores/languageStore';
import { useToastStore } from '../../stores/toastStore';
import { TABBAR } from '../../design/tabbar';

export default function LanguageSettingsScreen() {
  const insets = useSafeAreaInsets();
  // selector で個別購読 — 言語切替で settings 全体が再 render しないように
  const lang = useLanguageStore((s) => s.lang);
  const setLang = useLanguageStore((s) => s.setLang);
  const autoTranslate = useLanguageStore((s) => s.autoTranslate);
  const setAutoTranslate = useLanguageStore((s) => s.setAutoTranslate);
  const show = useToastStore((s) => s.show);

  const selectLang = (l: Lang) => {
    if (l === lang) return;
    setLang(l);
    // ja に戻すなら自動翻訳も切る (= 「日本語に戻したら英語のままになる」混乱を防ぐ)
    if (l === 'ja' && autoTranslate) setAutoTranslate(false);
    // ja 以外を選んだら autoTranslate を自動 ON にして投稿本文も翻訳する。
    // 静的 DICT 未対応の UI ラベルは Web のブラウザ翻訳機能 (_layout.tsx で
    // translate='yes' に切替済) が拾ってくれるので、本文 + ラベル両方が翻訳される。
    if (l !== 'ja' && !autoTranslate) setAutoTranslate(true);
    const opt = LANG_OPTIONS.find((o) => o.code === l);
    show(`${opt?.flag ?? ''} ${opt?.native ?? l} に変更しました`, 'success');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="言語" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
          gap: SP['4'],
        }}
      >
        {/* 説明 */}
        <View style={{ gap: SP['1'] }}>
          <Text style={[T.small, { color: C.text2 }]}>
            アプリの表示言語を選びます
          </Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            投稿の自動翻訳は下のトグルで個別に切替可能 (オンにすると他言語の投稿が選択言語に翻訳されます)
          </Text>
        </View>

        {/* 言語リスト */}
        <View style={{ gap: SP['2'] }}>
          {LANG_OPTIONS.map((opt) => {
            const isSelected = lang === opt.code;
            return (
              <PressableScale
                key={opt.code}
                onPress={() => selectLang(opt.code)}
                haptic="confirm"
                accessibilityLabel={`${opt.name} (${opt.native}) を選択`}
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
                  <Text style={[T.h4, { color: C.text }]}>{opt.native}</Text>
                  <Text style={[T.caption, { color: C.text3 }]}>{opt.name}</Text>
                </View>
                {isSelected && (
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: C.accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 14, color: '#fff', fontWeight: '800' }}>✓</Text>
                  </View>
                )}
              </PressableScale>
            );
          })}
        </View>

        {/* 自動翻訳 (lang 非依存の独立トグル) */}
        <View
          style={{
            padding: SP['4'],
            backgroundColor: 'rgba(124,177,255,0.10)',
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: 'rgba(124,177,255,0.30)',
            gap: SP['3'],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Icon.globe size={20} color="#7CB1FF" strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={[T.bodyM, { color: '#7CB1FF', fontWeight: '700' }]}>
                投稿を自動翻訳
              </Text>
              <Text style={[T.caption, { color: C.text2 }]}>
                {lang === 'ja'
                  ? '他言語投稿を日本語に翻訳します'
                  : '日本語投稿を選択言語に翻訳します'}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: SP['2'] }}>
            <PressableScale
              onPress={() => setAutoTranslate(true)}
              haptic="confirm"
              accessibilityLabel="自動翻訳をオン"
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
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '700',
                  color: autoTranslate ? '#fff' : C.text2,
                }}
              >
                ✓ ON
              </Text>
            </PressableScale>
            <PressableScale
              onPress={() => setAutoTranslate(false)}
              haptic="tap"
              accessibilityLabel="自動翻訳をオフ"
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
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '700',
                  color: !autoTranslate ? C.text : C.text3,
                }}
              >
                OFF
              </Text>
            </PressableScale>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
