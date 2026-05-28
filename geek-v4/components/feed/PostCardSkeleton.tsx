import { View } from 'react-native';
import { SkeletonBox } from '../ui/SkeletonBox';
import { useColors } from '../../hooks/useColors';
import { R, SP } from '../../design/tokens';

// ============================================================
// PostCardSkeleton — フィード投稿カードの読み込み中表示
// ------------------------------------------------------------
// shimmer 付き SkeletonBox で構築。layout は実カード (AnonPostCard) と
// 視覚的に揃え、loading → mount で大きく gap が動かないようにする。
//
// 構成:
//   1. header: 24 avatar + name + meta + 三点
//   2. 本文 3 行 (90% / 70% / 50% 幅)
//   3. 画像プレース (アスペクト 1.5:1, 220 高)
//   4. tag pills 3 個 (60x22)
//   5. action row (4 icon + counts)
//
// 既存 estimatedItemSize に大きく影響しないよう、合計高さは
//   header(24) + gap + body(16*3 + gap*2) + image(220) + tags(22) + actions(20)
//   ≈ 24 + 12 + 56 + 12 + 220 + 12 + 22 + 12 + 20 + padding(32) ≈ 422
// 旧 (header + body 3 + actions ≈ 24 + 16*3 + 20 + padding+gap ≈ 150-180) より
// 縦に長くなる。FlashList の estimatedItemSize は実カードベース (350-450) に
// もともと合わせてあるので、こちらの方が visual jump が少ない。
// ============================================================

export function PostCardSkeleton() {
  const C = useColors();
  return (
    <View style={{
      backgroundColor: C.bg2,
      marginHorizontal: SP['3'],
      marginBottom: SP['4'],
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: SP['4'],
      gap: SP['3'],
    }}>
      {/* 1. header — avatar + 2 line meta (name / meta) + 三点メニュー */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <SkeletonBox width={40} height={40} borderRadius={9999} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonBox width={120} height={14} borderRadius={R.sm} />
          <SkeletonBox width={70} height={11} borderRadius={R.sm} />
        </View>
        <SkeletonBox width={20} height={20} borderRadius={9999} />
      </View>

      {/* 2. 本文 3 行 (90% / 70% / 50%) */}
      <View style={{ gap: SP['2'] }}>
        <SkeletonBox width="90%" height={14} borderRadius={R.sm} />
        <SkeletonBox width="70%" height={14} borderRadius={R.sm} />
        <SkeletonBox width="50%" height={14} borderRadius={R.sm} />
      </View>

      {/* 3. 画像プレース (アスペクト 1.5:1 = 横長, 220 高) */}
      <SkeletonBox width="100%" height={220} borderRadius={R.md} />

      {/* 4. tag pills 3 個 (60x22) */}
      <View style={{ flexDirection: 'row', gap: SP['2'], marginTop: SP['1'] }}>
        <SkeletonBox width={60} height={22} borderRadius={9999} />
        <SkeletonBox width={72} height={22} borderRadius={9999} />
        <SkeletonBox width={56} height={22} borderRadius={9999} />
      </View>

      {/* 5. action row — 4 icon + counts */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['4'],
        marginTop: SP['2'],
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}>
          <SkeletonBox width={18} height={18} borderRadius={9999} />
          <SkeletonBox width={20} height={12} borderRadius={R.sm} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}>
          <SkeletonBox width={18} height={18} borderRadius={9999} />
          <SkeletonBox width={20} height={12} borderRadius={R.sm} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}>
          <SkeletonBox width={18} height={18} borderRadius={9999} />
          <SkeletonBox width={20} height={12} borderRadius={R.sm} />
        </View>
        <View style={{ flex: 1 }} />
        <SkeletonBox width={18} height={18} borderRadius={9999} />
      </View>
    </View>
  );
}
