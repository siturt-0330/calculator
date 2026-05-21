// ============================================================
// Circular image cropper screen — fullscreen modal-like
// ============================================================
// `openCropper(uri)` (lib/imageCropper.ts) からこの画面を push して、
// pan + pinch zoom + 90° rotate でユーザーが正方形 (円) に切り抜いた結果を
// resolveCropper() で resolve する設計。
//
// レイアウト:
//   - 全画面 黒背景
//   - 中央に円形マスク (周囲 55% 黒で暗転)
//   - 画像は pinch/pan で動かせて、円の中身が crop される
//   - 左上 ← 戻る / 右下 「次へ」 / 中央下 90° 回転
//
// crop の数学:
//   円の中身に映っているソース画像の領域を、現在の transform から逆算して
//   ImageManipulator.manipulateAsync に渡す。rotation は manipulator の
//   actions に積んで先に回転させ、その後の正方形 crop を計算する。
// ============================================================

import { useEffect, useState, useMemo } from 'react';
import { View, Text, Dimensions, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';
import { Icon } from '../constants/icons';
import { C, SP } from '../design/tokens';
import { PressableScale } from '../components/ui/PressableScale';
import { resolveCropper } from '../lib/imageCropper';

type Rotation = 0 | 90 | 180 | 270;

export default function ImageCropperScreen() {
  const params = useLocalSearchParams<{ uri?: string | string[] }>();
  const sourceUri =
    typeof params.uri === 'string' ? params.uri : Array.isArray(params.uri) ? params.uri[0] ?? '' : '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const cropDiameter = Math.min(screenW, screenH) * 0.75;

  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [busy, setBusy] = useState(false);

  // 動かす変数 — reanimated SharedValue で worklet スレッドからも触れる
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const rotationSv = useSharedValue(0);

  // uri が無ければ即 cancel して back
  useEffect(() => {
    if (!sourceUri) {
      resolveCropper(null);
      router.back();
    }
  }, [sourceUri, router]);

  // 自然画像サイズ取得 — Image.getSize は web/native 両対応
  useEffect(() => {
    if (!sourceUri) return;
    let alive = true;
    Image.getSize(
      sourceUri,
      (w, h) => {
        if (alive) setImageSize({ w, h });
      },
      (err) => {
        console.warn('[image-cropper] getSize failed:', err);
        if (alive) {
          resolveCropper(null);
          router.back();
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [sourceUri, router]);

  // cover-fit の dimensions (rotation 適用後の自然 aspect で考える)
  const fitDims = useMemo(() => {
    if (!imageSize) return null;
    // rotation 90/270 のときは画像の幅高が入れ替わる前提で fit する
    const swap = rotation === 90 || rotation === 270;
    const natW = swap ? imageSize.h : imageSize.w;
    const natH = swap ? imageSize.w : imageSize.h;
    const aspect = natW / natH;
    let fitW: number;
    let fitH: number;
    // cover: 小さい辺を cropDiameter に合わせる
    if (aspect >= 1) {
      fitH = cropDiameter;
      fitW = cropDiameter * aspect;
    } else {
      fitW = cropDiameter;
      fitH = cropDiameter / aspect;
    }
    return { fitW, fitH };
  }, [imageSize, rotation, cropDiameter]);

  // gestures
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          translateX.value = savedTranslateX.value + e.translationX;
          translateY.value = savedTranslateY.value + e.translationY;
        })
        .onEnd(() => {
          savedTranslateX.value = translateX.value;
          savedTranslateY.value = translateY.value;
        }),
    [translateX, translateY, savedTranslateX, savedTranslateY],
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((e) => {
          const next = savedScale.value * e.scale;
          scale.value = Math.max(0.5, Math.min(4, next));
        })
        .onEnd(() => {
          savedScale.value = scale.value;
        }),
    [scale, savedScale],
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture],
  );

  // animated image transform
  const imgAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotationSv.value}deg` },
    ],
  }));

  // 90° 回転 — pan/scale を reset (UX 的に大きく崩れるのを防ぐ)
  const handleRotate = () => {
    const next: Rotation = (((rotation + 90) % 360) as Rotation);
    setRotation(next);
    // 軽い transition で違和感を緩和
    rotationSv.value = withTiming(next, { duration: 180 });
    translateX.value = withTiming(0, { duration: 180 });
    translateY.value = withTiming(0, { duration: 180 });
    scale.value = withTiming(1, { duration: 180 });
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    savedScale.value = 1;
  };

  const handleCancel = () => {
    resolveCropper(null);
    router.back();
  };

  const handleNext = async () => {
    if (!imageSize || !fitDims || busy) return;
    setBusy(true);
    try {
      const { fitW, fitH } = fitDims;
      // 現在の transform 値 (gesture スレッドと共有)
      const sx = scale.value;
      const tx = translateX.value;
      const ty = translateY.value;

      // 画面上の描画サイズ (scale 後)
      const renderedW = fitW * sx;
      const renderedH = fitH * sx;

      // 画面中央が画像の center で、そこから translate
      const cx = screenW / 2 + tx;
      const cy = screenH / 2 + ty;
      const imgLeftOnScreen = cx - renderedW / 2;
      const imgTopOnScreen = cy - renderedH / 2;

      // 円の bounding rect (画面上)
      const cropLeftOnScreen = (screenW - cropDiameter) / 2;
      const cropTopOnScreen = (screenH - cropDiameter) / 2;

      // 画像 local 座標系での crop offset (rotation 後の image 寸法に対応)
      const offsetXOnImg = cropLeftOnScreen - imgLeftOnScreen;
      const offsetYOnImg = cropTopOnScreen - imgTopOnScreen;

      // rotation 適用後の自然サイズ (manipulator が rotate を先に処理するので
      // それに合わせて crop 座標を計算する)
      const swap = rotation === 90 || rotation === 270;
      const rotatedNatW = swap ? imageSize.h : imageSize.w;
      const rotatedNatH = swap ? imageSize.w : imageSize.h;

      // screen pixels → source pixels への倍率
      const srcPerScreenX = rotatedNatW / renderedW;
      const srcPerScreenY = rotatedNatH / renderedH;

      // crop rect (rotation 適用後の座標系)
      let cropX = offsetXOnImg * srcPerScreenX;
      let cropY = offsetYOnImg * srcPerScreenY;
      let cropW = cropDiameter * srcPerScreenX;
      let cropH = cropDiameter * srcPerScreenY;

      // clamp — 画像外には出さない、最低 16px 確保
      cropX = Math.max(0, Math.min(cropX, rotatedNatW - 16));
      cropY = Math.max(0, Math.min(cropY, rotatedNatH - 16));
      cropW = Math.max(16, Math.min(cropW, rotatedNatW - cropX));
      cropH = Math.max(16, Math.min(cropH, rotatedNatH - cropY));

      console.log('[image-cropper] crop rect:', { cropX, cropY, cropW, cropH, rotation, rotatedNatW, rotatedNatH });

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
      actions.push({ resize: { width: 512, height: 512 } });

      let croppedUri: string | null = null;
      try {
        const result = await ImageManipulator.manipulateAsync(sourceUri, actions, {
          compress: 0.85,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        croppedUri = result.uri;
        console.log('[image-cropper] manipulate ok:', result.uri);
      } catch (innerErr) {
        console.warn('[image-cropper] manipulateAsync failed, attempting center-square fallback:', innerErr);
        // フォールバック: 画像の中心を正方形 crop する (transform 情報は捨てる)
        const side = Math.min(rotatedNatW, rotatedNatH);
        const fallbackX = Math.round((rotatedNatW - side) / 2);
        const fallbackY = Math.round((rotatedNatH - side) / 2);
        try {
          const fb = await ImageManipulator.manipulateAsync(
            sourceUri,
            [
              ...(rotation !== 0 ? [{ rotate: rotation }] as ImageManipulator.Action[] : []),
              { crop: { originX: fallbackX, originY: fallbackY, width: side, height: side } },
              { resize: { width: 512, height: 512 } },
            ],
            { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
          );
          croppedUri = fb.uri;
        } catch (fbErr) {
          console.warn('[image-cropper] fallback also failed, using source as-is:', fbErr);
          // 最終 fallback: source をそのまま返す
          croppedUri = sourceUri;
        }
      }

      resolveCropper(croppedUri);
      router.back();
    } catch (e) {
      console.warn('[image-cropper] crop failed:', e);
      // クロップ失敗時もサーバ送信は成立させたい (UX 上「無反応」が最悪) ので source を返す
      resolveCropper(sourceUri || null);
      router.back();
    } finally {
      setBusy(false);
    }
  };

  // 円の bounding rect の四方を黒 55% で暗転 (中央は透過)
  const maskOffsetV = (screenH - cropDiameter) / 2;
  const maskOffsetH = (screenW - cropDiameter) / 2;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* 画像キャンバス */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <GestureDetector gesture={composedGesture}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { alignItems: 'center', justifyContent: 'center' },
            ]}
          >
            {imageSize && fitDims ? (
              <Animated.Image
                source={{ uri: sourceUri }}
                style={[
                  { width: fitDims.fitW, height: fitDims.fitH },
                  imgAnimStyle,
                ]}
                resizeMode="cover"
              />
            ) : (
              <ActivityIndicator size="large" color="#fff" />
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      {/* 円の外側を暗転 — 4 つの矩形で punch-out */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: maskOffsetV,
            backgroundColor: 'rgba(0,0,0,0.55)',
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: maskOffsetV,
            backgroundColor: 'rgba(0,0,0,0.55)',
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: maskOffsetV,
            left: 0,
            width: maskOffsetH,
            height: cropDiameter,
            backgroundColor: 'rgba(0,0,0,0.55)',
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: maskOffsetV,
            right: 0,
            width: maskOffsetH,
            height: cropDiameter,
            backgroundColor: 'rgba(0,0,0,0.55)',
          }}
        />
        {/* 円の枠 */}
        <View
          style={{
            position: 'absolute',
            top: maskOffsetV,
            left: maskOffsetH,
            width: cropDiameter,
            height: cropDiameter,
            borderRadius: cropDiameter / 2,
            borderWidth: 2,
            borderColor: 'rgba(255,255,255,0.85)',
          }}
        />
      </View>

      {/* 上左: 戻る */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + SP['2'],
          left: SP['4'],
        }}
        pointerEvents="box-none"
      >
        <PressableScale onPress={handleCancel} haptic="tap" hitSlop={12}>
          <View
            style={{
              width: 40,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon.arrowL size={28} color="#fff" strokeWidth={2.2} />
          </View>
        </PressableScale>
      </View>

      {/* 下バー: rotate + 次へ */}
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
        {/* spacer (左) — symmetry */}
        <View style={{ width: 80 }} />

        {/* 90° 回転 */}
        <PressableScale
          onPress={handleRotate}
          haptic="tap"
          disabled={busy}
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: 'rgba(255,255,255,0.15)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: '#fff',
              fontSize: 13,
              fontWeight: '700',
              letterSpacing: 0.2,
            }}
          >
            90°
          </Text>
        </PressableScale>

        {/* 次へ — 明確な CTA ボタン */}
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
              この範囲で決定
            </Text>
          )}
        </PressableScale>
      </View>
    </View>
  );
}
