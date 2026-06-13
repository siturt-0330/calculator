// ============================================================
// 外観 (Appearance) 設定 — light / dark / system 切替
// ------------------------------------------------------------
// /settings/appearance — settings/index から push される。
// テーマ切替は useThemeStore に直接 set するだけで、_layout の useColors() が
// 自動で再 render → body 背景 + Stack 背景が即時切り替わる。
// ============================================================

import { View, ScrollView, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Toggle } from '../../components/ui/Toggle';
import { useColors, useShadows } from '../../hooks/useColors';
import { useThemeStore, useResolvedTheme, type ThemeMode } from '../../lib/theme/themeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

type ModeOption = {
  mode: ThemeMode;
  label: string;
  description: string;
  // プレビュー用のミニ Post card 色
  sampleBg: string;
  sampleSurface: string;
  sampleText: string;
  sampleSubText: string;
  sampleAccent: string;
  sampleBorder: string;
};

// ★ 2026-06-13 ユーザー要望: 「システム設定に合わせる」は撤去 → ダーク/ライトの 2 択。
const OPTIONS: ModeOption[] = [
  {
    mode: 'dark',
    label: 'ダーク',
    description: '黒基調 — Geek の標準。深夜・室内向け',
    sampleBg: '#0a0a0a',
    sampleSurface: '#1c1c1c',
    sampleText: '#f5f5f7',
    sampleSubText: '#a1a1aa',
    sampleAccent: '#7C6AF7',
    sampleBorder: '#27272a',
  },
  {
    mode: 'light',
    label: 'ライト',
    description: '白基調 — 屋外・昼間でも読みやすい',
    sampleBg: '#ffffff',
    sampleSurface: '#f7f7f9',
    sampleText: '#1a1a1a',
    sampleSubText: '#52525b',
    // ★ 2026-06-13 モノトーン化: アクセント=純チャコール / 罫線=純 neutral グレー。
    sampleAccent: '#171717',
    sampleBorder: '#d6d6d6',
  },
];

export default function AppearanceSettingsScreen() {
  const insets = useSafeAreaInsets();
  const C = useColors();
  const SHADOW = useShadows();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const resolved = useResolvedTheme();
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const reduceHaptics = useSettingsStore((s) => s.reduceHaptics);
  const updateSetting = useSettingsStore((s) => s.update);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="外観" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['10'],
          paddingHorizontal: SP['4'],
        }}
      >
        <SectionHeader title="テーマ" />
        <Text style={[T.caption, { color: C.text3, marginHorizontal: SP['2'], marginBottom: SP['3'] }]}>
          現在: {resolved === 'light' ? 'ライト' : 'ダーク'}
        </Text>

        {OPTIONS.map((opt) => {
          const active = opt.mode === mode;
          return (
            <Pressable
              key={opt.mode}
              onPress={() => setMode(opt.mode)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${opt.label}を選択`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['3'],
                padding: SP['3'],
                marginBottom: SP['2'],
                borderRadius: R.lg,
                backgroundColor: active ? C.accentBg : C.bg2,
                borderWidth: 1.5,
                borderColor: active ? C.accent : C.border,
                opacity: pressed ? 0.7 : 1,
                ...SHADOW.xs,
              })}
            >
              {/* ミニ Post Card プレビュー — 実際の Geek UI と同じ構成
                  (背景 + surface + avatar pill + 本文 行) を縮小して表現。 */}
              <View
                style={{
                  width: 72,
                  height: 56,
                  borderRadius: R.md,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: opt.sampleBorder,
                  backgroundColor: opt.sampleBg,
                  padding: 4,
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    backgroundColor: opt.sampleSurface,
                    borderRadius: 6,
                    padding: 5,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: opt.sampleBorder,
                  }}
                >
                  {/* avatar */}
                  <View
                    style={{
                      width: 12, height: 12, borderRadius: 6,
                      backgroundColor: opt.sampleAccent,
                    }}
                  />
                  {/* 2 lines */}
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: opt.sampleText, opacity: 0.85 }} />
                    <View style={{ height: 3, borderRadius: 2, width: '70%', backgroundColor: opt.sampleSubText }} />
                  </View>
                </View>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[T.body, { color: C.text, fontWeight: '600' }]}>{opt.label}</Text>
                <Text style={[T.caption, { color: C.text3, marginTop: 2 }]} numberOfLines={2}>
                  {opt.description}
                </Text>
              </View>

              {/* チェックマーク */}
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: active ? C.accent : C.border2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? C.accent : 'transparent',
                }}
              >
                {active && <Icon.ok size={14} color="#fff" />}
              </View>
            </Pressable>
          );
        })}

        {/* ===== 動きと触感 (2026-06-12 Apple HIG 対応) =====
              OS の Reduce Motion は hooks/useReducedMotion が自動購読 (OR 評価)。
              ここは「OS 設定は触りたくないがアプリだけ抑えたい」ユーザー向けの app 内トグル。 */}
        <View style={{ height: SP['6'] }} />
        <SectionHeader title="動きと触感" />
        <View
          style={{
            borderRadius: R.lg,
            backgroundColor: C.bg2,
            borderWidth: 1,
            borderColor: C.border,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['3'],
              padding: SP['3'],
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[T.body, { color: C.text, fontWeight: '600' }]}>アニメーションを減らす</Text>
              <Text style={[T.caption, { color: C.text3, marginTop: 2 }]}>
                画面の動き・弾むアニメーションを抑えます (OS の「視差効果を減らす」設定にも自動で従います)
              </Text>
            </View>
            <Toggle
              value={reduceMotion}
              onChange={(v) => updateSetting('reduceMotion', v)}
              accessibilityLabel="アニメーションを減らす"
            />
          </View>
          {Platform.OS !== 'web' && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['3'],
                padding: SP['3'],
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: C.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[T.body, { color: C.text, fontWeight: '600' }]}>触覚フィードバックを減らす</Text>
                <Text style={[T.caption, { color: C.text3, marginTop: 2 }]}>
                  タップ時などの振動をオフにします
                </Text>
              </View>
              <Toggle
                value={reduceHaptics}
                onChange={(v) => updateSetting('reduceHaptics', v)}
                accessibilityLabel="触覚フィードバックを減らす"
              />
            </View>
          )}
        </View>

        <View
          style={{
            marginTop: SP['6'],
            padding: SP['4'],
            borderRadius: R.lg,
            backgroundColor: C.bg2,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Text style={[T.caption, { color: C.text2, lineHeight: 18 }]}>
            💡 一部の画面はまだダーク固定です。順次ライトモード対応を進めています。
            {'\n'}
            違和感がある画面があれば設定 → 「運営にお問い合わせ」からご連絡ください。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
