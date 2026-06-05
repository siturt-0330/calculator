// ============================================================
// SectionPillar — 号数メタの「柱(はしら)」(エディトリアル誌面)
// ------------------------------------------------------------
// マイページ各タブ(投稿 / コメント / 保存済み)の先頭に置く、
// 誌面の見出し=「号数ラベルの柱」。『投稿 — 12編』の体裁で
// セクション名と件数を一行に組み、直下に hairline 罫を 1 本。
//
// 設計意図(Atelier 改):
//   - 件数はこの柱でのみ見せる(タブラベルからは出さない)。
//     → 「タブは件数を隠すのに柱は出す」一貫性の継ぎ目を消す役割分担。
//   - 数字(count)は必ず Inter(T.num)。日本語フォントの数字は
//     baseline がガタつき安く見えるため、label/unit の NotoSansJP と
//     混植しても数字だけは Inter で組む(tokenUsage の鉄則)。
//   - 箱を持たない誌面性は「罫(hairline)・余白・タイポの格」で出す。
//     カード地・影は持たない純表示部品。
//
// 寸法(postsSpec / tokenUsage 準拠):
//   paddingHorizontal SP4(16) / marginTop SP4(16)
//   row: label=T.h4(16) C.text ls-0.2 + 半角スペース + 『—』 +
//        count=T.num(Inter) C.text3 + unit=T.h4 C.text3
//   下に View height1 backgroundColor C.divider marginTop SP3(12)
// ============================================================
import { View, Text, StyleSheet } from 'react-native';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';

interface SectionPillarProps {
  /** セクション名(例: '投稿' / 'コメント' / '保存済み')。T.h4 C.text */
  label: string;
  /** 件数。Inter(T.num) C.text3 で組む(日本語フォントの数字は安く見えるため) */
  count: number;
  /** 件数の単位(例: '編' / '件')。T.h4 C.text3 */
  unit: string;
}

/**
 * 誌面の見出し罫付き「柱」。
 *
 * 『{label} — {count}{unit}』を baseline 揃えで一行に組み、
 * 直下に C.divider の 1px 罫を引く。
 * テーマ追従は render 時の C 参照で自動(worklet なし=色直参照で安全)。
 */
export function SectionPillar({ label, count, unit }: SectionPillarProps) {
  return (
    <View style={styles.container}>
      {/* 一行の見出し: label — count unit。混植フォントを baseline で揃える */}
      <Text
        style={styles.line}
        numberOfLines={1}
        // スクリーンリーダーには『投稿 — 12 編』と自然に読ませる
        accessibilityRole="header"
        accessibilityLabel={`${label} — ${count}${unit}`}
      >
        {/* label: 記事見出し(NotoSansJP Bold 16) */}
        <Text style={styles.label}>{label}</Text>
        {/* 半角スペース + em-dash + 半角スペース(誌面のセパレータ) */}
        <Text style={styles.dash}> — </Text>
        {/* count: 必ず Inter(T.num)。従の階調 C.text3 */}
        <Text style={styles.count}>{count}</Text>
        {/* unit: 見出しと同書体だが従の階調 C.text3 */}
        <Text style={styles.unit}>{unit}</Text>
      </Text>

      {/* 誌面の見出し罫(hairline) — 影でなく 1px の線で「号」を区切る */}
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SP['4'],
    marginTop: SP['4'],
  },
  // 混植(label/unit=NotoSansJP, count=Inter)を baseline で揃える
  line: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  label: {
    ...T.h4,
    color: C.text,
    letterSpacing: -0.2,
  },
  // セパレータも見出し色で(『—』は記事の節記号)
  dash: {
    ...T.h4,
    color: C.text,
    letterSpacing: -0.2,
  },
  // 数字は Inter(T.num)。従の階調で件数を控えめに見せる
  count: {
    ...T.num,
    color: C.text3,
  },
  // 単位は見出し書体・従の階調
  unit: {
    ...T.h4,
    color: C.text3,
  },
  // 見出し罫(誌面の「号」区切り)
  rule: {
    height: 1,
    backgroundColor: C.divider,
    marginTop: SP['3'],
  },
});
