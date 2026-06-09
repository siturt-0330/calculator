// ============================================================
// components/feed/FeedMediaGrid.tsx
// ============================================================
// フィードの「複数画像」表示 — Threads 流の【横スクロール・カルーセル】。
// 各写真は固定の高さ H で、幅 = H×アスペクトにして「写真全体」をそのまま見せる
// (cover でズーム/クロップしない = 「拡大して意味不明」を回避)。横長は広く・縦長は
// 細く並び、画面外は横スクロールで覗ける。各セルをタップで該当 index のライトボックス。
//
// 設計判断:
//   - contentFit='contain': セル枠 (H×アスペクト) は基本的に画像比と一致するので
//     等倍 = 全体表示。極端比のみ clampAspect で枠を丸め、はみ出しは bg2 で letterbox
//     (それでもズームはしない)。
//   - 高さ H は画面幅依存のコンパクト値 (Threads 体感に合わせ ~画面幅×0.58, 上限あり)。
//   - 純 presentational。fetch/nav は持たず onPress(index) に委譲。
// ============================================================

import { ScrollView, Pressable, useWindowDimensions, Platform } from 'react-native';
import { C, SP } from '../../design/tokens';
import { ProgressiveImage } from '../ui/ProgressiveImage';

const GAP = 6;
const RADIUS = 14;

// 1 枚あたりの許容アスペクト (幅/高さ)。極端な横長/縦長で 1 枚が画面を食い尽くす/
// 細すぎるのを防ぐためだけのガード (通常範囲の写真は素の比で全体表示)。
const MIN_A = 0.6; // これより縦長 → 枠を 0.6 にして letterbox
const MAX_A = 1.9; // これより横長 → 枠を 1.9 にして letterbox
function clampAspect(a: number): number {
  if (!a || !Number.isFinite(a) || a <= 0) return 1;
  return Math.min(MAX_A, Math.max(MIN_A, a));
}

export interface FeedMediaItem {
  uri: string;
  blurhash?: string | null;
  aspect?: number; // width/height (計測済み)。未計測時は 1 (正方) で仮置き。
}

export function FeedMediaGrid({
  items,
  onPress,
}: {
  items: FeedMediaItem[];
  onPress: (index: number) => void;
}): JSX.Element | null {
  const { width: winW } = useWindowDimensions();
  if (items.length === 0) return null;

  // コンパクトな固定高さ。Threads 体感に寄せて画面幅×0.58、上限 320 / 下限 180。
  const cap = Platform.OS === 'web' ? 320 : 300;
  const H = Math.round(Math.min(cap, Math.max(180, Math.min(winW, 600) * 0.58)));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: GAP, paddingRight: SP['1'] }}
      // 縦 FlashList 内の横スクロール。端で次の写真が覗く = スクロール可能の合図。
    >
      {items.map((it, i) => {
        const w = Math.round(H * clampAspect(it.aspect ?? 1));
        return (
          <Pressable
            key={`${it.uri}-${i}`}
            onPress={() => onPress(i)}
            style={{ width: w, height: H, borderRadius: RADIUS, overflow: 'hidden', backgroundColor: C.bg2 }}
            accessibilityRole="imagebutton"
            accessibilityLabel={`画像 ${i + 1} を拡大表示`}
          >
            <ProgressiveImage
              uri={it.uri}
              blurhash={it.blurhash ?? undefined}
              width={w}
              height={H}
              radius={RADIUS}
              contentFit="contain"
              lazy
              thumbWidth={Math.min(720, Math.round(w * 2))}
              priority="high"
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
