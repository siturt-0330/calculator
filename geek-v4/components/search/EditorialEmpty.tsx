// ============================================================
// EditorialEmpty — EDITORIAL「特集」検索タブの結果ゼロ状態
// ------------------------------------------------------------
// 役割: 結果ゼロ = 白紙の見開き。落胆を煽らず「次の一手」だけを示す。
//   - 装飾円・大イラスト無し。色は補正リンク (didYouMean) の accent のみ。
//   - 見出し「該当なし」は日本語なので Syne ではなく NotoSansJP_700Bold
//     (FONT.jpB) を使う (Syne は CJK 非対応)。
//   - didYouMean が null のときは「もしかして」を一切出さない (誤誘導回避)。
//   - 本文の query 部分は HighlightedText を使わず素の Text 連結で
//     C.text2 に色付けして軽く強調する。
//   - 下部は罫線リンク 2 つ (検索をクリア / 特集を見る)。
// レイアウト: 左揃え・上寄せ。paddingTop SP[10] / 左右 SP[5] / gap SP[4]。
// 入場は FadeIn 300ms のみ (静かな白紙)。
// ============================================================
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { C, SP } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';

type EditorialEmptyProps = {
  /** 検索クエリ (本文に「『{query}』の特集はまだありません。」と表示) */
  query: string;
  /** 表記揺れ補正候補。null のときは「もしかして」を出さない (誤誘導回避) */
  didYouMean: string | null;
  /** 補正候補タップ時 (その語で再検索) */
  onPickSuggestion: (q: string) => void;
  /** 「検索をクリア」タップ時 */
  onClear: () => void;
  /** 「特集を見る」タップ時 (Discovery 導線へ) */
  onBrowse: () => void;
};

export function EditorialEmpty({
  query,
  didYouMean,
  onPickSuggestion,
  onClear,
  onBrowse,
}: EditorialEmptyProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={{
        paddingTop: SP['10'],
        paddingHorizontal: SP['5'],
        gap: SP['4'],
        // 左揃え・上寄せ。装飾は置かない。
        alignItems: 'flex-start',
      }}
    >
      {/* 見出し「該当なし」 — 日本語なので FONT.jpB (Syne は CJK 非対応) */}
      <Text style={[T.display, { fontFamily: FONT.jpB, color: C.text2 }]}>
        該当なし
      </Text>

      {/* 本文 — query 部分のみ C.text2 で軽く強調 (HighlightedText 不使用) */}
      <Text style={[T.body, { color: C.text3 }]}>
        <Text style={{ color: C.text2 }}>{`『${query}』`}</Text>
        の特集はまだありません。
      </Text>

      {/* もしかして補正 — didYouMean が非 null のときだけ。null なら誤誘導回避で非表示 */}
      {didYouMean !== null ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: SP['2'],
          }}
        >
          <Text style={[T.smallM, { color: C.text3 }]}>もしかして:</Text>
          <PressableScale
            onPress={() => onPickSuggestion(didYouMean)}
            haptic="confirm"
            accessibilityRole="link"
            accessibilityLabel={`${didYouMean} で検索`}
            style={{ alignItems: 'flex-start' }}
          >
            <Text style={[T.h4, { color: C.accent }]}>{didYouMean}</Text>
            {/* accent 下線 — 文字幅に合わせる (alignSelf flex-start) */}
            <View
              style={{
                alignSelf: 'flex-start',
                height: 2,
                width: '100%',
                backgroundColor: C.accent,
                borderRadius: 1,
                marginTop: 2,
              }}
            />
          </PressableScale>
        </View>
      ) : null}

      {/* 下部: 罫線リンク 2 つ (縦 gap SP[3]) — 検索をクリア / 特集を見る */}
      <View style={{ alignSelf: 'stretch', gap: SP['3'], marginTop: SP['2'] }}>
        <PressableScale
          onPress={onClear}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel="検索をクリア"
          style={styles.linkRow}
        >
          <Icon.close size={16} color={C.text2} strokeWidth={2.2} />
          <Text style={[T.smallM, { color: C.text2 }]}>検索をクリア</Text>
        </PressableScale>

        <PressableScale
          onPress={onBrowse}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel="特集を見る"
          style={styles.linkRow}
        >
          <Icon.corners size={16} color={C.text2} strokeWidth={2.2} />
          <Text style={[T.smallM, { color: C.text2 }]}>特集を見る</Text>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // 各リンク: 横並び gap SP[2] / paddingVertical SP[3] / 上 hairline 罫線
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['2'],
    paddingVertical: SP['3'],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.divider,
  },
});
