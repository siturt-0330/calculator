// ============================================================
// components/feed/FeedMediaGrid.tsx
// ============================================================
// フィード / 投稿詳細 / マイページ 共通の「複数画像」表示 — Threads 流の
// 【横スクロール・カルーセル】。各写真は固定高さ H で 幅=H×アスペクトにして
// 「写真全体」をそのまま見せる (cover でズーム/クロップしない)。横長は広く・縦長は
// 細く並び、画面外は横スクロールで覗ける。各セルをタップで該当 index のコールバック。
//
// aspect は呼び出し側が計測済みなら渡す (feed/詳細 = ちらつき無し)。未指定なら
// Image.getSize で自前計測する (マイページ等、事前計測が無い経路向け)。
// contentFit='contain': セル枠 (H×アスペクト) は基本 画像比と一致 = 等倍全体表示。
// ============================================================

import { useState, useEffect } from 'react';
import { ScrollView, Pressable, useWindowDimensions, Platform, Image as RNImage } from 'react-native';
import { C, SP } from '../../design/tokens';
import { ProgressiveImage } from '../ui/ProgressiveImage';

const GAP = 6;
const RADIUS = 14;

// 1 枚あたりの許容アスペクト (幅/高さ)。極端比で 1 枚が画面を食う/細すぎるのを防ぐガード。
const MIN_A = 0.6;
const MAX_A = 1.9;
function clampAspect(a: number): number {
  if (!a || !Number.isFinite(a) || a <= 0) return 1;
  return Math.min(MAX_A, Math.max(MIN_A, a));
}

export interface FeedMediaItem {
  uri: string;
  blurhash?: string | null;
  aspect?: number; // width/height。未指定なら自前計測 (計測前は 1=正方 で仮置き)。
}

export function FeedMediaGrid({
  items,
  onPress,
}: {
  items: FeedMediaItem[];
  onPress: (index: number) => void;
}): JSX.Element | null {
  const { width: winW } = useWindowDimensions();
  const [measured, setMeasured] = useState<Record<string, number>>({});

  // aspect 未指定の item は実寸を計測 (一度測れば measured に保持し再計測しない)。
  useEffect(() => {
    let alive = true;
    for (const it of items) {
      if (it.aspect == null && measured[it.uri] == null) {
        RNImage.getSize(
          it.uri,
          (w, h) => {
            if (alive && w > 0 && h > 0) {
              setMeasured((m) => (m[it.uri] != null ? m : { ...m, [it.uri]: w / h }));
            }
          },
          () => {},
        );
      }
    }
    return () => {
      alive = false;
    };
  }, [items, measured]);

  if (items.length === 0) return null;

  // コンパクトな固定高さ。Threads 体感に寄せて画面幅×0.58、上限 320/300・下限 180。
  const cap = Platform.OS === 'web' ? 320 : 300;
  const H = Math.round(Math.min(cap, Math.max(180, Math.min(winW, 600) * 0.58)));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: GAP, paddingRight: SP['1'] }}>
      {items.map((it, i) => {
        const a = it.aspect ?? measured[it.uri] ?? 1;
        const w = Math.round(H * clampAspect(a));
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
