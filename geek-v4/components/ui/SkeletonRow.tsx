import { View } from 'react-native';
import { Skeleton } from './Skeleton';
import { SP, R } from '../../design/tokens';

export type SkeletonRowKind = 'avatar' | 'photo-tile' | 'list-item' | 'album-card';

export interface SkeletonRowProps {
  kind: SkeletonRowKind;
  /** 'list-item' / 'album-card' を複数 render するときに使う (default 1) */
  count?: number;
}

/**
 * 用途別 Skeleton テンプレ。Phase 2 UI Polish の各画面 (mypage, album, friends 等) の
 * loading 状態で ActivityIndicator の代わりに敷く。
 *
 * - avatar:      96x96 circle 1 個
 * - photo-tile:  1:1 正方形 (サイズは親に任せる. style aspectRatio=1)
 * - list-item:   row { 40x40 circle avatar + 縦 2 行 text skeleton }
 * - album-card:  row { 64x64 角丸 thumb + title + caption }
 */
export function SkeletonRow({ kind, count = 1 }: SkeletonRowProps) {
  const items = Array.from({ length: Math.max(1, count) }, (_, i) => i);

  if (kind === 'avatar') {
    return (
      <View>
        {items.map((i) => (
          <Skeleton key={`avatar-${i}`} width={96} height={96} borderRadius={9999} />
        ))}
      </View>
    );
  }

  if (kind === 'photo-tile') {
    // 親の幅に追従する正方形 (aspectRatio=1)。grid の cell として 1 個ずつ使う想定。
    // Skeleton 内部の View が `height: number` を期待するので、外側 View で
    // aspectRatio を作り、Skeleton は flex:1 で吸い込ませる。
    return (
      <View style={{ width: '100%' }}>
        {items.map((i) => (
          <View key={`photo-${i}`} style={{ width: '100%', aspectRatio: 1 }}>
            <Skeleton width="100%" borderRadius={R.md} style={{ flex: 1, height: undefined }} />
          </View>
        ))}
      </View>
    );
  }

  if (kind === 'list-item') {
    return (
      <View style={{ gap: SP['3'] }}>
        {items.map((i) => (
          <View
            key={`li-${i}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['3'],
              paddingVertical: SP['2'],
            }}
          >
            <Skeleton width={40} height={40} borderRadius={9999} />
            <View style={{ flex: 1, gap: SP['1'] }}>
              <Skeleton width="60%" height={14} borderRadius={R.sm} />
              <Skeleton width="40%" height={11} borderRadius={R.sm} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  // album-card
  return (
    <View style={{ gap: SP['3'] }}>
      {items.map((i) => (
        <View
          key={`ac-${i}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['3'],
            paddingVertical: SP['2'],
          }}
        >
          <Skeleton width={64} height={64} borderRadius={R.md} />
          <View style={{ flex: 1, gap: SP['1'] }}>
            <Skeleton width="70%" height={16} borderRadius={R.sm} />
            <Skeleton width="50%" height={12} borderRadius={R.sm} />
          </View>
        </View>
      ))}
    </View>
  );
}
