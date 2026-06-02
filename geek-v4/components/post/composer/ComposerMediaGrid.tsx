// ============================================================
// components/post/composer/ComposerMediaGrid.tsx
// ============================================================
// 投稿作成キャンバス用の「画像 + 動画」プレビュー grid。
// X (Twitter) / Instagram の添付メディアプレビューに寄せた、
// hero として成立する見た目の grid を目指す:
//   - 角丸 (R.lg) + 端正な gap
//   - 1〜4 枚で破綻しない比率 (1:large / 2:横並び / 3:左tall+右stack / 4:2x2)
//   - 各タイルの右上にクリスプな削除ボタン
//   - FadeIn / FadeOut + Layout spring で滑らかな出入り
//
// 設計判断:
//   - 純 presentational。state は持たず、削除は callback に委譲する。
//   - サイズは useWindowDimensions().width から実ピクセルで算出し、
//     ProgressiveImage に number の width/height を渡す
//     (`%` 指定だと Web で aspect が崩れやすいため固定 px に倒す)。
//   - video は「追加の 1 タイル」として images と同じ列レイアウトに混ぜる。
//     合計タイル数 = images.length + (video ? 1 : 0) で、視覚は 4 タイルまで。
//   - tile 内側は overflow:hidden で角丸クリップ、削除ボタンは外側 wrap に
//     absolute 配置 (top6 right6) して角の内側に浮かせる。
// ============================================================

import { useState } from 'react';
import { View, Text, Platform, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, Layout } from 'react-native-reanimated';
import { X as IconX } from 'lucide-react-native';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { PressableScale } from '../../ui/PressableScale';
import { ProgressiveImage } from '../../ui/ProgressiveImage';
import { Icon } from '../../../constants/icons';

// ============================================================
// 定数: gap / 角丸 / 削除ボタン
// ============================================================
const GAP = SP['1']; // 4px — タイル間の端正な隙間
const TILE_RADIUS = R.lg; // 14
const OUTER_RADIUS = R.xl; // 20 — 外周だけ少し大きく取って "塊感" を出す
const REMOVE_SIZE = 26;
const PLAY_BADGE = 44;

// ============================================================
// Props
// ============================================================
export interface ComposerMediaGridProps {
  images: string[]; // 0..4 uris (local or https)
  video: { uri: string; sizeMb: number } | null; // optional single video
  onRemoveImage: (uri: string) => void;
  onRemoveVideo: () => void;
  containerPaddingH?: number; // default 16 (SP['4']) — ページ左右 padding (幅計算に使う)
}

// 内部の「描画タイル」表現 — image か video の判別 union。
type Tile =
  | { kind: 'image'; uri: string; index: number }
  | { kind: 'video'; uri: string; sizeMb: number };

// ============================================================
// ComposerMediaGrid — 単一 export
// ============================================================
export function ComposerMediaGrid({
  images,
  video,
  onRemoveImage,
  onRemoveVideo,
  containerPaddingH = SP['4'],
}: ComposerMediaGridProps): JSX.Element | null {
  const { width: winW } = useWindowDimensions();
  // 親カラムの実測幅。create.tsx ではアバター列分インデントされたカラムの中に置かれる
  // ため、winW から計算すると右にはみ出して「画面内に収まらない」。onLayout で実測する。
  const [measuredW, setMeasuredW] = useState(0);

  // 画像 + 動画 を 1 列に並べ、視覚レイアウトは 4 タイルで cap する。
  const allTiles: Tile[] = [
    ...images.map<Tile>((uri, i) => ({
      kind: 'image',
      uri,
      index: i + 1,
    })),
    ...(video ? [{ kind: 'video', uri: video.uri, sizeMb: video.sizeMb } as Tile] : []),
  ];
  const tiles = allTiles.slice(0, 4);
  const count = tiles.length;

  // 0 タイル → 何も描かない
  if (count === 0) return null;

  // ----- サイズ算出 -----
  // 実測幅があればそれを使う (= 必ず親カラム/画面内に収まる)。未測定の間は winW から概算。
  const contentW = measuredW > 0 ? measuredW : Math.max(0, winW - 2 * containerPaddingH);
  // 2 カラムのときの 1 タイル幅 (列間 1 gap を差し引いて 2 等分)
  const halfW = Math.floor((contentW - GAP) / 2);

  const multiIndex = images.length > 1; // 画像が複数のとき index バッジを出す

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
      {count === 1 && (
        <SingleLayout
          tile={tiles[0]!}
          width={contentW}
          multiIndex={multiIndex}
          onRemoveImage={onRemoveImage}
          onRemoveVideo={onRemoveVideo}
        />
      )}

      {count === 2 && (
        <View style={{ flexDirection: 'row', gap: GAP }}>
          {tiles.map((tile) => (
            <MediaTile
              key={tile.uri}
              tile={tile}
              width={halfW}
              height={halfW}
              multiIndex={multiIndex}
              onRemoveImage={onRemoveImage}
              onRemoveVideo={onRemoveVideo}
            />
          ))}
        </View>
      )}

      {count === 3 && (
        <ThreeLayout
          tiles={tiles}
          halfW={halfW}
          multiIndex={multiIndex}
          onRemoveImage={onRemoveImage}
          onRemoveVideo={onRemoveVideo}
        />
      )}

      {count === 4 && (
        <FourLayout
          tiles={tiles}
          halfW={halfW}
          multiIndex={multiIndex}
          onRemoveImage={onRemoveImage}
          onRemoveVideo={onRemoveVideo}
        />
      )}
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
  onRemoveImage,
  onRemoveVideo,
}: {
  tile: Tile;
  width: number;
  multiIndex: boolean;
  onRemoveImage: (uri: string) => void;
  onRemoveVideo: () => void;
}): JSX.Element {
  const height = Math.round((width * 10) / 16); // ~16:10
  return (
    <MediaTile
      tile={tile}
      width={width}
      height={height}
      multiIndex={multiIndex}
      onRemoveImage={onRemoveImage}
      onRemoveVideo={onRemoveVideo}
    />
  );
}

// ============================================================
// ThreeLayout — 左に full-height tall タイル + 右に square ×2 (縦積み)
// ============================================================
function ThreeLayout({
  tiles,
  halfW,
  multiIndex,
  onRemoveImage,
  onRemoveVideo,
}: {
  tiles: Tile[];
  halfW: number;
  multiIndex: boolean;
  onRemoveImage: (uri: string) => void;
  onRemoveVideo: () => void;
}): JSX.Element {
  // 右カラムは square ×2 + gap = 全体高。左の tall はそれに揃える。
  const fullH = halfW * 2 + GAP;
  const [left, rightTop, rightBottom] = tiles;
  return (
    <View style={{ flexDirection: 'row', gap: GAP }}>
      <MediaTile
        tile={left!}
        width={halfW}
        height={fullH}
        multiIndex={multiIndex}
        onRemoveImage={onRemoveImage}
        onRemoveVideo={onRemoveVideo}
      />
      <View style={{ gap: GAP }}>
        <MediaTile
          tile={rightTop!}
          width={halfW}
          height={halfW}
          multiIndex={multiIndex}
          onRemoveImage={onRemoveImage}
          onRemoveVideo={onRemoveVideo}
        />
        <MediaTile
          tile={rightBottom!}
          width={halfW}
          height={halfW}
          multiIndex={multiIndex}
          onRemoveImage={onRemoveImage}
          onRemoveVideo={onRemoveVideo}
        />
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
  onRemoveImage,
  onRemoveVideo,
}: {
  tiles: Tile[];
  halfW: number;
  multiIndex: boolean;
  onRemoveImage: (uri: string) => void;
  onRemoveVideo: () => void;
}): JSX.Element {
  return (
    <View style={{ gap: GAP }}>
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {tiles.slice(0, 2).map((tile) => (
          <MediaTile
            key={tile.uri}
            tile={tile}
            width={halfW}
            height={halfW}
            multiIndex={multiIndex}
            onRemoveImage={onRemoveImage}
            onRemoveVideo={onRemoveVideo}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {tiles.slice(2, 4).map((tile) => (
          <MediaTile
            key={tile.uri}
            tile={tile}
            width={halfW}
            height={halfW}
            multiIndex={multiIndex}
            onRemoveImage={onRemoveImage}
            onRemoveVideo={onRemoveVideo}
          />
        ))}
      </View>
    </View>
  );
}

// ============================================================
// MediaTile — 1 タイル (画像 or 動画) + 右上削除ボタン
// ============================================================
function MediaTile({
  tile,
  width,
  height,
  multiIndex,
  onRemoveImage,
  onRemoveVideo,
}: {
  tile: Tile;
  width: number;
  height: number;
  multiIndex: boolean;
  onRemoveImage: (uri: string) => void;
  onRemoveVideo: () => void;
}): JSX.Element {
  const isVideo = tile.kind === 'video';

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={Layout.springify().damping(20)}
      style={{ width, height, borderRadius: TILE_RADIUS }}
    >
      {isVideo ? (
        // ----- 動画タイル: 実映像の先頭フレーム + 中央 play badge + 左下サイズ pill -----
        <View
          style={{
            width,
            height,
            borderRadius: TILE_RADIUS,
            backgroundColor: '#000',
            overflow: 'hidden',
          }}
        >
          {/* 実際の動画プレビュー (Web=<video>, Native=expo-av の先頭フレーム)。
              これが無いと「投稿する動画が見えない」(黒い箱のまま) になる。 */}
          <VideoPreview uri={tile.uri} width={width} height={height} />
          {/* 中央の再生バッジ (オーバーレイ) */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
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
            <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>
              {`${tile.sizeMb.toFixed(1)}MB`}
            </Text>
          </View>
        </View>
      ) : (
        // ----- 画像タイル -----
        <View style={{ borderRadius: TILE_RADIUS, overflow: 'hidden' }}>
          <ProgressiveImage
            uri={tile.uri}
            width={width}
            height={height}
            radius={TILE_RADIUS}
            contentFit="cover"
          />
          {multiIndex && (
            // 画像が複数枚のとき、左下に小さな連番バッジ
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
              <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>
                {tile.index}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* 右上の削除ボタン — 26px 円, 黒半透明 */}
      <PressableScale
        onPress={() => (isVideo ? onRemoveVideo() : onRemoveImage(tile.uri))}
        haptic="warn"
        hitSlop={8}
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
function VideoPreview({
  uri,
  width,
  height,
}: {
  uri: string;
  width: number;
  height: number;
}): JSX.Element | null {
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
