import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

// ============================================================
// CommentSortToggle — 投稿詳細のコメントセクション header
// ------------------------------------------------------------
// 2 軸トグル: 'best' (= Reddit 風 Best score) / 'new' (= 時系列降順)。
//
// - default: 'best'。再ランクは呼出側 (lib/api/bbs.ts の sortCommentsByBest など)
//   で fetchComments の結果を client side に作用させる。
// - state は呼出 component が持つ。CommentSortToggle 自体は controlled。
// - BBS replies (= bbs_replies) は対象外。2ch 風の時系列が体験上ベスト。
//   この toggle は post 詳細の comments のみで利用する想定。
// ============================================================

export type CommentSortMode = 'best' | 'new';

export function CommentSortToggle({
  value,
  onChange,
}: {
  value: CommentSortMode;
  onChange: (v: CommentSortMode) => void;
}) {
  const items: Array<{ v: CommentSortMode; label: string }> = [
    { v: 'best', label: 'Best' },
    { v: 'new', label: '新着順' },
  ];
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
      }}
      accessibilityRole="tablist"
      accessibilityLabel="コメントの並び順"
    >
      {items.map((it) => {
        const active = value === it.v;
        return (
          <PressableScale
            key={it.v}
            onPress={() => onChange(it.v)}
            haptic="select"
            hitSlop={6}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${it.label}${active ? ' (選択中)' : ''}`}
            style={{
              paddingHorizontal: SP['3'],
              paddingVertical: 4,
              borderRadius: R.full,
              backgroundColor: active ? C.accent : C.bg3,
              borderWidth: 1,
              borderColor: active ? C.accent : C.border,
            }}
          >
            <Text
              style={[
                T.caption,
                {
                  color: active ? '#fff' : C.text2,
                  fontWeight: '700',
                },
              ]}
            >
              {it.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
