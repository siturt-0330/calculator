// ============================================================
// /welcome-theme — サインアップ直後に 1 回だけ表示するテーマ選択
// ------------------------------------------------------------
// 「初めて利用する人がメアド登録のあとに、ダーク/ライトを選べるように」
// (ユーザー要望 2026-06-13)。
//
// 設計:
//   - signup.tsx は autoLoggedIn 時、router.replace('/welcome-theme') する。
//   - 既存 settings/appearance のカード意匠を踏襲 (同じ ModeOption shape)。
//   - 選択するとその場で useThemeStore.setMode() を呼んで即プレビュー反映
//     (_layout.tsx が C/GRAD を hot-swap + key remount で全画面追従)。
//   - 「Geek を始める」ボタンで /(tabs)/feed へ replace。BackButton は出さない
//     (戻りたい先が無い 1 シーン)。
//   - 直 URL で開かれても害は無い (任意に切替えて feed へ行くだけ・既存
//     /settings/appearance とほぼ等価)。
// ============================================================

import { View, ScrollView, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors, useShadows, useTheme } from '../hooks/useColors';
import { useThemeStore, type ThemeMode } from '../lib/theme/themeStore';
import { Button } from '../components/ui/Button';
import { R, SP } from '../design/tokens';
import { T, LOGO_FONT, LOGO_FONT_WEIGHT, geekGradientFill } from '../design/typography';
import { Icon } from '../constants/icons';

type ModeOption = {
  mode: ThemeMode;
  label: string;
  description: string;
  // ミニ Post Card プレビュー用色 (settings/appearance.tsx と一致)
  sampleBg: string;
  sampleSurface: string;
  sampleText: string;
  sampleSubText: string;
  sampleAccent: string;
  sampleBorder: string;
};

// ★ 2026-06-13 ユーザー要望: 「システム設定に合わせる」は不要 → ダーク/ライトの 2 択のみ。
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
    // モノトーン化済 (2026-06-13・純 neutral)
    sampleAccent: '#171717',
    sampleBorder: '#d6d6d6',
  },
];

export default function WelcomeThemeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const C = useColors();
  const SHADOW = useShadows();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const start = () => {
    router.replace('/(tabs)/feed');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + SP['10'],
          paddingBottom: SP['6'],
          paddingHorizontal: SP['5'],
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== ヘッダー (中央寄せ・Apple HIG オンボーディング流) =====
            ★ 2026-06-13: ロゴ (GeekLogo) はユーザー要望で撤去。テキストのみで簡潔に。 */}
        <View style={{ alignItems: 'center', marginBottom: SP['8'], gap: SP['2'] }}>
          {/* ★ 2026-06-13: 「Geek」はブランドフォント (LOGO_FONT) で揃える。
              display フォントのままだと Latin グリフが浮いて見えた (ユーザー指摘)。 */}
          <Text style={[T.h1, { color: C.text, textAlign: 'center', letterSpacing: -0.5 }]}>
            <Text style={{ fontFamily: LOGO_FONT, fontWeight: LOGO_FONT_WEIGHT }}>Geek</Text>
            {' へようこそ'}
          </Text>
          <Text
            style={[
              T.body,
              { color: C.text2, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
            ]}
          >
            まず外観を選びましょう。{'\n'}あとから設定でいつでも変えられます。
          </Text>
        </View>

        {/* 3 カード */}
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
                padding: SP['4'],
                marginBottom: SP['3'],
                borderRadius: R.lg,
                backgroundColor: active ? C.accentBg : C.bg2,
                borderWidth: 1.5,
                borderColor: active ? C.accent : C.border,
                opacity: pressed ? 0.7 : 1,
                ...SHADOW.xs,
              })}
            >
              {/* ミニ Post Card プレビュー */}
              <View
                style={{
                  width: 84,
                  height: 64,
                  borderRadius: R.md,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: opt.sampleBorder,
                  backgroundColor: opt.sampleBg,
                  padding: 5,
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    backgroundColor: opt.sampleSurface,
                    borderRadius: 6,
                    padding: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: opt.sampleBorder,
                  }}
                >
                  <View
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 7,
                      backgroundColor: opt.sampleAccent,
                    }}
                  />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View
                      style={{
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: opt.sampleText,
                        opacity: 0.85,
                      }}
                    />
                    <View
                      style={{
                        height: 3,
                        borderRadius: 2,
                        width: '70%',
                        backgroundColor: opt.sampleSubText,
                      }}
                    />
                  </View>
                </View>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[T.body, { color: C.text, fontWeight: '600' }]}>
                  {opt.label}
                </Text>
                <Text
                  style={[T.caption, { color: C.text3, marginTop: 2 }]}
                  numberOfLines={2}
                >
                  {opt.description}
                </Text>
              </View>

              {/* チェックマーク */}
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  borderWidth: 2,
                  borderColor: active ? C.accent : C.border2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? C.accent : 'transparent',
                }}
              >
                {active && <Icon.ok size={15} color={C.bg} />}
              </View>
            </Pressable>
          );
        })}

        {/* ===== 選択中テーマのライブプレビュー =====
            ★ 2026-06-13 ユーザー要望: カードと CTA の間に実際のアプリ画面の縮図を置き、
              選んだテーマ (ダーク/ライト) に合わせて即座に切り替わるようにする。
              useColors() を使う本コンポーネントは、カードをタップ → setMode で全画面が
              再テーマ化されるのに追従して、そのまま選択テーマの見た目を映す。 */}
        <ThemePreview />

      </ScrollView>

      {/* ===== 固定 CTA — Apple HIG: 主要アクションは常時見える底部に置く =====
          スクロール量に依らず「始める」が必ず手元にあるようにする。 */}
      <View
        style={{
          paddingHorizontal: SP['5'],
          paddingTop: SP['3'],
          paddingBottom: insets.bottom + SP['4'],
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: C.border,
          backgroundColor: C.bg,
        }}
      >
        <Button label="Geek を始める" onPress={start} size="lg" fullWidth />
      </View>
    </View>
  );
}

// ============================================================
// ThemePreview — 選択中テーマの「アプリ画面の縮図」(端末フレーム)
// ------------------------------------------------------------
// useTheme() で現在 (= 選択中) のパレット/グラデ/isDark を引くので、ダーク/
// ライトを切り替えるたびに実アプリと同じ配色でプレビューが切り替わる。
// ★ 2026-06-13 改善: 実アプリと色を完全一致させる:
//   - "Geek" ワードマークは feed.tsx と同じグラデ (dark=紫→水色→ミント /
//     light=フラットなチャコール)。flat 白だった旧版の色ズレを解消。
//   - スコープ active pill は実 ScopeToggle と同じ GRAD.primary グラデ。
//   - ヘッダー/アクション/タブは本物の Lucide アイコン (旧: 灰色の丸)。
// ============================================================
function ThemePreview() {
  const { C, GRAD, SHADOW, isDark } = useTheme();

  // ★ 2026-06-13: ブランド確定グラデ (geekGradientFill / GEEK_GRADIENT_CSS) を使う。
  //   旧版は feed ヘッダー由来の「紫→水色→ミント」で水色が混ざっていたが、
  //   ブランド本来の "Geek" は 紫→ピンク (#7C6AF7→#B98CFF→#E891C7) で水色なし。
  //   dark = ブランドグラデ / light = フラットなチャコール (モノトーン)。
  const wordmarkStyle = isDark ? geekGradientFill() : { color: C.text };

  return (
    <View style={{ alignItems: 'center', marginTop: SP['2'] }}>
      <Text style={[T.caption, { color: C.text3, marginBottom: SP['3'], letterSpacing: 1 }]}>
        プレビュー
      </Text>

      {/* 端末フレーム */}
      <View
        style={[
          {
            width: 236,
            borderRadius: 32,
            backgroundColor: C.bg2,
            borderWidth: 1,
            borderColor: C.border,
            padding: 8,
          },
          SHADOW.card,
        ]}
      >
        {/* 画面 */}
        <View
          style={{
            borderRadius: 25,
            backgroundColor: C.bg,
            overflow: 'hidden',
            paddingTop: SP['2'],
            paddingHorizontal: SP['3'],
            paddingBottom: SP['2'],
            gap: SP['3'],
          }}
        >
          {/* ノッチ (dynamic island 風) */}
          <View
            style={{
              alignSelf: 'center',
              width: 52,
              height: 5,
              borderRadius: 3,
              backgroundColor: C.bg4,
              marginBottom: 1,
            }}
          />

          {/* ヘッダー: Geek ワードマーク (実アプリ同一グラデ) + 検索/通知 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Text
              style={[
                {
                  fontFamily: LOGO_FONT,
                  fontWeight: LOGO_FONT_WEIGHT,
                  fontSize: 16,
                  letterSpacing: -0.4,
                },
                wordmarkStyle,
              ]}
            >
              Geek
            </Text>
            <View style={{ flex: 1 }} />
            <Icon.search size={14} color={C.text3} strokeWidth={2.2} />
            <Icon.bell size={14} color={C.text3} strokeWidth={2.2} />
          </View>

          {/* スコープトグル — active pill は実 ScopeToggle と同じ GRAD.primary グラデ + 白文字 */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
              backgroundColor: C.bg3,
              borderRadius: 999,
              padding: 3,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <View style={{ flex: 1, borderRadius: 999, overflow: 'hidden' }}>
              <LinearGradient
                colors={[...GRAD.primary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ paddingVertical: 5, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>すべて</Text>
              </LinearGradient>
            </View>
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 5 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: C.text3 }}>未参加</Text>
            </View>
          </View>

          {/* 投稿カード */}
          <View
            style={{
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              padding: SP['2'] + 2,
              gap: 7,
            }}
          >
            {/* author 行 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.bg4 }} />
              <View style={{ gap: 3, flex: 1 }}>
                <View style={{ width: '52%', height: 6, borderRadius: 3, backgroundColor: C.text, opacity: 0.8 }} />
                <View style={{ width: '30%', height: 5, borderRadius: 3, backgroundColor: C.text4 }} />
              </View>
            </View>
            {/* 本文 2 行 */}
            <View style={{ gap: 4 }}>
              <View style={{ width: '92%', height: 5, borderRadius: 3, backgroundColor: C.text3, opacity: 0.5 }} />
              <View style={{ width: '64%', height: 5, borderRadius: 3, backgroundColor: C.text3, opacity: 0.5 }} />
            </View>
            {/* 画像 */}
            <View style={{ width: '100%', height: 56, borderRadius: 10, backgroundColor: C.bg3 }} />
            {/* アクション (本物アイコン) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['4'], marginTop: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon.heart size={13} color={C.text3} strokeWidth={2.2} />
                <Text style={{ fontSize: 11, color: C.text4, fontWeight: '700' }}>12</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon.comment size={13} color={C.text3} strokeWidth={2.2} />
                <Text style={{ fontSize: 11, color: C.text4, fontWeight: '700' }}>3</Text>
              </View>
              <View style={{ flex: 1 }} />
              <Icon.share size={13} color={C.text3} strokeWidth={2.2} />
              <Icon.save size={13} color={C.text3} strokeWidth={2.2} />
            </View>
          </View>

          {/* タブバー — home が active (アクセント) */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-around',
              alignItems: 'center',
              backgroundColor: C.bg2,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: C.border,
              paddingVertical: 7,
              marginTop: 1,
            }}
          >
            <Icon.home size={16} color={C.accent} strokeWidth={2.4} />
            <Icon.search size={16} color={C.text4} strokeWidth={2.2} />
            <Icon.community size={16} color={C.text4} strokeWidth={2.2} />
            <Icon.mypage size={16} color={C.text4} strokeWidth={2.2} />
          </View>
        </View>
      </View>
    </View>
  );
}
