// オンボーディング進捗インジケーター。
// Expo Router は `_` プレフィクス付きのファイルをルーティング対象から除外するため、
// 安全に同階層に置けるユーティリティとして配置している。
//
// 全ステップ: 1=language, 2=nickname, 3=liked-tags, 4=notifications
// (index は welcome なので "0" 扱い、進捗バーは表示しない)
// 注: 初回設定での「嫌いなタグ選択」ステップは廃止 (2026-05 ユーザー要望)。
//     ブロック機能自体は settings/blocked-tags から引き続き利用可能。
import { View, Text } from 'react-native';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export const TOTAL_STEPS = 4;

export function StepProgress({ step }: { step: number }) {
  // step は 1..TOTAL_STEPS の範囲を想定。範囲外なら描画しない。
  if (step < 1 || step > TOTAL_STEPS) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        // 戻るボタンと干渉しないよう右端寄せ
        alignSelf: 'flex-end',
      }}
      accessibilityRole="progressbar"
      accessibilityLabel={`ステップ ${step} / ${TOTAL_STEPS}`}
      accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: step }}
    >
      {/* 各ステップを 4 つのピル + ラベルで表現。
          現在ステップは accent、過去ステップは accentSoft、未来ステップは bg3。
          flex は使わず fixed width — top bar 内で他要素と衝突しない */}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
          const idx = i + 1;
          const past = idx < step;
          const current = idx === step;
          return (
            <View
              key={`step-${idx}`}
              style={{
                width: current ? 18 : 6,
                height: 6,
                borderRadius: R.full,
                backgroundColor: current ? C.accent : past ? C.accentLight : C.bg3,
                opacity: past ? 0.55 : 1,
              }}
            />
          );
        })}
      </View>
      <Text style={[T.caption, { color: C.text3, fontVariant: ['tabular-nums'] }]}>
        {step}/{TOTAL_STEPS}
      </Text>
    </View>
  );
}
