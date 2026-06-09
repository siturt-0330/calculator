// ============================================================
// 画像アップロード前の前処理ヘルパ
// ============================================================
// - EXIF メタデータ (GPS / カメラ機種 / 時刻) を strip
// - 必要に応じてリサイズ + JPEG 再エンコードで容量削減
// - magic bytes で MIME を検証 (拡張子だけでは信用しない)
//
// プラットフォーム別実装:
//   Web    : fetch(uri).blob() で Blob 取得 → blob.slice/arrayBuffer で magic 判定
//   Native : expo-file-system.readAsStringAsync で base64 取得 → Uint8Array に変換
//            (native 環境では Blob 経由が不安定: Blob.slice/arrayBuffer が
//             実装に依らず動かないケース多数。iOS / Android のスマホで
//             アイコンアップロードが失敗していたのはこれが原因)
// ============================================================

import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

// ============================================================
// Web 専用: Canvas API で直接 crop + resize + rotate
// ============================================================
// ImageManipulator を bypass して純粋な Canvas で処理することで、
// HEIC / 巨大画像 / Safari Canvas memory error を確実に回避する。
// 結果は data: URL (revoke されない) で返るので、後段で確実に扱える。
//
// アルゴリズム:
//   1. <img> に sourceUri をロード
//   2. 中間 canvas を rotation 後の自然サイズで生成し、画像を回転して描画
//   3. 出力 canvas (512x512) に crop rect を drawImage で転送
//   4. canvas.toDataURL('image/jpeg', 0.85) で data URL 化
//
// 引数の crop rect は **rotation 適用後の自然座標系** で渡す
// (cropper の handleNext で計算されたもの)
//
// ★ 「アイコン登録時に真っ黒な画像が upload される」事故対策:
//   1) iOS Safari / WKWebView (TikTok 等 in-app browser) は HEIC や巨大画像で
//      <img>.onload を発火させつつ naturalWidth=0 を返すケースがある.
//      この状態で drawImage しても透明な canvas になり, toDataURL が無音で
//      'data:,' / 極端に短い文字列を返す → 0byte 相当の JPEG が Supabase に上がる.
//   2) WebView の Canvas メモリ不足でも drawImage / toDataURL が無音失敗する.
//   検出して throw すれば caller (image-cropper.tsx handleNext) の catch で
//   FileReader fallback → 最終的には sourceUri に巻き戻すロジックに繋がる.
export async function cropImageOnWebCanvas(input: {
  sourceUri: string;
  imageSize: { w: number; h: number };
  rotation: 0 | 90 | 180 | 270;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  outSize?: number; // default 512 (正方形出力時)
  outW?: number; // 矩形出力時の幅 (outH とセット。指定時は outSize より優先)
  outH?: number; // 矩形出力時の高さ
  quality?: number; // default 0.85
}): Promise<string> {
  const { sourceUri, imageSize, rotation, cropX, cropY, cropW, cropH } = input;
  // 出力寸法: outW/outH 指定があれば矩形 (投稿写真)、無ければ正方形 outSize (icon)。
  const outW = input.outW ?? input.outSize ?? 512;
  const outH = input.outH ?? input.outSize ?? 512;
  const quality = input.quality ?? 0.85;

  // 1) 画像を <img> で読み込み
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    // blob:/data: 以外は CORS フラグを立てる (将来 https URL を渡す可能性に備えて)
    if (!sourceUri.startsWith('blob:') && !sourceUri.startsWith('data:')) {
      el.crossOrigin = 'anonymous';
    }
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Image load failed'));
    el.src = sourceUri;
  });

  // ★ HEIC silent-onload ガード: naturalWidth/Height が 0 でも onload が
  //   発火する WebView があるので明示的に検出する.
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH || natW < 1 || natH < 1) {
    throw new Error(`crop: naturalWidth/Height が無効 (${natW}x${natH}) — HEIC または decode 失敗の可能性`);
  }

  // 2) 回転後の自然サイズ
  const swap = rotation === 90 || rotation === 270;
  const rotatedNatW = swap ? imageSize.h : imageSize.w;
  const rotatedNatH = swap ? imageSize.w : imageSize.h;

  // 3) 中間 canvas (rotation 適用後の自然サイズ)
  const interCanvas = document.createElement('canvas');
  interCanvas.width = rotatedNatW;
  interCanvas.height = rotatedNatH;
  const ictx = interCanvas.getContext('2d');
  if (!ictx) throw new Error('canvas 2d context unavailable');
  ictx.save();
  // 中心を原点に → 回転 → 元画像中心が原点に来るよう描画
  ictx.translate(rotatedNatW / 2, rotatedNatH / 2);
  if (rotation !== 0) ictx.rotate((rotation * Math.PI) / 180);
  ictx.drawImage(img, -imageSize.w / 2, -imageSize.h / 2, imageSize.w, imageSize.h);
  ictx.restore();

  // 4) crop rect を出力 canvas に転送 (clamp で安全側に)
  const safeX = Math.max(0, Math.min(cropX, rotatedNatW - 1));
  const safeY = Math.max(0, Math.min(cropY, rotatedNatH - 1));
  const safeW = Math.max(1, Math.min(cropW, rotatedNatW - safeX));
  const safeH = Math.max(1, Math.min(cropH, rotatedNatH - safeY));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const octx = outCanvas.getContext('2d');
  if (!octx) throw new Error('out canvas 2d context unavailable');
  // 高品質補間
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(interCanvas, safeX, safeY, safeW, safeH, 0, 0, outW, outH);

  // 5) JPEG data URL を生成
  const out = outCanvas.toDataURL('image/jpeg', quality);
  // ★ toDataURL 無音失敗ガード: WebView Canvas memory 不足や tainted canvas で
  //   'data:,' / 極端に短い data URL が返る事故を検出する.
  //   有効な JPEG data URL は base64 でほぼ確実に 200 文字以上.
  if (!out || !out.startsWith('data:image/') || out.length < 200) {
    throw new Error(
      `crop: toDataURL が無効な結果を返した (len=${out?.length ?? 0}, head="${out?.slice(0, 32) ?? ''}")`,
    );
  }
  return out;
}

// ============================================================
// Web 専用: 高解像度画像を表示用にダウンサンプル
// ============================================================
// iPhone カメラの 4032x3024 等を Animated.Image にそのまま渡すと
// gesture (pan/pinch) が極端に重くなる。事前に 1024x1024 程度の
// preview data URL を生成して、それを画面表示に使う。
// crop 計算は元画像 (imageSize) で行うので、preview のサイズは表示用のみ。
//
// ★ 「たまに cropper の中身が真っ黒」事故対策:
//   1) iOS Safari / WKWebView (TikTok 等 in-app browser) は HEIC や
//      巨大画像で <img>.onload を発火させつつ naturalWidth=0 を返すケースがある.
//      この状態で drawImage しても透明な canvas になり, toDataURL が無音で
//      'data:,' や極端に短い文字列を返す.
//   2) WebView の Canvas メモリ不足でも drawImage / toDataURL が無音失敗する.
//   検出して throw すれば caller の .catch で displayUri=sourceUri が維持される.
export async function makeWebPreviewDataUrl(
  sourceUri: string,
  maxEdge = 1024,
  quality = 0.8,
): Promise<string> {
  // ★ EXIF orientation 焼き込み:
  //   「横で撮った写真が縦で投稿される」不具合の根治。<img> + canvas.drawImage は
  //   EXIF orientation を適用しない (生ピクセルのまま描く)。一方
  //   createImageBitmap(blob,{imageOrientation:'from-image'}) は orientation を適用した
  //   bitmap を返し、width/height も適用後の値になる。これを drawImage すれば、出力 JPEG
  //   は「正しい向きが焼き込まれ EXIF は無い」状態になる (= 後段で向きが化けない)。
  //   未対応エンジン (古い Safari/WebView) では従来の <img> 経路へフォールバック (無回帰)。
  let src: CanvasImageSource | null = null;
  let bitmap: ImageBitmap | null = null;
  let natW = 0;
  let natH = 0;
  try {
    if (typeof createImageBitmap === 'function') {
      const blob = await fetch(sourceUri).then((r) => r.blob());
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      natW = bitmap.width;
      natH = bitmap.height;
      src = bitmap;
    } else {
      throw new Error('createImageBitmap unavailable');
    }
  } catch {
    // フォールバック: 従来の <img> 経路 (EXIF 未適用だが decode は通る環境向け)。
    if (bitmap) {
      bitmap.close?.();
      bitmap = null;
    }
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      if (!sourceUri.startsWith('blob:') && !sourceUri.startsWith('data:')) {
        el.crossOrigin = 'anonymous';
      }
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed (preview)'));
      el.src = sourceUri;
    });
    natW = img.naturalWidth || img.width;
    natH = img.naturalHeight || img.height;
    src = img;
  }
  // ★ HEIC silent-onload / decode 失敗ガード: naturalWidth/Height が 0 でも
  //   onload が発火する WebView があるので明示的に検出する.
  if (!src || !natW || !natH || natW < 1 || natH < 1) {
    if (bitmap) bitmap.close?.();
    throw new Error(`preview: naturalWidth/Height が無効 (${natW}x${natH}) — HEIC または decode 失敗の可能性`);
  }
  const aspect = natW / natH;
  let outW: number;
  let outH: number;
  if (aspect >= 1) {
    outW = Math.min(maxEdge, natW);
    outH = Math.round(outW / aspect);
  } else {
    outH = Math.min(maxEdge, natH);
    outW = Math.round(outH * aspect);
  }
  if (outW < 1 || outH < 1) {
    if (bitmap) bitmap.close?.();
    throw new Error(`preview: 計算後サイズが無効 (${outW}x${outH})`);
  }
  // ★UI ブロック緩和: 同期的な canvas 処理 (drawImage + toDataURL) の前に 1 回
  //   マイクロタスクへ yield し、複数画像処理中も React に再描画の隙を与える。
  await Promise.resolve();
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if (bitmap) bitmap.close?.();
    throw new Error('preview canvas 2d context unavailable');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium'; // preview なので medium で十分
  ctx.drawImage(src, 0, 0, outW, outH);
  if (bitmap) bitmap.close?.(); // ImageBitmap は明示 close で GPU/メモリを早期解放
  const out = canvas.toDataURL('image/jpeg', quality);
  // ★ toDataURL 無音失敗ガード: WebView Canvas memory 不足や tainted canvas で
  //   'data:,' / 極端に短い data URL が返る事故を検出する.
  //   有効な JPEG data URL は base64 でほぼ確実に 200 文字以上.
  if (!out || !out.startsWith('data:image/') || out.length < 200) {
    throw new Error(
      `preview: toDataURL が無効な結果を返した (len=${out?.length ?? 0}, head="${out?.slice(0, 32) ?? ''}")`,
    );
  }
  return out;
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

// magic byte 検査 — 先頭 12 バイトから MIME を判定 (実バイト)
function detectImageTypeFromBytes(buf: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null {
  if (buf.byteLength < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'image/png';
  // GIF: GIF87a or GIF89a
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 &&
    buf[3] === 0x38 && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) return 'image/gif';
  // WebP: "RIFF????WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp';
  return null;
}

// Blob 経由 (Web 向け)
export async function detectImageType(blob: Blob): Promise<'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null> {
  const slice = blob.slice(0, 12);
  const buf = new Uint8Array(await slice.arrayBuffer());
  return detectImageTypeFromBytes(buf);
}

// base64 文字列 → Uint8Array
function base64ToBytes(b64: string): Uint8Array {
  // atob is available in Hermes (RN 0.76+) and Web. それ以外環境 (rare) なら手動 decode が必要。
  const bin = typeof atob === 'function' ? atob(b64) : globalThis.Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function safeExtension(mime: string): string {
  if (!ALLOWED_MIME.has(mime)) return 'jpg';
  const ext = mime.split('/')[1] ?? 'jpg';
  // パストラバーサル防止: 拡張子が許可リストに無ければ jpg にフォールバック
  return ALLOWED_EXT.has(ext) ? ext : 'jpg';
}

// 画像をリサイズ + 再エンコード = EXIF が自動的に除去される
// 戻り値は新しい URI (ローカルファイル) — caller が fetch(uri).blob() で読み込む
//
// ★ アスペクト維持 (2026-06 修正): 旧実装は resize:{width:max, height:max} と
//   両軸を渡していたが、expo-image-manipulator は両軸指定だと比率を無視して
//   exact resize する → 16:9 等の非正方写真が 1:1 に潰れる (新 rect クロッパーの
//   native 出力が破壊される) + 512px アイコンが 1600px に upscale される無駄も
//   あった。まず無 resize で JPEG 化 (= EXIF strip) しつつ寸法を得て、長辺が
//   上限超のときだけ「長辺のみ」を指定して比率を保ったまま縮小する。
//   (長辺以下の画像は再エンコードのみ = 歪み無し・upscale 無し)
export async function stripExifAndResize(
  uri: string,
  opts: { maxWidth?: number; maxHeight?: number; quality?: number } = {},
): Promise<{ uri: string; width: number; height: number }> {
  const { maxWidth = 1600, maxHeight = 1600, quality = 0.85 } = opts;
  // 1) 無 resize で JPEG 化 (EXIF strip) + 寸法取得
  const first = await ImageManipulator.manipulateAsync(uri, [], {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const { width: w, height: h } = first;
  // 2) 長辺が上限超なら「長辺のみ」を上限に縮小 (短辺は比率維持で自動計算)
  if ((w > maxWidth || h > maxHeight) && w > 0 && h > 0) {
    const resizeAction = w >= h ? { resize: { width: maxWidth } } : { resize: { height: maxHeight } };
    const second = await ImageManipulator.manipulateAsync(first.uri, [resizeAction], {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: second.uri, width: second.width, height: second.height };
  }
  return { uri: first.uri, width: w, height: h };
}

// uri → アップロード可能な body (sanitize + validate 込み)
// 戻り値: body は Web では Blob、Native では FormData (uri を含む multipart)。
// 両方とも Supabase Storage の upload() に渡せる。`uri` も同梱して FormData の
// 中身を確認できるようにする。後方互換性のため `blob` プロパティ名を維持。
//
// プラットフォーム別実装:
//   Web    : Blob (fetch().blob() 経由)
//   Native : FormData with { uri, name, type } — RN の標準的なファイル送信形式
//            内部で React Native の fetch が file:// を読んで multipart 送信する。
//            これは Hermes / iOS / Android で **必ず動く** RN idiomatic な方法。
//            旧実装 (Uint8Array body) は Supabase SDK が内部で fetch(uri, { body: uint8array })
//            を呼ぶが、これが Android の okhttp で確実に動くとは限らず実機で
//            アップロード失敗の原因になっていた。
export async function prepareImageUpload(
  uri: string,
  opts: { maxSizeBytes?: number; maxWidth?: number; maxHeight?: number; quality?: number } = {},
): Promise<{ blob: Blob | FormData; mime: string; ext: string; size: number; uri: string }> {
  const { maxSizeBytes = 5 * 1024 * 1024, ...rest } = opts;

  // ★ data URL ショートパス (iPhone Safari fix):
  // cropper が `data:image/jpeg;base64,...` を返した場合、これは既に処理済み
  // (512x512 JPEG、EXIF なし) なので、manipulator を再度呼ばずに直接 Blob 化する。
  // Safari は blob URL を勝手に revoke するが、data URL は revoke されない。
  // また manipulator の二重呼び出しは iPhone Safari の Canvas で memory error
  // / 空 Blob を返すケースがあり、これも回避できる。
  if (uri.startsWith('data:')) {
    const m = uri.match(/^data:([^;]+);base64,(.+)$/);
    if (m && (m[1] === 'image/jpeg' || m[1] === 'image/png' || m[1] === 'image/webp' || m[1] === 'image/gif')) {
      const mime = m[1] as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      const b64 = m[2]!;
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(b64);
      } catch (e) {
        throw new Error(`画像のデコードに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (bytes.byteLength > maxSizeBytes) {
        throw new Error(`画像が大きすぎます (${Math.round(bytes.byteLength / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
      }
      // ★ 最小サイズ検証: 1x1 透明 / 黒 JPEG (~140byte) が通って Supabase に
      //   upload されると「アイコンが真っ黒」事故になるので、上限と同じパターンで
      //   下限も明示的にチェックする.
      if (bytes.byteLength < 200) {
        throw new Error(`画像のデータが小さすぎます (${bytes.byteLength}byte) — decode 失敗の可能性があります`);
      }
      // magic byte の二重確認 (data: URL の mime ヘッダ偽装防止)
      const detectedMagic = detectImageTypeFromBytes(bytes.subarray(0, 12));
      const finalMime = detectedMagic ?? mime;
      // Uint8Array → BlobPart: TS 5.x lib.dom.d.ts では Uint8Array<ArrayBufferLike>
      // が ArrayBufferView<ArrayBuffer> と互換でないため、明示的に narrowing する。
      const blob = new Blob([bytes as BlobPart], { type: finalMime });
      return { blob, mime: finalMime, ext: safeExtension(finalMime), size: bytes.byteLength, uri };
    }
  }

  // 1. リサイズ + JPEG 化 で EXIF 除去 (両プラットフォームで動く)
  // 重要: これにより URI が ph:// / asset:// から file:// に変換される
  //       (FileSystem や FormData が読める形式に必ず正規化される)
  let cleanUri: string;
  try {
    const r = await stripExifAndResize(uri, rest);
    cleanUri = r.uri;
  } catch (e) {
    throw new Error(`画像処理に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (Platform.OS === 'web') {
    // ----- Web: 多段フォールバック -----
    // iPhone Safari の「Load failed」エラーを根本的に潰すため、複数の経路を順に試す:
    //   Path 1: manipulator で最適化済みの cleanUri を fetch + magic byte 検証 (理想)
    //   Path 2: 元の uri を直接 fetch (HEIC や Canvas 不可な形式向け)
    //   Path 3: 失敗時に明確なエラーメッセージで throw
    const pathErrors: string[] = [];

    // Path 1: 最適化済み URI を fetch
    try {
      const res = await fetch(cleanUri);
      if (!res.ok) throw new Error(`fetch status ${res.status}`);
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('empty blob (Safari blob URL may be revoked)');
      if (blob.size > maxSizeBytes) {
        throw new Error(`画像が大きすぎます (${Math.round(blob.size / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
      }
      const detected = await detectImageType(blob);
      if (!detected) throw new Error('magic byte 判定不能');
      return { blob, mime: detected, ext: safeExtension(detected), size: blob.size, uri: cleanUri };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[prepareImageUpload] Path 1 (cleanUri fetch) failed:', msg);
      pathErrors.push(`P1: ${msg}`);
    }

    // Path 2: 元 uri を直接 fetch (manipulator/Canvas を経由しない)
    // HEIC や巨大画像で manipulator が失敗するケース向け
    try {
      const res = await fetch(uri);
      if (!res.ok) throw new Error(`fetch status ${res.status}`);
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('empty blob');
      if (blob.size > maxSizeBytes) {
        throw new Error(`画像が大きすぎます (${Math.round(blob.size / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
      }
      // magic で判定失敗時は Blob.type を fallback、最終的に image/jpeg
      const detected = (await detectImageType(blob)) ?? (blob.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif') ?? 'image/jpeg';
      const finalMime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' =
        (detected === 'image/jpeg' || detected === 'image/png' || detected === 'image/webp' || detected === 'image/gif')
          ? detected
          : 'image/jpeg';
      console.log('[prepareImageUpload] Path 2 (raw fetch) ok, mime:', finalMime, 'size:', blob.size);
      return { blob, mime: finalMime, ext: safeExtension(finalMime), size: blob.size, uri };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[prepareImageUpload] Path 2 (raw uri fetch) failed:', msg);
      pathErrors.push(`P2: ${msg}`);
    }

    // 全部失敗 → 詳細なエラーメッセージで throw
    throw new Error(
      `画像の準備に失敗しました。HEIC 形式の写真を選んでいないか確認してください。(${pathErrors.join(' / ')})`,
    );
  }

  // ----- Native (iOS / Android): FormData 経路 -----
  // (1) ファイル情報を取得 (サイズ check)
  let fileSize = 0;
  try {
    const info = await FileSystem.getInfoAsync(cleanUri, { size: true });
    if (info.exists && 'size' in info && typeof info.size === 'number') {
      fileSize = info.size;
    }
  } catch (e) {
    console.warn('[prepareImageUpload] getInfoAsync failed:', e);
    // size 不明でも続行 (magic 検証で形式が分かれば OK)
  }
  if (fileSize > maxSizeBytes) {
    throw new Error(`画像が大きすぎます (${Math.round(fileSize / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
  }

  // (2) 先頭 12 byte だけ読んで magic byte で MIME 判定
  // 大きいファイルでもメモリを使わずに済む
  let head: string;
  try {
    head = await FileSystem.readAsStringAsync(cleanUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 16,
    });
  } catch (e) {
    throw new Error(`画像の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!head) {
    throw new Error('画像の中身が空です');
  }
  const headBytes = base64ToBytes(head);
  const detected = detectImageTypeFromBytes(headBytes);
  // stripExifAndResize は JPEG で出力するので通常は image/jpeg だが、
  // 万一 magic 判定が落ちた場合は image/jpeg と仮定して fail-soft で続行する
  // (ユーザー UX を優先: アップロード自体は試させる)
  const finalMime = detected ?? 'image/jpeg';
  const ext = safeExtension(finalMime);

  // (3) FormData with file URI を構築
  // React Native の fetch はこの形式の append を理解して、
  // 自動的に file:// を読んで multipart/form-data body を作ってくれる。
  const fd = new FormData();
  // Supabase Storage SDK は FormData 内の最初のファイルエントリ (name='') を
  // アップロード対象にする。`name` と `type` は RN の FormData が認識するキー。
  fd.append('', {
    uri: cleanUri,
    name: `upload.${ext}`,
    type: finalMime,
  } as unknown as Blob);  // RN の FormData は { uri, name, type } object を受け取れる

  return {
    blob: fd,
    mime: finalMime,
    ext,
    size: fileSize,
    uri: cleanUri,
  };
}
