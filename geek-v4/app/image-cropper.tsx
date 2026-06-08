// ============================================================
// Image cropper screen — fullscreen modal-like
// ============================================================
// `openCropper(uri, opts?)` (lib/imageCropper.ts) からこの画面を push して、
// pan + pinch zoom + 90° rotate でユーザーが切り抜いた結果を resolveCropper() で
// resolve する設計。opts.shape で 2 モードを切り替える:
//   - 'circle' (既定): アイコン用。円マスク / 1:1 正方形 / 512px 出力。
//   - 'rect'        : 投稿写真用。任意アスペクトの矩形フレーム (元の比率/1:1/4:5/16:9) +
//                     回転。出力は crop 解像度を活かしつつ長辺 outMaxEdge に収める。
//
// ★ WYSIWYG (回転時も「見えている範囲 == 切り出される範囲」):
//   表示の <Image> は *元画像* を resizeMode='cover' で box に描き、box ごと rotate する。
//   box には computeDisplayBoxDims で *元画像アスペクト* を持たせる (90/270 では fit を入れ替え)
//   ので cover が回転前にクリップしない。box を回した footprint = cover footprint = 出力 crop
//   と一致する (lib/cropMath.ts のコメント参照)。回転アニメは累積角で常に前進させる。
//
// crop の数学は lib/cropMath.ts に純関数として切り出し (Jest で検証)。
// ============================================================

import { useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';
import { Icon } from '../constants/icons';
import { C, SP } from '../design/tokens';
import { PressableScale } from '../components/ui/PressableScale';
import { resolveCropper, consumePendingSource, type CropperOptions } from '../lib/imageCropper';
import { cropImageOnWebCanvas } from '../lib/image';
import { computeCropRect, computeFitDims, computeOutputDims, computeDisplayBoxDims } from '../lib/cropMath';

type Rotation = 0 | 90 | 180 | 270;
type AspectMode = 'original' | 'square' | 'portrait' | 'wide';

const ASPECT_CHIPS: { key: AspectMode; label: string }[] = [
  { key: 'original', label: '元の比率' },
  { key: 'square', label: '1:1' },
  { key: 'portrait', label: '4:5' },
  { key: 'wide', label: '16:9' },
];

export default function ImageCropperScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; uri?: string | string[] }>();
  const paramId =
    typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] ?? '' : '';
  const legacyUri =
    typeof params.uri === 'string' ? params.uri : Array.isArray(params.uri) ? params.uri[0] ?? '' : '';
  const pending = useMemo(() => {
    if (paramId) {
      const fromMap = consumePendingSource(paramId);
      if (!fromMap) {
        console.warn('[image-cropper] paramId が Map に無い — refresh で in-memory が消えた可能性:', paramId);
        return null;
      }
      return fromMap;
    }
    if (legacyUri) return { uri: legacyUri, opts: {} };
    return null;
  }, [paramId, legacyUri]);

  const sourceUri = pending?.uri ?? '';
  const opts: CropperOptions = pending?.opts ?? {};
  const isRect = opts.shape === 'rect';
  const outMaxEdge = opts.outMaxEdge ?? 1440;

  const router = useRouter();
  const insets = useSafeAreaInsets();
  // ★ useWindowDimensions: 初期 render で 0x0 を返す Dimensions.get の race を回避。reactive。
  const { width: screenW, height: screenH } = useWindowDimensions();

  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [aspectMode, setAspectMode] = useState<AspectMode>('original');
  const [busy, setBusy] = useState(false);
  const [renderError, setRenderError] = useState(false);

  // 二重ナビゲーション防止 (busy 中の戻る連打 + handleNext 完了の競合対策)
  const navigatedRef = useRef(false);
  // 回転アニメ用の累積角 (剰余を取らず常に +90 → 270→0 で逆回転しない)
  const rotDegRef = useRef(0);

  // 動かす変数 — reanimated SharedValue
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const rotationSv = useSharedValue(0); // 累積角 (deg) — 表示の rotate 用

  // canGoBack フォールバック付きの退出 (refresh/deeplink で back stack が空でも詰まない)。
  const safeExit = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/feed' as never);
  };

  // ----- crop フレーム寸法 -----
  const swap = rotation === 90 || rotation === 270;
  const rotatedAspect = imageSize ? (swap ? imageSize.h / imageSize.w : imageSize.w / imageSize.h) : 1;
  const aspectRatio = !isRect
    ? 1
    : aspectMode === 'original'
      ? rotatedAspect
      : aspectMode === 'square'
        ? 1
        : aspectMode === 'portrait'
          ? 4 / 5
          : 16 / 9;

  // フレームは画面中央配置 (computeCropRect が中央前提)。ただし上下 chrome
  // (戻る/下バー/アスペクト toolbar) に被らないよう利用可能高に収める。
  const { frameW, frameH } = useMemo(() => {
    const bottomChromeH = isRect ? 132 : 88;
    const vClear = Math.max(insets.top + 56, insets.bottom + bottomChromeH);
    const availH = Math.max(160, screenH - 2 * vClear);
    const availW = screenW * 0.92;
    if (!isRect) {
      const d = Math.min(Math.min(screenW, screenH) * 0.75, availW, availH);
      return { frameW: d, frameH: d };
    }
    if (aspectRatio >= availW / availH) return { frameW: availW, frameH: availW / aspectRatio };
    return { frameW: availH * aspectRatio, frameH: availH };
  }, [isRect, screenW, screenH, insets.top, insets.bottom, aspectRatio]);

  // uri が無ければ即 cancel して back
  useEffect(() => {
    if (!sourceUri) {
      resolveCropper(null);
      safeExit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUri]);

  // unmount 時の safety: 「次へ」「戻る」を経由せず画面が消えても pending を resolve(null)。
  useEffect(() => {
    return () => {
      resolveCropper(null);
    };
  }, []);

  // 自然画像サイズ取得 — Image.getSize は web/native 両対応
  useEffect(() => {
    if (!sourceUri) return;
    let alive = true;
    const stallTimer = setTimeout(() => {
      if (alive && !imageSize) {
        console.warn('[image-cropper] getSize stalled 12s — showing render error');
        setRenderError(true);
      }
    }, 12_000);
    Image.getSize(
      sourceUri,
      (w, h) => {
        if (!alive) return;
        clearTimeout(stallTimer);
        if (!w || !h || w < 1 || h < 1) {
          console.warn('[image-cropper] getSize returned invalid dims:', w, h, '— treating as decode failure');
          setRenderError(true);
          return;
        }
        setImageSize({ w, h });
      },
      (err) => {
        console.warn('[image-cropper] getSize failed:', err);
        if (alive) {
          clearTimeout(stallTimer);
          resolveCropper(null);
          safeExit();
        }
      },
    );
    return () => {
      alive = false;
      clearTimeout(stallTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUri]);

  // cover-fit の表示寸法 (rotation 適用後の footprint) + 表示 box (元画像アスペクト)
  const fitDims = useMemo(() => {
    if (!imageSize) return null;
    return computeFitDims({ imageW: imageSize.w, imageH: imageSize.h, rotation, frameW, frameH });
  }, [imageSize, rotation, frameW, frameH]);

  const boxDims = useMemo(() => {
    if (!fitDims) return null;
    return computeDisplayBoxDims({ fitW: fitDims.fitW, fitH: fitDims.fitH, rotation });
  }, [fitDims, rotation]);

  const clampFitW = fitDims?.fitW ?? frameW;
  const clampFitH = fitDims?.fitH ?? frameH;

  const MIN_SCALE = 1;
  const MAX_SCALE = 4;

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(2)
        .onUpdate((e) => {
          const maxTX = Math.max(0, (clampFitW * scale.value - frameW) / 2);
          const maxTY = Math.max(0, (clampFitH * scale.value - frameH) / 2);
          const nx = savedTranslateX.value + e.translationX;
          const ny = savedTranslateY.value + e.translationY;
          translateX.value = Math.min(maxTX, Math.max(-maxTX, nx));
          translateY.value = Math.min(maxTY, Math.max(-maxTY, ny));
        })
        .onEnd(() => {
          savedTranslateX.value = translateX.value;
          savedTranslateY.value = translateY.value;
        }),
    [translateX, translateY, savedTranslateX, savedTranslateY, scale, clampFitW, clampFitH, frameW, frameH],
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((e) => {
          const next = savedScale.value * e.scale;
          scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
          const maxTX = Math.max(0, (clampFitW * scale.value - frameW) / 2);
          const maxTY = Math.max(0, (clampFitH * scale.value - frameH) / 2);
          translateX.value = Math.min(maxTX, Math.max(-maxTX, translateX.value));
          translateY.value = Math.min(maxTY, Math.max(-maxTY, translateY.value));
        })
        .onEnd(() => {
          savedScale.value = scale.value;
          savedTranslateX.value = translateX.value;
          savedTranslateY.value = translateY.value;
        }),
    [scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY, clampFitW, clampFitH, frameW, frameH],
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture],
  );

  const zoomBy = (factor: number) => {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale.value * factor));
    scale.value = next;
    savedScale.value = next;
    const maxTX = Math.max(0, (clampFitW * next - frameW) / 2);
    const maxTY = Math.max(0, (clampFitH * next - frameH) / 2);
    translateX.value = Math.min(maxTX, Math.max(-maxTX, translateX.value));
    translateY.value = Math.min(maxTY, Math.max(-maxTY, translateY.value));
    savedTranslateX.value = translateX.value;
    savedTranslateY.value = translateY.value;
  };

  const resetTransform = () => {
    translateX.value = withTiming(0, { duration: 180 });
    translateY.value = withTiming(0, { duration: 180 });
    scale.value = withTiming(1, { duration: 180 });
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    savedScale.value = 1;
  };

  const imgAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotationSv.value}deg` },
    ],
  }));

  // 90° 回転 — 累積角で常に前進アニメ (271°→360° 等)。crop 計算は %360 の state を使う。
  const handleRotate = () => {
    if (!imageSize || busy) return;
    rotDegRef.current += 90;
    rotationSv.value = withTiming(rotDegRef.current, { duration: 180 });
    setRotation((rotDegRef.current % 360) as Rotation);
    resetTransform();
  };

  const handleAspect = (m: AspectMode) => {
    if (m === aspectMode) return;
    setAspectMode(m);
    resetTransform();
  };

  const handleCancel = () => {
    resolveCropper(null);
    safeExit();
  };

  const handleNext = async () => {
    if (!imageSize || !fitDims || busy) return;
    setBusy(true);
    try {
      const { fitW, fitH } = fitDims;
      const { cropX, cropY, cropW, cropH } = computeCropRect({
        screenW,
        screenH,
        frameW,
        frameH,
        scale: scale.value,
        translateX: translateX.value,
        translateY: translateY.value,
        fitW,
        fitH,
        imageW: imageSize.w,
        imageH: imageSize.h,
        rotation,
        square: !isRect,
      });

      const out = isRect ? computeOutputDims(cropW, cropH, outMaxEdge) : { outW: 512, outH: 512 };

      console.log('[image-cropper] crop rect:', { cropX, cropY, cropW, cropH, rotation, isRect, out });

      let croppedUri: string | null = null;

      if (Platform.OS === 'web') {
        try {
          croppedUri = await cropImageOnWebCanvas({
            sourceUri,
            imageSize,
            rotation,
            cropX,
            cropY,
            cropW,
            cropH,
            ...(isRect ? { outW: out.outW, outH: out.outH } : { outSize: 512 }),
          });
          console.log('[image-cropper] canvas crop ok, dataUrl size:', croppedUri.length);
        } catch (canvasErr) {
          console.warn('[image-cropper] canvas crop failed:', canvasErr);
          try {
            const res = await fetch(sourceUri);
            const blob = await res.blob();
            croppedUri = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error('FileReader.onerror'));
              reader.readAsDataURL(blob);
            });
            console.log('[image-cropper] FileReader fallback (no crop) ok');
          } catch (frErr) {
            console.warn('[image-cropper] FileReader fallback failed:', frErr);
            croppedUri = sourceUri;
          }
        }
      } else {
        const actions: ImageManipulator.Action[] = [];
        if (rotation !== 0) actions.push({ rotate: rotation });
        actions.push({
          crop: {
            originX: Math.round(cropX),
            originY: Math.round(cropY),
            width: Math.round(cropW),
            height: Math.round(cropH),
          },
        });
        actions.push({ resize: { width: out.outW, height: out.outH } });
        try {
          const result = await ImageManipulator.manipulateAsync(sourceUri, actions, {
            compress: 0.85,
            format: ImageManipulator.SaveFormat.JPEG,
          });
          croppedUri = result.uri;
          console.log('[image-cropper] native manipulator ok:', result.uri);
        } catch (innerErr) {
          console.warn('[image-cropper] native manipulator failed, attempting center fallback:', innerErr);
          const rotatedNatW = swap ? imageSize.h : imageSize.w;
          const rotatedNatH = swap ? imageSize.w : imageSize.h;
          const side = Math.min(rotatedNatW, rotatedNatH);
          const fallbackX = Math.round((rotatedNatW - side) / 2);
          const fallbackY = Math.round((rotatedNatH - side) / 2);
          try {
            const fb = await ImageManipulator.manipulateAsync(
              sourceUri,
              [
                ...(rotation !== 0 ? ([{ rotate: rotation }] as ImageManipulator.Action[]) : []),
                { crop: { originX: fallbackX, originY: fallbackY, width: side, height: side } },
                { resize: { width: 512, height: 512 } },
              ],
              { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
            );
            croppedUri = fb.uri;
          } catch (fbErr) {
            console.warn('[image-cropper] native fallback also failed:', fbErr);
            croppedUri = sourceUri;
          }
        }
      }

      resolveCropper(croppedUri);
      safeExit();
    } catch (e) {
      console.warn('[image-cropper] crop failed:', e);
      resolveCropper(sourceUri || null);
      safeExit();
    } finally {
      setBusy(false);
    }
  };

  // フレームの bounding rect の四方を黒 55% で暗転 (中央は透過)
  const maskOffsetV = (screenH - frameH) / 2;
  const maskOffsetH = (screenW - frameW) / 2;
  const frameRadius = isRect ? 12 : frameW / 2;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* 画像キャンバス */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <GestureDetector gesture={composedGesture}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { alignItems: 'center', justifyContent: 'center' },
              Platform.OS === 'web'
                ? ({ touchAction: 'none', userSelect: 'none', overscrollBehavior: 'none' } as object)
                : null,
            ]}
          >
            {imageSize && fitDims && boxDims ? (
              <Animated.Image
                source={{ uri: sourceUri }}
                onError={(e) => {
                  const err = (e as { nativeEvent?: { error?: string } })?.nativeEvent?.error ?? 'unknown';
                  console.warn('[image-cropper] image render failed:', err, 'uri:', sourceUri?.slice(0, 64));
                  setRenderError(true);
                }}
                onLoad={() => {
                  if (renderError) setRenderError(false);
                }}
                style={[
                  { width: boxDims.boxW, height: boxDims.boxH },
                  imgAnimStyle,
                  Platform.OS === 'web'
                    ? ({ willChange: 'transform', backfaceVisibility: 'hidden' } as object)
                    : null,
                ]}
                resizeMode="cover"
              />
            ) : renderError ? null : (
              <ActivityIndicator size="large" color="#fff" />
            )}
            {renderError && (
              <View
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: SP['6'],
                  right: SP['6'],
                  marginTop: -40,
                  padding: SP['4'],
                  backgroundColor: 'rgba(0,0,0,0.7)',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.2)',
                }}
                pointerEvents="none"
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 4 }}>
                  画像を表示できません
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                  HEIC 形式や巨大な写真は一部ブラウザで表示できない場合があります。別の写真を選び直してください。
                </Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      {/* フレーム外側を暗転 — 4 つの矩形で punch-out (中央配置) */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: maskOffsetV, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: maskOffsetV, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <View style={{ position: 'absolute', top: maskOffsetV, left: 0, width: maskOffsetH, height: frameH, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <View style={{ position: 'absolute', top: maskOffsetV, right: 0, width: maskOffsetH, height: frameH, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <View
          style={{
            position: 'absolute',
            top: maskOffsetV,
            left: maskOffsetH,
            width: frameW,
            height: frameH,
            borderRadius: frameRadius,
            borderWidth: 2,
            borderColor: 'rgba(255,255,255,0.85)',
          }}
        />
      </View>

      {/* 上左: 戻る (busy 中は無効化して二重 back を防ぐ) */}
      <View style={{ position: 'absolute', top: insets.top + SP['2'], left: SP['4'] }} pointerEvents="box-none">
        <PressableScale onPress={handleCancel} disabled={busy} haptic="tap" hitSlop={12}>
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : 1 }}>
            <Icon.arrowL size={28} color="#fff" strokeWidth={2.2} />
          </View>
        </PressableScale>
      </View>

      {/* rect: アスペクト切替チップ (下バーの少し上) */}
      {isRect && (
        <View
          style={{
            position: 'absolute',
            bottom: insets.bottom + SP['4'] + 64,
            left: 0,
            right: 0,
            flexDirection: 'row',
            justifyContent: 'center',
            gap: SP['2'],
            paddingHorizontal: SP['4'],
          }}
        >
          {ASPECT_CHIPS.map((chip) => {
            const active = aspectMode === chip.key;
            return (
              <PressableScale
                key={chip.key}
                onPress={() => handleAspect(chip.key)}
                haptic="tap"
                disabled={busy}
                accessibilityLabel={`アスペクト比 ${chip.label}`}
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: SP['3'],
                  paddingVertical: SP['2'],
                  borderRadius: 18,
                  backgroundColor: active ? C.accent : 'rgba(255,255,255,0.15)',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: active ? '800' : '600' }}>{chip.label}</Text>
              </PressableScale>
            );
          })}
        </View>
      )}

      {/* 下バー: (web ズーム±) + rotate + 決定 */}
      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + SP['4'],
          left: 0,
          right: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: SP['6'],
        }}
      >
        {Platform.OS === 'web' ? (
          <View style={{ flexDirection: 'row', gap: SP['2'] }}>
            <PressableScale
              onPress={() => zoomBy(1 / 1.25)}
              haptic="tap"
              disabled={busy}
              accessibilityLabel="縮小"
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', lineHeight: 24 }}>−</Text>
            </PressableScale>
            <PressableScale
              onPress={() => zoomBy(1.25)}
              haptic="tap"
              disabled={busy}
              accessibilityLabel="拡大"
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 22 }}>＋</Text>
            </PressableScale>
          </View>
        ) : (
          <View style={{ width: 80 }} />
        )}

        {/* 90° 回転 */}
        <PressableScale
          onPress={handleRotate}
          haptic="tap"
          disabled={busy || !imageSize}
          accessibilityLabel="90度回転"
          style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', opacity: !imageSize ? 0.5 : 1 }}
        >
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.2 }}>90°</Text>
        </PressableScale>

        {/* 決定 — 明確な CTA */}
        <PressableScale
          onPress={handleNext}
          haptic="confirm"
          disabled={busy || !imageSize}
          hitSlop={12}
          style={{
            paddingHorizontal: SP['5'],
            paddingVertical: SP['3'],
            minWidth: 100,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: busy ? 'rgba(255,255,255,0.15)' : C.accent,
            borderRadius: 24,
            opacity: !imageSize ? 0.5 : 1,
          }}
        >
          {busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>処理中…</Text>
            </View>
          ) : (
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 }}>
              {isRect ? '完了' : 'この範囲で決定'}
            </Text>
          )}
        </PressableScale>
      </View>
    </View>
  );
}
