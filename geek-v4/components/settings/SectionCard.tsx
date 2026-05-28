import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { View, Text } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';

// ============================================================
// SectionCard
// ------------------------------------------------------------
// 設定画面 (app/settings/index.tsx) で使うセクション wrapper。
// ・タイトル行: ICON + TITLE (T.caption / uppercase / letterSpacing / C.text3)
//   小さく薄く、グループ見出しらしいトーンに統一。
// ・本体カード: backgroundColor = C.bg2 / borderRadius = R.lg / overflow:hidden
//   - 子要素 (ListItem 等) を放り込むと、自動で 1px C.divider の区切り線を間に挟む。
//   - 子要素自身の `border` prop は不要 — wrapper 側で「最後以外」に divider を出す。
// ・カード自体は左右に `marginHorizontal: SP['4']`、 上下に余白を入れる。
//   セクション間の余白がきれいに統一される。
//
// 使い方:
//   <SectionCard title="アカウント" icon={Icon.user}>
//     <ListItem ... />
//     <ListItem ... />
//   </SectionCard>
//
// 注意: ListItem 側を変更したくないので、子要素間に <View height=1 bg=C.divider /> を
// 挟むだけで「グループ感」を表現する。ListItem 自身の角丸は付かないが、
// SectionCard の overflow:hidden + borderRadius で外側 (上下端) は自然に丸まる。
// ============================================================

export function SectionCard({
  title,
  icon: I,
  children,
  accent,
}: {
  title?: string;
  icon?: LucideIcon;
  children: ReactNode;
  /** タイトルアイコンに色付け (デフォルトは C.text3) */
  accent?: string;
}) {
  const C = useColors();

  // children を配列化し、最後の要素以外の後ろに divider を挟む。
  // null / false の child は無視する (条件分岐 row を許可)。
  const items = Children.toArray(children).filter((c) => isValidElement(c));

  return (
    <View style={{ marginTop: SP['5'] }}>
      {title ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['2'],
            paddingHorizontal: SP['4'] + SP['2'], // カード本体より少しインデント
            marginBottom: SP['2'],
          }}
        >
          {I ? <I size={13} color={accent ?? C.text3} strokeWidth={2.2} /> : null}
          <Text
            style={[
              T.caption,
              {
                color: accent ?? C.text3,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                fontWeight: '700',
              },
            ]}
          >
            {title}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          marginHorizontal: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        }}
      >
        {items.map((child, i) => (
          <Fragment key={i}>
            {child}
            {i < items.length - 1 ? (
              <View
                style={{
                  height: 1,
                  marginLeft: SP['4'] + 32 + SP['3'], // icon 32 + gap 12 のぶん左を空ける
                  backgroundColor: C.divider,
                }}
              />
            ) : null}
          </Fragment>
        ))}
      </View>
    </View>
  );
}
