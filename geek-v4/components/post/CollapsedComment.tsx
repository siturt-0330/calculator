// ============================================================
// CollapsedComment — 連続する低品質コメントを折りたたみ chip 化する UI
// ------------------------------------------------------------
// Reddit ガイド 5.3 / 5.10 章の「低評価コメントは非表示ではなく折りたたみ」
// を体現する component。タップで展開し、children をそのまま render する。
//
// 使い方:
//   <CollapsedComment count={3}>
//     <CommentThreadItem ... />
//     <CommentThreadItem ... />
//     <CommentThreadItem ... />
//   </CollapsedComment>
//
// 見た目:
//   - 横長 chip: R.lg, SHADOW.xs, border 1px C.border
//   - 背景 C.bg3 (subtle, 目を引かない)
//   - 内容 text2 で "▼ N 件の低評価コメントを表示"
//   - PressableScale で軽い tap feedback
//   - 展開後 (expanded=true) は children をそのまま render し、上部に
//     「折りたたむ」chip を残してまた閉じられるようにする
// ============================================================

import { useState } from 'react';
import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';

export type CollapsedCommentProps = {
  /** 折りたたみ中のコメント数 (2 以上を想定) */
  count: number;
  /** 展開時に render される子 — 通常は <CommentThreadItem> のリスト */
  children?: React.ReactNode;
  /** 初期 expanded 状態 (default: false = 畳んでいる) */
  initiallyExpanded?: boolean;
};

export function CollapsedComment({
  count,
  children,
  initiallyExpanded = false,
}: CollapsedCommentProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  // chip 表示時のラベル — 「▼ N 件の低評価コメントを表示」/「▲ 折りたたむ」
  const label = expanded
    ? `▲ 折りたたむ`
    : `▼ ${count} 件の低評価コメントを表示`;

  const a11y = expanded
    ? `${count} 件の低評価コメントを折りたたむ`
    : `${count} 件の低評価コメントを表示`;

  return (
    <View style={{ width: '100%', marginVertical: 4 }}>
      <PressableScale
        onPress={() => setExpanded((s) => !s)}
        haptic="tap"
        hitSlop={6}
        accessibilityLabel={a11y}
        accessibilityState={{ expanded }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          paddingHorizontal: SP['3'],
          paddingVertical: SP['2'],
          backgroundColor: C.bg3,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          ...SHADOW.xs,
        }}
      >
        {/* 左の小さな縦バーで「グループ化された区画」感を出す */}
        <View
          style={{
            width: 3,
            height: 14,
            backgroundColor: C.text3,
            borderRadius: R.sm,
            opacity: 0.6,
          }}
        />
        <Text
          style={[
            T.smallM,
            { color: C.text2, fontWeight: '700', flex: 1 },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {!expanded && (
          <View
            style={{
              paddingHorizontal: SP['2'],
              paddingVertical: 2,
              backgroundColor: C.bg2,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Text
              style={[
                T.caption,
                { color: C.text3, fontWeight: '700' },
              ]}
            >
              {count}
            </Text>
          </View>
        )}
      </PressableScale>

      {/* 展開時のみ children を render */}
      {expanded && (
        <View
          style={{
            marginTop: 4,
            // 左の薄いガイドバーで「折りたたみグループの内側」を示す。
            // padding は children 側 (CommentThreadItem) に任せ、ここは外枠だけ。
            borderLeftWidth: 2,
            borderLeftColor: C.border,
            paddingLeft: SP['2'],
          }}
        >
          {children}
        </View>
      )}
    </View>
  );
}
