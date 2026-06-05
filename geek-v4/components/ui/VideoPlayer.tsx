import { useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, Platform, Dimensions, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { PressableScale } from './PressableScale';
import { Icon } from '../../constants/icons';
import { R } from '../../design/tokens';
import { T } from '../../design/typography';
import { useVideoLightboxStore } from '../../stores/videoLightboxStore';

// ============================================================
// VideoPlayer — X / Instagram 風「ビューポート自動再生」プレイヤー
// ============================================================
// 要件:
//   - 画面に入った瞬間に muted で自動再生し、画面外に出たら停止 (IG/X feed と同じ)
//   - tap で音声 ON/OFF (デフォルト muted)。ループ再生。
//   - 可視判定はコンポーネント側で自己完結 → 親リストへの配線が不要
//       Web    : IntersectionObserver (<video> を直接 observe)
//       Native : 親 View を measureInWindow で定期計測 (350ms) して in-view 判定
//   - shouldPlay を渡せば自前検出を上書きして明示制御も可能 (将来のリスト精密制御用)
//   - expo-av は native のみ dynamic require して Web bundle を太らせない
//   - 失敗時は "再生できません" を表示 (silent fail にしない)
// ============================================================
type Props = {
  uri: string;
  poster?: string;
  /** width 100% で aspect 比は内部で 16:9 固定 (親で上書き可) */
  style?: ViewStyle;
  /** 明示制御の override。未指定なら自前で viewport を検出して自動再生/停止する。 */
  shouldPlay?: boolean;
  /** 自動再生を無効化したい場合 false。default true (X / Instagram 風)。 */
  autoplay?: boolean;
  /** タップで全画面ビューア (VideoLightbox) を開く。default true。
   *  ミュート切替は右下バッジ側に集約する。lightbox 内の VideoPlayer は false で再帰展開を防ぐ。 */
  expandable?: boolean;
  /** 初期ミュート状態。default true (feed の muted 自動再生)。lightbox は false (音あり)。 */
  initialMuted?: boolean;
};

const FRAME = {
  width: '100%' as const,
  aspectRatio: 16 / 9,
  backgroundColor: '#000',
  borderRadius: R.lg,
  overflow: 'hidden' as const,
};

// ============================================================
// インライン自動再生の「同時デコード上限」(mobile Safari のデコーダ枯渇対策)
// ------------------------------------------------------------
// 画面内の自動再生 <video> が増えても、同時に play() するのは PLAY_CAP 本まで。
// 超過分は先頭フレーム(=静止画)のまま待機し、スロットが空いたら in-view の
// ものから再生を再開する。autoplay は無効化しない(常時可視・muted は維持し、
// 走るハードウェアデコーダの本数だけ間引いて scroll の「かくかく」を防ぐ)。
// ============================================================
const PLAY_CAP = 2;
let playingCount = 0;
const playWaiters = new Set<() => void>();

function acquirePlaySlot(): boolean {
  if (playingCount < PLAY_CAP) {
    playingCount += 1;
    return true;
  }
  return false;
}
function releasePlaySlot(): void {
  if (playingCount > 0) playingCount -= 1;
  // 空いたスロットを待つ in-view の video 全員に再試行を促す(成功するのは空き分だけ)。
  playWaiters.forEach((cb) => cb());
}
function addPlayWaiter(cb: () => void): () => void {
  playWaiters.add(cb);
  return () => {
    playWaiters.delete(cb);
  };
}

export function VideoPlayer({
  uri,
  poster,
  style,
  shouldPlay,
  autoplay = true,
  expandable = true,
  initialMuted = true,
}: Props) {
  if (Platform.OS === 'web') {
    return <WebVideo uri={uri} poster={poster} style={style} shouldPlay={shouldPlay} autoplay={autoplay} expandable={expandable} initialMuted={initialMuted} />;
  }
  return <NativeVideo uri={uri} poster={poster} style={style} shouldPlay={shouldPlay} autoplay={autoplay} expandable={expandable} initialMuted={initialMuted} />;
}

// ============================================================
// Web 経路 — <video> + IntersectionObserver
// ============================================================
function WebVideo({ uri, poster, style, shouldPlay, autoplay = true, expandable = true, initialMuted = true }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videoRef = useRef<any>(null);
  const mutedRef = useRef(initialMuted);
  // 同時再生スロットを保持中か / いま画面内で再生したいか(IO 判定の最新値)。
  const hasSlotRef = useRef(false);
  const wantPlayRef = useRef(false);
  const [muted, setMuted] = useState(initialMuted);
  const [error, setError] = useState<string | null>(null);

  // タップで全画面ビューア (VideoLightbox) を開く。expandable=false (lightbox 内) では使わない。
  const onExpand = useCallback(() => {
    useVideoLightboxStore.getState().open(uri, poster ?? null);
  }, [uri, poster]);

  const applyMuted = useCallback((m: boolean) => {
    mutedRef.current = m;
    setMuted(m);
    if (videoRef.current) videoRef.current.muted = m;
  }, []);

  // ref は安定化 (毎 render で detach/attach されると再生が一瞬途切れる)
  const setVideoRef = useCallback((n: unknown) => {
    videoRef.current = n;
    if (!n) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = n as any;
    el.muted = mutedRef.current;
    // iOS Safari のインライン muted 自動再生を確実にするための保険:
    //  - React は <video muted> の muted を「属性」に反映しない既知バグがあり、
    //    iOS は属性/defaultMuted を見て自動再生可否を判定するため、DOM へ直接付与する。
    //  - playsinline / webkit-playsinline が無いと iOS は全画面化 or 再生拒否する。
    try {
      el.defaultMuted = true;
      el.setAttribute?.('muted', '');
      el.setAttribute?.('playsinline', '');
      el.setAttribute?.('webkit-playsinline', '');
    } catch {
      /* noop — 一部環境で setAttribute 不可でも致命ではない */
    }
  }, []);

  // 明示 override (shouldPlay 指定時)
  useEffect(() => {
    const el = videoRef.current;
    if (!el || shouldPlay === undefined) return;
    if (shouldPlay) el.play?.().catch(() => {});
    else el.pause?.();
  }, [shouldPlay]);

  // 自前 viewport 検出 — override 未指定 & autoplay 有効時のみ。
  // 同時再生は PLAY_CAP 本まで。上限時は先頭フレームのまま待機し、他が画面外へ
  // 出てスロットが空いたら(releasePlaySlot のブロードキャストで)再生を取り戻す。
  useEffect(() => {
    if (shouldPlay !== undefined || !autoplay) return;
    const el = videoRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const tryPlay = () => {
      el.muted = mutedRef.current;
      // 音あり autoplay が弾かれたら muted で再試行
      el.play?.().catch(() => {
        applyMuted(true);
        el.play?.().catch(() => {});
      });
    };
    // スロットが空いたとき呼ばれる: まだ画面内 & 未取得なら取得して再生。
    const retry = () => {
      if (hasSlotRef.current || !wantPlayRef.current) return;
      if (acquirePlaySlot()) {
        hasSlotRef.current = true;
        tryPlay();
      }
    };
    const removeWaiter = addPlayWaiter(retry);

    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        if (e.isIntersecting && e.intersectionRatio >= 0.6) {
          wantPlayRef.current = true;
          if (hasSlotRef.current) {
            tryPlay();
          } else if (acquirePlaySlot()) {
            hasSlotRef.current = true;
            tryPlay();
          }
          // それ以外(上限到達)は retry が空きを待つ
        } else {
          wantPlayRef.current = false;
          el.pause?.();
          if (hasSlotRef.current) {
            hasSlotRef.current = false;
            releasePlaySlot();
          }
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      removeWaiter();
      wantPlayRef.current = false;
      if (hasSlotRef.current) {
        hasSlotRef.current = false;
        releasePlaySlot();
      }
    };
  }, [autoplay, shouldPlay, uri, applyMuted]);

  return (
    <View style={[FRAME, style]}>
      {(() => {
        // RN Web では <video> を createElement で直接描画 (RN 型に無いため)
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const React = require('react') as typeof import('react');
        return React.createElement('video', {
          ref: setVideoRef,
          src: uri,
          poster,
          muted,
          loop: true,
          playsInline: true,
          preload: 'metadata',
          // controls は出さず IG/X 風。tap = 全画面展開 (expandable 時)、ミュートは右下バッジ。
          onClick: expandable ? onExpand : () => applyMuted(!mutedRef.current),
          style: {
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            backgroundColor: '#000',
            cursor: 'pointer',
          },
          onError: () => {
            // ★ エラー時はグローバル再生スロットを解放する。壊れた動画がスロットを
            //   握り続けると、アプリ全体の自動再生が枯渇しうる。
            wantPlayRef.current = false;
            if (hasSlotRef.current) {
              hasSlotRef.current = false;
              releasePlaySlot();
            }
            setError('動画を読み込めませんでした');
          },
        });
      })()}
      {!error && <MuteBadge muted={muted} onPress={() => applyMuted(!muted)} />}
      {error && <ErrorOverlay msg={error} />}
    </View>
  );
}

// ============================================================
// Native 経路 — expo-av Video + measureInWindow 可視判定
// ============================================================
function NativeVideo({ uri, poster, style, shouldPlay, autoplay = true, expandable = true, initialMuted = true }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerRef = useRef<any>(null);
  const [muted, setMuted] = useState(initialMuted);
  const [error, setError] = useState<string | null>(null);

  // expo-av は native のみ。Web bundle に乗らないよう lazy require。
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
    console.warn('[VideoPlayer] expo-av load failed:', e);
  }

  const externallyControlled = shouldPlay !== undefined;
  const selfDetect = autoplay && !externallyControlled;
  const inView = useNativeInView(containerRef, selfDetect);
  const playing = externallyControlled ? !!shouldPlay : autoplay ? inView : false;

  if (!VideoCmp) {
    return (
      <View style={[FRAME, { alignItems: 'center', justifyContent: 'center' }, style]}>
        <Text style={[T.caption, { color: '#fff' }]}>動画プレイヤを読み込めません</Text>
      </View>
    );
  }

  return (
    <View ref={containerRef} style={[FRAME, style]}>
      <VideoCmp
        source={{ uri }}
        posterSource={poster ? { uri: poster } : undefined}
        usePoster={!!poster}
        shouldPlay={playing}
        isMuted={muted}
        isLooping
        resizeMode={ResizeMode?.CONTAIN ?? 'contain'}
        style={{ width: '100%', height: '100%' }}
        onError={(e: unknown) => {
          setError(typeof e === 'string' ? e : '動画を読み込めませんでした');
        }}
      />
      {/* タップで全画面ビューア。MuteBadge より前に置き、badge が上層でタップを拾えるようにする。 */}
      {expandable && !error && (
        <Pressable
          onPress={() => useVideoLightboxStore.getState().open(uri, poster ?? null)}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="動画を全画面で開く"
        />
      )}
      {!error && <MuteBadge muted={muted} onPress={() => setMuted((m) => !m)} />}
      {error && <ErrorOverlay msg={error} />}
    </View>
  );
}

// 親 View を定期計測して「画面内に 50% 以上あるか」を返す自己完結フック (native)
function useNativeInView(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref: React.MutableRefObject<any>,
  enabled: boolean,
): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setInView(false);
      return;
    }
    let alive = true;
    const check = () => {
      const node = ref.current;
      if (!node || typeof node.measureInWindow !== 'function') return;
      node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
        if (!alive) return;
        const screenH = Dimensions.get('window').height;
        if (!h || !screenH) {
          setInView(false);
          return;
        }
        const visibleTop = Math.max(y, 0);
        const visibleBottom = Math.min(y + h, screenH);
        const ratio = (visibleBottom - visibleTop) / h;
        // setState は同値なら React が bailout するので 350ms ポーリングでも再 render は最小
        setInView(ratio >= 0.5);
      });
    };
    check();
    const id = setInterval(check, 350);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ref, enabled]);
  return inView;
}

// ミュート切替バッジ (右下)
function MuteBadge({ muted, onPress }: { muted: boolean; onPress: () => void }) {
  const V = muted ? Icon.volumeMute : Icon.volume;
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={10}
      accessibilityLabel={muted ? 'ミュート解除' : 'ミュート'}
      style={{
        position: 'absolute',
        right: 8,
        bottom: 8,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <V size={16} color="#fff" strokeWidth={2.2} />
    </PressableScale>
  );
}

function ErrorOverlay({ msg }: { msg: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
      }}
    >
      <Text style={[T.small, { color: '#fff', textAlign: 'center' }]}>{msg}</Text>
    </View>
  );
}
