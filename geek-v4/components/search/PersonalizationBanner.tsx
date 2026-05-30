// ============================================================
// components/search/PersonalizationBanner.tsx
// ------------------------------------------------------------
// 検索結果リストの上に出す、subtle なパーソナライズ告知バナー。
//
// 表示条件:
//   - useSearchPreferences().personalization_enabled === true のときのみ
//   - master が OFF なら null を返して何も表示しない
//
// インタラクション:
//   - tap で /settings/search-preferences へ navigate
//   - haptic は 'tap' (軽い)
//
// デザイン:
//   - 高さ控えめ (32-40pt)
//   - subtle accent-soft background (背景に溶ける紫薄)
//   - dark mode 完全対応 (design/tokens.ts の C のみ使用)
//   - Reanimated 3 の FadeIn で初回フェードイン (うるさくない)
// ============================================================

import { Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { PressableScale } from '../ui/PressableScale';
import { useSearchPreferences } from '../../hooks/useSearchPreferences';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

export type PersonalizationBannerProps = {
  /**
   * バナーをまったく出したくない呼び出し側のための隠しフラグ。
   * 既定では preferences.personalization_enabled が判定する。
   */
  hidden?: boolean;
};

export function PersonalizationBanner({ hidden }: PersonalizationBannerProps) {
  const router = useRouter();
  const { preferences } = useSearchPreferences();

  // hidden または master OFF なら何も描画しない (フィード上の余白も発生させない)
  if (hidden) return null;
  if (!preferences.personalization_enabled) return null;

  const goToSettings = () => {
    router.push('/settings/search-preferences' as never);
  };

  return (
    <Animated.View entering={FadeIn.duration(200)}>
      <PressableScale
        onPress={goToSettings}
        haptic="tap"
        accessibilityRole="link"
        accessibilityLabel="検索のパーソナライズ設定を開く"
        scaleValue={0.98}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          height: 36,
          paddingHorizontal: SP['3'],
          backgroundColor: C.accentSoft,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: C.accent + '33',
        }}
      >
        <Icon.sparkles size={14} color={C.accentLight} strokeWidth={2.2} />
        <Text style={[T.caption, { color: C.text2, flex: 1 }]}>
          <Text style={{ color: C.text, fontWeight: '700' }}>
            あなた向けに最適化されています
          </Text>
          <Text style={{ color: C.text3 }}>{' · '}</Text>
          <Text style={{ color: C.accentLight, fontWeight: '700' }}>設定</Text>
        </Text>
        <Icon.chevronR size={14} color={C.accentLight} strokeWidth={2.2} />
      </PressableScale>
    </Animated.View>
  );
}
