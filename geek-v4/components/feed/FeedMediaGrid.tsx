// ============================================================
// components/feed/FeedMediaGrid.tsx
// ============================================================
// フィードの「複数画像」表示グリッド (X / Instagram / Reddit 流)。
// 縦積みだと縦長になり「コンパクトでない」ため、2〜4 枚をグリッドに敷き詰め、
// 各セルは cover でセンタークロップ。各セルタップで該当 index のライトボックス。
// 5 枚以上は 4 セル目に「+N」オーバーレイ (タップで 4 枚目を開く)。
//
// レイアウト (X 互換):
//   2 枚 = 横 2 分割 (正方形)        → 全体 2:1
//   3 枚 = 左に縦長 + 右に正方形×2   → 全体 ~1:1
//   4 枚 = 2×2 正方形               → 全体 ~1:1
//
// 設計判断:
//   - 角丸は外周のみ (overflow:hidden)。セル間は 2px gap で card 背景が覗く X 風。
//   - 幅は onLayout で実測 (FlashList recycled セルでも 1 回測れば state 保持され
//     再 measure しない)。未測定の間は概算 aspectRatio のプレースホルダで高さ予約
//     (レイアウトジャンプ / 0 高さ潰れ防止)。
//   - 純 presentational。fetch/nav は持たず onPress(index) に委譲。
// ============================================================

import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { C } from '../../design/tokens';
import { ProgressiveImage } from '../ui/ProgressiveImage';

const GAP = 2;
const RADIUS = 16;

export interface FeedMediaItem {
  uri: string;
  blurhash?: string | null;
}

export function FeedMediaGrid({
  items,
  onPress,
}: {
  items: FeedMediaItem[];
  onPress: (index: number) => void;
}): JSX.Element | null {
  const [w, setW] = useState(0);

  if (items.length < 2) return null;
  const visible = items.slice(0, 4);
  const extra = items.length - 4; // >0 → 4 枚目に +N
  const count = visible.length;
  const half = Math.floor((w - GAP) / 2);

  return (
    <View
      style={{ width: '100%', borderRadius: RADIUS, overflow: 'hidden', backgroundColor: C.bg2 }}
      onLayout={(e) => {
        const lw = e.nativeEvent.layout.width;
        if (lw > 0 && Math.abs(lw - w) > 0.5) setW(lw);
      }}
    >
      {w <= 0 ? (
        // 実測前: 概算アスペクトで高さ予約 (2 枚=2:1 / それ以外 ~1:1)
        <View style={{ width: '100%', aspectRatio: count === 2 ? 2 : 1 }} />
      ) : count === 2 ? (
        <View style={{ flexDirection: 'row', gap: GAP }}>
          <Tile item={visible[0]!} w={half} h={half} onPress={() => onPress(0)} />
          <Tile item={visible[1]!} w={half} h={half} onPress={() => onPress(1)} />
        </View>
      ) : count === 3 ? (
        <View style={{ flexDirection: 'row', gap: GAP }}>
          <Tile item={visible[0]!} w={half} h={half * 2 + GAP} onPress={() => onPress(0)} />
          <View style={{ gap: GAP }}>
            <Tile item={visible[1]!} w={half} h={half} onPress={() => onPress(1)} />
            <Tile item={visible[2]!} w={half} h={half} onPress={() => onPress(2)} />
          </View>
        </View>
      ) : (
        <View style={{ gap: GAP }}>
          <View style={{ flexDirection: 'row', gap: GAP }}>
            <Tile item={visible[0]!} w={half} h={half} onPress={() => onPress(0)} />
            <Tile item={visible[1]!} w={half} h={half} onPress={() => onPress(1)} />
          </View>
          <View style={{ flexDirection: 'row', gap: GAP }}>
            <Tile item={visible[2]!} w={half} h={half} onPress={() => onPress(2)} />
            <Tile
              item={visible[3]!}
              w={half}
              h={half}
              onPress={() => onPress(3)}
              overlayCount={extra > 0 ? extra : undefined}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function Tile({
  item,
  w,
  h,
  onPress,
  overlayCount,
}: {
  item: FeedMediaItem;
  w: number;
  h: number;
  onPress: () => void;
  overlayCount?: number;
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={{ width: w, height: h }}
      accessibilityRole="imagebutton"
      accessibilityLabel="画像を拡大表示"
    >
      <ProgressiveImage
        uri={item.uri}
        blurhash={item.blurhash ?? undefined}
        width={w}
        height={h}
        radius={0}
        contentFit="cover"
        lazy
        thumbWidth={Math.min(720, Math.round(w * 2))}
        priority="high"
      />
      {overlayCount != null && overlayCount > 0 && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>+{overlayCount}</Text>
        </View>
      )}
    </Pressable>
  );
}
