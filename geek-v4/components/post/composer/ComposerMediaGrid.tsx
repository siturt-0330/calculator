// ============================================================
// components/post/composer/ComposerMediaGrid.tsx
// ============================================================
// 投稿作成キャンバス用の「画像 + 動画」プレビュー grid。
// X (Twitter) / Instagram の添付メディアプレビューに寄せた、
// hero として成立する見た目の grid を目指す:
//   - 角丸 (R.lg) + 端正な gap
//   - 1〜4 枚で破綻しない比率 (1:large / 2:横並び / 3:左tall+右stack / 4:2x2)
//   - 各タイルの右上にクリスプな削除ボタン
//   - 各画像タイルの左上に「切り抜き・回転」編集ボタン (onEditImage 提供時のみ)
//   - FadeIn / FadeOut + Layout spring で滑らかな出入り
//
// 設計判断:
//   - 純 presentational。state は持たず、削除/編集は callback に委譲する。
//   - サイズは onLayout 実測幅から実ピクセルで算出し、ProgressiveImage に
//     number の width/height を渡す (`%` 指定だと Web で aspect が崩れやすい)。
//   - video は「追加の 1 タイル」として images と同じ列レイアウトに混ぜる。
//   - 編集ボタンはローカル URI (撮影/選択直後) のみ表示。https (編集モードの既存画像)
//     は CORS で canvas crop が tainted になり得るため出さない。
// ============================================================

import { useState } from 'react';
import { View, Text, Platform, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, Layout } from 'react-native-reanimated';
import { X as IconX, Crop } from 'lucide-react-native';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { PressableScale } from '../../ui/PressableScale';
import { ProgressiveImage } from '../../ui/ProgressiveImage';
import { Icon } from '../../../constants/icons';

// ============================================================
// 定数: gap / 角丸 / ボタン
// ============================================================
const GAP = SP['1']; // 4px — タイル間の端正な隙間
const TILE_RADIUS = R.lg; // 14
const OUTER_RADIUS = R.xl; // 20 — 外周だけ少し大きく取って "塊感" を出す
const REMOVE_SIZE = 26;
const PLAY_BADGE = 44;

// 編集ボタンを出してよい URI か (ローカルのみ; https の既存画像は除外)
const isLocalUri = (u: string): boolean => !/^https?:\/\//i.test(u);

// ============================================================
// Props
// ============================================================
export interface ComposerMediaGridProps {
  images: string[]; // 0..4 uris (local or https)
  video: { uri: string; sizeMb: number } | null; // optional single video
  // ★ index 同定: 同一 uri が重複しても対象 1 枚だけを操作する (値一致 map だと
  //   重複画像で「1 枚消す/編集すると無関係の同一画像も巻き込む」事故になる)。
  onRemoveImage: (index: number) => void;
  onRemoveVideo: () => void;
  /** 提供時、各ローカル画像タイルに「切り抜き・回転」編集ボタンを出す。index は images 配列の添字。 */
  onEditImage?: (index: number) => void;
  containerPaddingH?: number; // default 16 (SP['4']) — ページ左右 padding (幅計算に使う)
}

// 内部の「描画タイル」表現 — image か video の判別 union。
type Tile =
  | { kind: 'image'; uri: string; index: number }
  | { kind: 'video'; uri: string; sizeMb: number };

// 各レイアウト/タイルへ流す共通コールバック束 (prop drilling を 1 つにまとめる)。
interface TileCallbacks {
  onRemoveImage: (index: number) => void;
  onRemoveVideo: () => void;
  onEditImage?: (index: number) => void;
}

// ============================================================
// ComposerMediaGrid — 単一 export
// ============================================================
export function ComposerMediaGrid({
  images,
  video,
  onRemoveImage,
  onRemoveVideo,
  onEditImage,
  containerPaddingH = SP['4'],
}: ComposerMediaGridProps): JSX.Element | null {
  const { width: winW } = useWindowDimensions();
  const [measuredW, setMeasuredW] = useState(0);

  const allTiles: Tile[] = [
    ...images.map<Tile>((uri, i) => ({ kind: 'image', uri, index: i + 1 })),
    ...(video ? [{ kind: 'video', uri: video.uri, sizeMb: video.sizeMb } as Tile] : []),
  ];
  const tiles = allTiles.slice(0, 4);
  const count = tiles.length;

  if (count === 0) return null;

  const contentW = measuredW > 0 ? measuredW : Math.max(0, winW - 2 * containerPaddingH);
  const halfW = Math.floor((contentW - GAP) / 2);
  const multiIndex = images.length > 1;
  const cbs: TileCallbacks = { onRemoveImage, onRemoveVideo, onEditImage };

  return (
    <View
      style={{ width: '100%' }}
      onLayout={(e) => {
        const lw = e.nativeEvent.layout.width;
        if (lw > 0 && Math.abs(lw - measuredW) > 0.5) setMeasuredW(lw);
      }}
    >
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        layout={Layout.springify().damping(20)}
        style={{ width: contentW, borderRadius: OUTER_RADIUS, overflow: 'hidden', alignSelf: 'flex-start' }}
      >
        {count === 1 && <SingleLayout tile={tiles[0]!} width={contentW} multiIndex={multiIndex} cbs={cbs} />}

        {count === 2 && (
          <View style={{ flexDirection: 'row', gap: GAP }}>
            {tiles.map((tile) => (
              <MediaTile key={tile.kind === 'video' ? 'video' : `img-${tile.index}`} tile={tile} width={halfW} height={halfW} multiIndex={multiIndex} cbs={cbs} />
            ))}
          </View>
        )}

        {count === 3 && <ThreeLayout tiles={tiles} halfW={halfW} multiIndex={multiIndex} cbs={cbs} />}

        {count === 4 && <FourLayout tiles={tiles} halfW={halfW} multiIndex={multiIndex} cbs={cbs} />}
      </Animated.View>
    </View>
  );
}

// ============================================================
// SingleLayout — 1 枚: 横幅いっぱい・aspect 16:10 の大タイル
// ============================================================
function SingleLayout({
  tile,
  width,
  multiIndex,
  cbs,
}: {
  tile: Tile;
  width: number;
  multiIndex: boolean;
  cbs: TileCallbacks;
}): JSX.Element {
  const height = Math.round((width * 10) / 16); // ~16:10
  return <MediaTile tile={tile} width={width} height={height} multiIndex={multiIndex} cbs={cbs} />;
}

// ============================================================
// ThreeLayout — 左に full-height tall タイル + 右に square ×2 (縦積み)
// ============================================================
function ThreeLayout({
  tiles,
  halfW,
  multiIndex,
  cbs,
}: {
  tiles: Tile[];
  halfW: number;
  multiIndex: boolean;
  cbs: TileCallbacks;
}): JSX.Element {
  const fullH = halfW * 2 + GAP;
  const [left, rightTop, rightBottom] = tiles;
  return (
    <View style={{ flexDirection: 'row', gap: GAP }}>
      <MediaTile tile={left!} width={halfW} height={fullH} multiIndex={multiIndex} cbs={cbs} />
      <View style={{ gap: GAP }}>
        <MediaTile tile={rightTop!} width={halfW} height={halfW} multiIndex={multiIndex} cbs={cbs} />
        <MediaTile tile={rightBottom!} width={halfW} height={halfW} multiIndex={multiIndex} cbs={cbs} />
      </View>
    </View>
  );
}

// ============================================================
// FourLayout — 2×2 の square グリッド
// ============================================================
function FourLayout({
  tiles,
  halfW,
  multiIndex,
  cbs,
}: {
  tiles: Tile[];
  halfW: number;
  multiIndex: boolean;
  cbs: TileCallbacks;
}): JSX.Element {
  return (
    <View style={{ gap: GAP }}>
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {tiles.slice(0, 2).map((tile) => (
          <MediaTile key={tile.kind === 'video' ? 'video' : `img-${tile.index}`} tile={tile} width={halfW} height={halfW} multiIndex={multiIndex} cbs={cbs} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {tiles.slice(2, 4).map((tile) => (
          <MediaTile key={tile.kind === 'video' ? 'video' : `img-${tile.index}`} tile={tile} width={halfW} height={halfW} multiIndex={multiIndex} cbs={cbs} />
        ))}
      </View>
    </View>
  );
}

// ============================================================
// MediaTile — 1 タイル (画像 or 動画) + 右上削除 + 左上編集
// ============================================================
function MediaTile({
  tile,
  width,
  height,
  multiIndex,
  cbs,
}: {
  tile: Tile;
  width: number;
  height: number;
  multiIndex: boolean;
  cbs: TileCallbacks;
}): JSX.Element {
  const isVideo = tile.kind === 'video';
  const imageIndex = tile.kind === 'image' ? tile.index - 1 : -1; // images 配列の添字
  const canEdit = !isVideo && !!cbs.onEditImage && isLocalUri(tile.uri);

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={Layout.springify().damping(20)}
      style={{ width, height, borderRadius: TILE_RADIUS }}
    >
      {isVideo ? (
        <View style={{ width, height, borderRadius: TILE_RADIUS, backgroundColor: '#000', overflow: 'hidden' }}>
          <VideoPreview uri={tile.uri} width={width} height={height} />
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
          >
            <View
              style={{
                width: PLAY_BADGE,
                height: PLAY_BADGE,
                borderRadius: PLAY_BADGE / 2,
                backgroundColor: 'rgba(0,0,0,0.55)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.play size={22} color="#fff" />
            </View>
          </View>
          <View
            style={{
              position: 'absolute',
              bottom: 6,
              left: 6,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: R.full,
              backgroundColor: 'rgba(0,0,0,0.6)',
            }}
          >
            <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>{`${tile.sizeMb.toFixed(1)}MB`}</Text>
          </View>
        </View>
      ) : (
        <View style={{ borderRadius: TILE_RADIUS, overflow: 'hidden' }}>
          <ProgressiveImage uri={tile.uri} width={width} height={height} radius={TILE_RADIUS} contentFit="cover" />
          {multiIndex && (
            <View
              style={{
                position: 'absolute',
                bottom: 6,
                left: 6,
                minWidth: 18,
                height: 18,
                paddingHorizontal: 5,
                borderRadius: R.full,
                backgroundColor: 'rgba(0,0,0,0.6)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>{tile.index}</Text>
            </View>
          )}
        </View>
      )}

      {/* 左上: 編集 (切り抜き・回転) — ローカル画像のみ */}
      {canEdit && (
        <PressableScale
          onPress={() => cbs.onEditImage?.(imageIndex)}
          haptic="tap"
          hitSlop={14}
          accessibilityLabel="画像を編集 (切り抜き・回転)"
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            width: REMOVE_SIZE,
            height: REMOVE_SIZE,
            borderRadius: REMOVE_SIZE / 2,
            backgroundColor: 'rgba(0,0,0,0.6)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Crop size={13} color="#fff" strokeWidth={2.4} />
        </PressableScale>
      )}

      {/* 右上の削除ボタン */}
      <PressableScale
        onPress={() => (isVideo ? cbs.onRemoveVideo() : cbs.onRemoveImage(imageIndex))}
        haptic="warn"
        hitSlop={14}
        accessibilityLabel={isVideo ? '動画を削除' : '画像を削除'}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: REMOVE_SIZE,
          height: REMOVE_SIZE,
          borderRadius: REMOVE_SIZE / 2,
          backgroundColor: 'rgba(0,0,0,0.6)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconX size={14} color="#fff" strokeWidth={2.6} />
      </PressableScale>
    </Animated.View>
  );
}

// ============================================================
// VideoPreview — 投稿前の動画プレビュー (先頭フレームを実映像で表示)
// ------------------------------------------------------------
// Web は <video preload="metadata"> で先頭フレーム。Native は expo-av Video を
// 停止状態 (shouldPlay=false) で置いて先頭フレームを描く。expo-av は lazy require
// して Web bundle に乗せない。失敗時は黒地のまま (退行しない)。
// ============================================================
function VideoPreview({ uri, width, height }: { uri: string; width: number; height: number }): JSX.Element | null {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const React = require('react') as typeof import('react');
    return React.createElement('video', {
      src: uri,
      muted: true,
      playsInline: true,
      preload: 'metadata',
      style: { width, height, objectFit: 'cover', display: 'block', backgroundColor: '#000' },
    });
  }
  // Native: expo-av を lazy require
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let VideoCmp: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ResizeMode: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const av = require('expo-av') as typeof import('expo-av');
    VideoCmp = av.Video;
    ResizeMode = av.ResizeMode;
  } catch {
    /* expo-av 不在環境 — 黒地のままにする */
  }
  if (!VideoCmp) return null;
  return (
    <VideoCmp
      source={{ uri }}
      shouldPlay={false}
      isMuted
      resizeMode={ResizeMode?.COVER ?? 'cover'}
      style={{ width, height }}
    />
  );
}
