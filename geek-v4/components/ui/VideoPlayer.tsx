import { useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, Platform, type ViewStyle } from 'react-native';
import { PressableScale } from './PressableScale';
import { R } from '../../design/tokens';
import { T } from '../../design/typography';

// ============================================================
// VideoPlayer — expo-av Video の薄い wrapper
// ============================================================
// 要件:
//   - feed の中で再生する想定 → デフォルトで muted, tap で再生/停止
//   - 縦長フィードに突き刺さらないよう aspectRatio を強制 (16:9)
//   - expo-av を dynamic require して Web bundle 肥大化を抑える
//     (Web では <video> タグで素直に置く方が安定 + サイズ小)
//   - 失敗時は generic "再生できません" を表示 (silent fail にしない)
//
// 注: 動画ポスター画像は将来 (server transform 経由で thumbnail) 対応。
// ============================================================
type Props = {
  uri: string;
  poster?: string;
  /** width 100% で、aspect 比は親で固定 */
  style?: ViewStyle;
  /** 視聴領域に入ったら auto-play (feed 自動再生用に外部から制御) */
  shouldPlay?: boolean;
};

export function VideoPlayer({ uri, poster, style, shouldPlay = false }: Props) {
  const [error, setError] = useState<string | null>(null);

  // ---- Web 経路: <video> 要素で済む (expo-av より bundle 軽い) ----
  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: R.lg, overflow: 'hidden' },
          style,
        ]}
      >
        {/*
          RN Web では <video> 要素は使えるが React Native 型に無い。
          createElement 経由で型ガードを回避し、Web 専用 DOM 要素として描画。
        */}
        {(() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          const React = require('react') as typeof import('react');
          return React.createElement('video', {
            src: uri,
            poster,
            controls: true,
            playsInline: true,
            preload: 'metadata',
            style: { width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' },
            onError: () => setError('動画を読み込めませんでした'),
          });
        })()}
        {error && <ErrorOverlay msg={error} />}
      </View>
    );
  }

  // ---- Native 経路: expo-av の Video コンポーネント (lazy require) ----
  return (
    <NativeVideo uri={uri} poster={poster} style={style} shouldPlay={shouldPlay} />
  );
}

function NativeVideo({ uri, poster, style, shouldPlay }: Required<Pick<Props, 'uri'>> & Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const VideoRef = useRef<any>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // expo-av は native のみ。Web bundle に乗らないよう lazy require。
  // 型は loose にして any 経由で逃がす — ファイル内に閉じ込めるので影響限定的。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let VideoCmp: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ResizeMode: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const av = require('expo-av') as typeof import('expo-av');
    VideoCmp = av.Video;
    ResizeMode = av.ResizeMode;
  } catch (e) {
    // expo-av 未 install / 不在環境 — エラーを画面に表示して silent fail を避ける
    console.warn('[VideoPlayer] expo-av load failed:', e);
  }

  useEffect(() => {
    if (!VideoRef.current) return;
    if (shouldPlay && !playing) {
      VideoRef.current.playAsync?.().catch(() => {});
      setPlaying(true);
    }
  }, [shouldPlay, playing]);

  const togglePlay = useCallback(() => {
    if (!VideoRef.current) return;
    if (playing) {
      VideoRef.current.pauseAsync?.().catch(() => {});
      setPlaying(false);
    } else {
      VideoRef.current.playAsync?.().catch(() => {});
      setPlaying(true);
    }
  }, [playing]);

  if (!VideoCmp) {
    return (
      <View
        style={[
          { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: R.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
          style,
        ]}
      >
        <Text style={[T.caption, { color: '#fff' }]}>動画プレイヤを読み込めません</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: R.lg, overflow: 'hidden' },
        style,
      ]}
    >
      <VideoCmp
        ref={VideoRef}
        source={{ uri }}
        posterSource={poster ? { uri: poster } : undefined}
        usePoster={!!poster}
        isMuted={muted}
        isLooping
        useNativeControls
        resizeMode={ResizeMode?.CONTAIN ?? 'contain'}
        style={{ width: '100%', height: '100%' }}
        onError={(e: unknown) => {
          const msg = typeof e === 'string' ? e : '動画を読み込めませんでした';
          setError(msg);
        }}
      />
      {/* mute toggle — useNativeControls だけだと iOS で muted トグルが出ないことがある */}
      <PressableScale
        onPress={() => setMuted((m) => !m)}
        hitSlop={10}
        accessibilityLabel={muted ? 'ミュート解除' : 'ミュート'}
        style={{
          position: 'absolute',
          right: 8, bottom: 8,
          paddingHorizontal: 8, paddingVertical: 4,
          backgroundColor: 'rgba(0,0,0,0.55)',
          borderRadius: R.full,
        }}
      >
        <Text style={{ fontSize: 14 }}>{muted ? '🔇' : '🔊'}</Text>
      </PressableScale>
      {/* 中央 play overlay (停止時) */}
      {!playing && (
        <PressableScale
          onPress={togglePlay}
          accessibilityLabel="再生"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 60, height: 60, borderRadius: 30,
              backgroundColor: 'rgba(0,0,0,0.55)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 28, color: '#fff' }}>▶</Text>
          </View>
        </PressableScale>
      )}
      {error && <ErrorOverlay msg={error} />}
    </View>
  );
}

function ErrorOverlay({ msg }: { msg: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        alignItems: 'center', justifyContent: 'center',
        padding: 12,
      }}
    >
      <Text style={[T.small, { color: '#fff', textAlign: 'center' }]}>{msg}</Text>
    </View>
  );
}
