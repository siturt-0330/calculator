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
import { View, Text, Dimensions, Image, StyleSheet, ActivityIndicator, Platform } from 'react-native';
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
import { cropImageOnWebCanvas, makeWebPreviewDataUrl } from '../lib/image';

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
  // ★ Web のみ: gesture 描画用の preview (低解像度) を別途生成。
  //   crop 計算は sourceUri の原寸 (imageSize) を使う。
  //   これにより iPhone の 4K 写真でも pan/pinch が滑らかになる。
  const [displayUri, setDisplayUri] = useState<string>(sourceUri);
  // ★「たまに cropper が真っ黒」事故の最終救命: displayUri (= preview data URL) が
  //   描画できなかった場合に sourceUri に巻き戻すフラグ. revert 後にもう一度 onError が
  //   発火したら本当に sourceUri も描画不能なのでエラー表示する.
  const [renderError, setRenderError] = useState(false);

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

  // unmount 時の safety: 「次へ」「戻る」を経由せずに画面が消えた場合 (例: ブラウザ back,
  // refresh, 他画面への deeplink 等) でも pending promise を必ず resolve(null) する。
  // これをやらないと caller の `await openCropper(...)` が永久 hang して
  // 「アイコン選択ボタンが反応しない」現象になる。
  useEffect(() => {
    return () => {
      resolveCropper(null);
    };
  }, []);

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

  // ★ Web: 大きな画像 (1024px 超) は preview にダウンサンプルして表示用に使う
  //    これで pan/pinch の体感が大幅に改善 (iPhone 4K 写真でフレームレート ~10fps → 50+fps)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!sourceUri) return;
    if (!imageSize) return;
    // 既に十分小さい画像なら preview 化不要 (data URL は触らない)
    if (imageSize.w <= 1024 && imageSize.h <= 1024) return;
    let alive = true;
    makeWebPreviewDataUrl(sourceUri, 1024)
      .then((url) => {
        if (!alive) return;
        // ★ 二重ガード: lib/image.ts 側でも検証済だが念のためここでも形を確認.
        //   壊れた data URL を setDisplayUri すると Image が真っ黒になる事故が起きる.
        if (!url || !url.startsWith('data:image/') || url.length < 200) {
          console.warn('[image-cropper] preview URL が無効 — sourceUri を維持:', url?.slice(0, 32));
          return;
        }
        setDisplayUri(url);
      })
      .catch((e) => {
        console.warn('[image-cropper] preview generation failed (continuing with raw uri):', e);
      });
    return () => {
      alive = false;
    };
  }, [sourceUri, imageSize]);

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

      let croppedUri: string | null = null;

      // ============================================================
      // Web パス: 純粋 Canvas API で crop (HEIC / 巨大画像 / blob revoke 全部回避)
      // ============================================================
      // 旧 manipulator パスは:
      //  - HEIC で失敗 → FileReader fallback が元画像を crop なしで返す重大バグ
      //  - blob URL の早期 revoke で fetch が「Load failed」
      // を引き起こしていた。Canvas API なら crop が必ず効く + revoke もない。
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
          });
          console.log('[image-cropper] canvas crop ok, dataUrl size:', croppedUri.length);
        } catch (canvasErr) {
          // Canvas でも失敗 = 画像が <img> で読めない (CORS / file format)
          console.warn('[image-cropper] canvas crop failed:', canvasErr);
          // 最終手段: FileReader で元 blob を data URL に (crop は失われる)
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
        // ============================================================
        // Native パス: ImageManipulator で crop
        // ============================================================
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

        try {
          const result = await ImageManipulator.manipulateAsync(sourceUri, actions, {
            compress: 0.85,
            format: ImageManipulator.SaveFormat.JPEG,
          });
          croppedUri = result.uri;
          console.log('[image-cropper] native manipulator ok:', result.uri);
        } catch (innerErr) {
          console.warn('[image-cropper] native manipulator failed, attempting center fallback:', innerErr);
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
            console.warn('[image-cropper] native fallback also failed:', fbErr);
            croppedUri = sourceUri;
          }
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
                // ★ Web では低解像度 preview を使用 (4K 写真 → 1024px へダウンサンプル済)
                //   crop 計算は元 sourceUri + imageSize の原寸座標系で正確に行うので、
                //   表示用と crop 用で URL を分離しても結果に影響しない。
                source={{ uri: displayUri }}
                onError={(e) => {
                  // ★ displayUri (preview data URL) が壊れている場合の救命処置.
                  //   iOS Safari / WKWebView の Canvas memory 不足や HEIC の
                  //   silent decode failure で「cropper の中身が真っ黒」になる事故を防ぐ.
                  const err = (e as { nativeEvent?: { error?: string } })?.nativeEvent?.error ?? 'unknown';
                  console.warn('[image-cropper] image render failed:', err, 'uri:', displayUri?.slice(0, 64));
                  if (displayUri !== sourceUri && sourceUri) {
                    // preview が壊れていた → 原画像 sourceUri に巻き戻し
                    console.warn('[image-cropper] reverting displayUri → sourceUri');
                    setDisplayUri(sourceUri);
                  } else {
                    // sourceUri 自体が render 不能 (HEIC を WebView がデコードできない等) → エラー表示
                    setRenderError(true);
                  }
                }}
                onLoad={() => {
                  // 一度成功したら error フラグ解除
                  if (renderError) setRenderError(false);
                }}
                style={[
                  { width: fitDims.fitW, height: fitDims.fitH },
                  imgAnimStyle,
                ]}
                resizeMode="cover"
              />
            ) : (
              <ActivityIndicator size="large" color="#fff" />
            )}
            {/* render error 時に明示メッセージを出す — 真っ黒で何も分からない状態を防ぐ */}
            {renderError && imageSize && (
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
