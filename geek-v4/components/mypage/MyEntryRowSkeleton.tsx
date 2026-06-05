// ============================================================
// MyEntryRowSkeleton — マイページ誌面行カードの layout 一致 skeleton
// ------------------------------------------------------------
// 設計意図（## emptyLoadingSpec 準拠）:
//   - spinner（ActivityIndicator）を全廃し、MyEntryRow と「寸法が完全一致」
//     する skeleton を出す。読み込み完了時に layout がガタつかず、
//     SkeletonBox の shimmer が「もうすぐ来る」期待感を作る。
//   - MyEntryRow(post/comment/saved) と同じコンテナ寸法:
//       padding SP4 / backgroundColor C.bg2（不透明）/ borderRadius R.lg /
//       borderWidth 1 / borderColor C.divider / 影なし（border 1px で浮き）。
//   - 中身は SkeletonBox（流用・無改修）のみ:
//       左  = 72x72 R.md（カード R.lg の内側は必ず1段小=同心角丸）
//       右  = 3本（タイトル '70%' h14 / 本文 '92%' h12 / メタ 88 h11）
//   - これは投稿/コメント/保存の3タブで共通の純表示部品。
//
// ★ skeleton は FlashList の data に流すと recycler と干渉するため、
//   ローディング中は ListHeader（ヒーロー）実体 + 本文領域にこの skeleton を
//   「非 FlashList の通常 View」で重ねて使う想定（件数固定=非仮想化で安全）。
//   そのため count で複数枚をまとめて縦並び（gap SP3）にできるようにする。
// ============================================================
import React from 'react';
import { View, ViewStyle } from 'react-native';
import { SkeletonBox } from '../ui/SkeletonBox';
import { C, SP, R } from '../../design/tokens';

// 左サムネは MyEntryRow の 72x72 と一致（カード R.lg の内側は R.md で同心）。
const THUMB = 72;

// 右側 3 本の寸法は emptyLoadingSpec のリテラル値をそのまま定数化。
//   1) タイトル:  width '70%' height 14
//   2) 本文:      width '92%' height 12  marginTop 6
//   3) メタ:      width 88    height 11  marginTop 10
const LINE_TITLE_MT = 0;
const LINE_BODY_MT = 6;
const LINE_META_MT = 10;

// コンテナ寸法（MyEntryRow と完全一致）。生成のたびに object を作らないよう外出し。
const cardStyle: ViewStyle = {
  flexDirection: 'row',
  gap: SP['3'], // 12 — 左サムネと右テキスト束の溝（MyEntryRow と同値）
  padding: SP['4'], // 16
  backgroundColor: C.bg2, // 不透明カード地（可読性 + タップ領域明示の代理）
  borderRadius: R.lg, // 14
  borderWidth: 1,
  borderColor: C.divider, // 1px hairline で浮き（影は付けない=濁り回避）
};

const rightColStyle: ViewStyle = {
  flex: 1,
  minWidth: 0, // テキスト束の overflow 縮小を許可（行カードと同挙動）
  justifyContent: 'center', // 3 本を縦中央寄せ（サムネ高 72 に対して上品に）
};

// 1 枚分の skeleton 行。複数枚は親で gap を付けて並べる。
function SkeletonRow() {
  return (
    <View style={cardStyle}>
      {/* 左サムネ — 72x72 R.md（同心角丸） */}
      <SkeletonBox width={THUMB} height={THUMB} borderRadius={R.md} />

      {/* 右 3 本 — タイトル / 本文 / メタ */}
      <View style={rightColStyle}>
        <SkeletonBox width="70%" height={14} style={{ marginTop: LINE_TITLE_MT }} />
        <SkeletonBox width="92%" height={12} style={{ marginTop: LINE_BODY_MT }} />
        <SkeletonBox width={88} height={11} style={{ marginTop: LINE_META_MT }} />
      </View>
    </View>
  );
}

export interface MyEntryRowSkeletonProps {
  /** 並べる枚数。既定 1。複数指定で gap SP3 の縦並びになる。 */
  count?: number;
}

/**
 * MyEntryRow と layout 一致の読み込み skeleton。
 * count を渡すと複数枚を gap SP3 で縦に並べる（既定 1 枚）。純表示。
 */
export function MyEntryRowSkeleton({ count = 1 }: MyEntryRowSkeletonProps = {}) {
  // count<=1 は単一行をそのまま返す（余計なラッパ View を作らない）。
  if (count <= 1) {
    return <SkeletonRow />;
  }

  // 複数枚は gap SP3（12）の縦並び。key は index 由来だが skeleton は
  // 静的・順不同入替なし・再利用なしの純飾りなので一意 id は不要
  // （FlashList の recycler 配下ではなく通常 View 内固定描画のため）。
  return (
    <View style={{ gap: SP['3'] }}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={`mypage-skeleton-${i}`} />
      ))}
    </View>
  );
}

export default MyEntryRowSkeleton;
