import { View, Platform } from 'react-native';
import { SkeletonBox } from '../ui/SkeletonBox';
import { useColors } from '../../hooks/useColors';
import { R, SP } from '../../design/tokens';

// ============================================================
// PostCardSkeleton — iOS-native な読み込み中表示
// ------------------------------------------------------------
// shimmer は SkeletonBox 側で per-box に走る (1.4s, ease-in-out)。
//   - 旧: 角 R.lg (14)、padding SP['4'] (16)、border 1px。
//   - 新: AnonPostCard と同じ 14px 角・hairline border・18px padding。
//         iOS 標準 shadow (opacity 0.04 / radius 12 / offset y:2) を Web/iOS にだけ、
//         Android は elevation:1 で控えめに。
// ============================================================

export function PostCardSkeleton() {
  const C = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: C.bg2,
          marginHorizontal: SP['3'],
          marginBottom: SP['3'],
          borderRadius: 14,
          borderWidth: 1,
          borderColor: C.border,
          paddingHorizontal: 18,
          paddingTop: 18,
          paddingBottom: 14,
          gap: SP['3'],
        },
        Platform.select({
          ios: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.04,
            shadowRadius: 12,
          },
          web: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.04,
            shadowRadius: 12,
          },
          android: { elevation: 1 },
          default: {},
        }),
      ]}
    >
      {/* 1. header — avatar + 2 line meta (name / meta) + 三点メニュー */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <SkeletonBox width={40} height={40} borderRadius={20} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonBox width={120} height={13} borderRadius={R.sm} />
          <SkeletonBox width={80} height={11} borderRadius={R.sm} />
        </View>
        <SkeletonBox width={20} height={20} borderRadius={10} />
      </View>

      {/* 2. 本文 3 行 (92% / 78% / 54%) — iOS の読みやすさに寄せる */}
      <View style={{ gap: 7 }}>
        <SkeletonBox width="92%" height={14} borderRadius={R.sm} />
        <SkeletonBox width="78%" height={14} borderRadius={R.sm} />
        <SkeletonBox width="54%" height={14} borderRadius={R.sm} />
      </View>

      {/* 3. 画像プレース (アスペクト 1.5:1 = 横長, 220 高) — card と同じ 12px round */}
      <SkeletonBox width="100%" height={220} borderRadius={12} />

      {/* (4. tag pills skeleton は撤去 — feed カードで tag chip を表示しなくなったため) */}

      {/* 5. action row — 4 icon + counts */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['5'],
          marginTop: SP['2'],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SkeletonBox width={20} height={20} borderRadius={10} />
          <SkeletonBox width={20} height={12} borderRadius={R.sm} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SkeletonBox width={20} height={20} borderRadius={10} />
          <SkeletonBox width={20} height={12} borderRadius={R.sm} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SkeletonBox width={20} height={20} borderRadius={10} />
          <SkeletonBox width={20} height={12} borderRadius={R.sm} />
        </View>
        <View style={{ flex: 1 }} />
        <SkeletonBox width={18} height={18} borderRadius={9} />
      </View>
    </View>
  );
}
