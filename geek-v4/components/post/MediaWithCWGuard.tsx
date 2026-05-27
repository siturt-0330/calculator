// ============================================================
// MediaWithCWGuard
// ============================================================
// CW (content warning) カテゴリ付き投稿の media を「タップして表示」
// 形式に変換するラッパ。
//
//   - cwCategory が null/undefined         → children を素通し
//   - 'spoiler' / 'nsfw' / 'violence'     → 初期 blurhash + CTA pill。
//                                            タップすると children を表示。
//   - 'sensitive'                          → label 表示のみ (ぼかし無し)
//
// 設計判断:
//   - revealed 状態は **component local**。再 mount (フィードを離れて
//     戻ってきた等) で reset され、毎回確認させる。これは UX 上の
//     「うっかり開示」を防ぐ。
//   - blurhash がある投稿は blurhash を decoded image として表示
//     (見た目はぼやけた色のブロブ)。無い投稿は単色のダーク bg2。
//   - children を render しないので、 reveal するまでネットワーク
//     ロード自体が走らない (帯域節約 + 万一の事故防止)。
//   - サイズ (aspectRatio) は親 (AnonPostCard の mediaItemBase) が
//     決めるので、本コンポーネントは absolute fill する形で重ねる。
// ============================================================

import { memo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { CWCategory } from '../../types/models';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { useT } from '../../lib/i18n';

type Props = {
  cwCategory: CWCategory | undefined | null;
  /** ぼかし表示時に使う placeholder の blurhash. 無くても OK (単色 bg) */
  blurhash?: string | null;
  /** 実 media. cwCategory が無い / sensitive / revealed なら出る */
  children: React.ReactNode;
};

function cwLabelKey(cw: 'spoiler' | 'nsfw' | 'violence' | 'sensitive'): string {
  switch (cw) {
    case 'spoiler': return 'ネタバレ';
    case 'nsfw': return 'センシティブな内容';
    case 'violence': return '暴力的描写';
    case 'sensitive': return '注意';
  }
}

function cwEmoji(cw: 'spoiler' | 'nsfw' | 'violence' | 'sensitive'): string {
  switch (cw) {
    case 'spoiler': return '🤐';
    case 'nsfw': return '🔞';
    case 'violence': return '⚠️';
    case 'sensitive': return '🛡️';
  }
}

function MediaWithCWGuardInner({ cwCategory, blurhash, children }: Props) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);

  // 1) CW 無し → 素通し
  if (!cwCategory) return <>{children}</>;

  // 2) sensitive はラベルのみ (画像はそのまま出す)。これは仕様。
  if (cwCategory === 'sensitive') return <>{children}</>;

  // 3) reveal 済みなら children を出す
  if (revealed) return <>{children}</>;

  // 4) 未 reveal — blurhash プレースホルダ + CTA pill
  const cw = cwCategory; // 型ナロウ済 ('spoiler' | 'nsfw' | 'violence')

  return (
    <View style={STYLES.wrap} accessibilityLabel={`${cwLabelKey(cw)} — タップして表示`}>
      {/* blurhash を decoded image として全面に敷く. 無ければ単色 bg2 */}
      {blurhash ? (
        <Image
          source={{ blurhash }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          // a11y: 装飾画像扱い
          accessible={false}
        />
      ) : null}
      {/* 視認性のためうっすら darken (blurhash の上に置く) */}
      <View style={STYLES.dim} pointerEvents="none" />
      {/* 中央 CTA — タップで reveal */}
      <PressableScale
        onPress={() => setRevealed(true)}
        haptic="tap"
        accessibilityRole="button"
        accessibilityLabel={`${cwLabelKey(cw)}: タップして表示`}
        style={STYLES.ctaWrap}
      >
        <View style={STYLES.pill}>
          <Text style={STYLES.emoji}>{cwEmoji(cw)}</Text>
          <View style={STYLES.pillTextCol}>
            <Text style={[T.smallM, STYLES.pillLabel]}>{t(cwLabelKey(cw))}</Text>
            <Text style={STYLES.pillCta}>{t('タップして表示')}</Text>
          </View>
        </View>
      </PressableScale>
    </View>
  );
}

const STYLES = StyleSheet.create({
  // 親 (mediaItemBase) は aspectRatio + borderRadius + overflow:hidden を
  // 持つので、本ラッパは flex:1 で fill するだけ。
  wrap: {
    width: '100%',
    height: '100%',
    backgroundColor: C.bg2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  ctaWrap: {
    // ピル全体を中央へ
    paddingHorizontal: SP['3'],
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['3'],
    paddingHorizontal: SP['4'],
    paddingVertical: SP['3'],
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: R.full,
    borderWidth: 1,
    borderColor: C.amber + '66',
    // iOS の最小 tap target を確保
    minHeight: 44,
  },
  emoji: { fontSize: 22 },
  pillTextCol: { flexDirection: 'column', alignItems: 'flex-start' },
  pillLabel: { color: C.amber, fontWeight: '700' },
  pillCta: { color: C.text, fontSize: 11, lineHeight: 14, marginTop: 1 },
});

export const MediaWithCWGuard = memo(MediaWithCWGuardInner);
