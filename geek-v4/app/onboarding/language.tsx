import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { Button } from '../../components/ui/Button';
import { PressableScale } from '../../components/ui/PressableScale';
import { BackButton } from '../../components/nav/BackButton';
import { useLanguageStore, LANG_OPTIONS, type Lang } from '../../stores/languageStore';
import { StepProgress } from './_progress';

export default function LanguageOnboarding() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lang, setLang, autoTranslate, setAutoTranslate } = useLanguageStore();

  const select = (l: Lang) => {
    setLang(l);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['6'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <BackButton />
          <StepProgress step={1} />
        </View>
        {/* タイトル */}
        <View style={{ alignItems: 'center', gap: SP['2'] }}>
          <Text style={{ fontSize: 56 }}>🌏</Text>
          <Text style={{ fontFamily: FONT.display, fontSize: 32, color: C.text, letterSpacing: -0.5 }}>
            Choose Language
          </Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            言語を選択してください{'\n'}
            <Text style={[T.small, { color: C.text3 }]}>Select your preferred language</Text>
          </Text>
        </View>

        {/* 言語選択 */}
        <View style={{ gap: SP['2'] }}>
          {LANG_OPTIONS.map((opt) => {
            const isSelected = lang === opt.code;
            return (
              <PressableScale
                key={opt.code}
                onPress={() => select(opt.code)}
                haptic="confirm"
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
                <Text style={{ fontSize: 30 }}>{opt.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[T.h4, { color: C.text }]}>{opt.native}</Text>
                  <Text style={[T.caption, { color: C.text3 }]}>{opt.name}</Text>
                </View>
                {isSelected && (
                  <View style={{
                    width: 24, height: 24, borderRadius: 12,
                    backgroundColor: C.accent,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 14, color: '#fff', fontWeight: '800' }}>✓</Text>
                  </View>
                )}
              </PressableScale>
            );
          })}
        </View>

        {/* 自動翻訳設定 */}
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
                  Auto-translate posts
                </Text>
                <Text style={[T.caption, { color: C.text2 }]}>
                  AI が日本語投稿を自動的に翻訳して表示します
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: SP['2'] }}>
              <PressableScale
                onPress={() => setAutoTranslate(true)}
                haptic="confirm"
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

        <View style={{ flex: 1 }} />
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + SP['4'],
          left: SP['6'],
          right: SP['6'],
        }}
      >
        <Button
          label={lang === 'en' ? 'Next' :
                 lang === 'zh' ? '下一步' :
                 lang === 'ko' ? '다음' :
                 lang === 'es' ? 'Siguiente' :
                 lang === 'fr' ? 'Suivant' :
                 lang === 'th' ? 'ถัดไป' :
                 lang === 'vi' ? 'Tiếp theo' :
                 lang === 'id' ? 'Lanjut' : '次へ'}
          onPress={() => router.push('/onboarding/nickname')}
          haptic="confirm"
        />
      </View>
    </View>
  );
}
