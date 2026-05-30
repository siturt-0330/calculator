// ============================================================
// FormatToolbar — キーボード上に浮かぶリッチテキスト整形バー (Reddit 風)
// ------------------------------------------------------------
// 役割: 太字 / 斜体 / 取り消し線 / リンク / 箇条書き / 番号付き / 引用 /
//       コード の「整形 intent」を onInsert(kind) で親に EMIT するだけの
//       純 presentational バー。markdown の実挿入 (caret 位置への適用) は
//       親の責務 — このコンポーネントは text を一切触らない。
//
// 設計:
//   - 角丸 (R.xl) の floating container。bg は C.bg2、上端に hairline
//     divider を 1 本敷き、SHADOW.card でキーボード上に浮いて見せる。
//   - 横一列の 40px square な icon ボタン群。狭い画面で溢れる場合に備え
//     横 ScrollView で包む (showsHorizontalScrollIndicator={false})。
//   - B/i/S グループと list/quote/code グループの間に細い縦 divider
//     (C.divider) を挟んで視覚的にグルーピングする。
//   - 各ボタンは PressableScale + haptic="tap" (= hap.tap 相当を press-in
//     で即発火) で tactile な押し心地。icon 色は C.text2。
//   - visible=false のときは null を返す (描画しない)。
// ============================================================

import { ScrollView, View } from 'react-native';
import {
  Bold,
  Italic,
  Strikethrough,
  Link,
  List,
  ListOrdered,
  Quote,
  Code,
  type LucideIcon,
} from 'lucide-react-native';
import { useColors } from '../../../hooks/useColors';
import { SP, R, SHADOW } from '../../../design/tokens';
import { PressableScale } from '../../ui/PressableScale';

// 親に EMIT する整形 intent の種別。
export type FormatKind =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'link'
  | 'list'
  | 'orderedList'
  | 'quote'
  | 'code';

export interface FormatToolbarProps {
  /** ボタン押下で対応する整形 intent を親へ通知する。markdown 挿入は親が行う。 */
  onInsert: (kind: FormatKind) => void;
  /** false のとき null を描画。default true。 */
  visible?: boolean;
}

// ボタン 1 つ分の定義。group はグループ間の縦 divider 判定に使う。
type ToolbarItem = {
  kind: FormatKind;
  Glyph: LucideIcon;
  label: string;
  group: 'inline' | 'block';
};

// 表示順 (Bold → Code)。group が切り替わる境界に縦 divider を入れる。
const ITEMS: readonly ToolbarItem[] = [
  { kind: 'bold', Glyph: Bold, label: '太字', group: 'inline' },
  { kind: 'italic', Glyph: Italic, label: '斜体', group: 'inline' },
  { kind: 'strike', Glyph: Strikethrough, label: '取り消し線', group: 'inline' },
  { kind: 'link', Glyph: Link, label: 'リンク', group: 'inline' },
  { kind: 'list', Glyph: List, label: '箇条書き', group: 'block' },
  { kind: 'orderedList', Glyph: ListOrdered, label: '番号付きリスト', group: 'block' },
  { kind: 'quote', Glyph: Quote, label: '引用', group: 'block' },
  { kind: 'code', Glyph: Code, label: 'コード', group: 'block' },
] as const;

// icon ボタンの 1 辺。タッチターゲット下限 (44) に近い 40 で compact に。
const BTN_SIZE = 40;

export function FormatToolbar({ onInsert, visible = true }: FormatToolbarProps) {
  const C = useColors();

  if (!visible) return null;

  return (
    <View
      style={[
        {
          backgroundColor: C.bg2,
          borderRadius: R.xl,
          // 上端の hairline — floating バーの「縁」を 1px で表現。
          borderTopWidth: 1,
          borderTopColor: C.glassBorder,
          overflow: 'hidden',
        },
        SHADOW.card,
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['2'],
          paddingVertical: SP['1'],
          gap: SP['1'],
        }}
      >
        {ITEMS.map((item, i) => {
          // 直前の item と group が変わる境界に縦 divider を入れる
          // (inline ↔ block の区切り)。
          const prev = ITEMS[i - 1];
          const showDivider = prev !== undefined && prev.group !== item.group;
          const { Glyph } = item;

          return (
            <View
              key={item.kind}
              style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}
            >
              {showDivider ? (
                <View
                  style={{
                    width: 1,
                    height: BTN_SIZE - SP['4'],
                    backgroundColor: C.divider,
                    marginHorizontal: SP['1'],
                    borderRadius: R.full,
                  }}
                />
              ) : null}

              <PressableScale
                onPress={() => onInsert(item.kind)}
                haptic="tap"
                accessibilityLabel={item.label}
                accessibilityRole="button"
                style={{
                  width: BTN_SIZE,
                  height: BTN_SIZE,
                  borderRadius: R.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Glyph size={20} color={C.text2} strokeWidth={2} />
              </PressableScale>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
