// ============================================================
// lib/photoEditorRender.ts — 写真エディタの描画エンジン (web canvas)
// ============================================================
// 純粋な座標計算 (containFit / screenToImage / hitTest) と、web 専用の
// canvas 描画 (renderEditor / buildPixelated / exportEditor) を提供する。
// 純関数部は DOM 非依存で Jest 検証可能。canvas 部は web (Platform.OS==='web') 限定で
// 実行時のみ document/canvas に触れる (import しても top-level で DOM を触らない)。
//
// 座標系: 全 op は「画像ピクセル座標」で保持する。表示は contain-fit で画面に収め、
//   描画時に image→canvas へ拡縮する。これにより回転を持たない単純な相似変換だけで
//   表示と出力 (フル解像度) が一致する (= WYSIWYG)。
// ============================================================

// ---- フィルタープリセット ----
export interface FilterPreset {
  id: string;
  label: string;
  css: string; // canvas ctx.filter 文字列 ('' = なし)
}

export const FILTERS: FilterPreset[] = [
  { id: 'none', label: 'なし', css: '' },
  { id: 'mono', label: 'モノクロ', css: 'grayscale(1)' },
  { id: 'sepia', label: 'セピア', css: 'sepia(0.75)' },
  { id: 'warm', label: '暖色', css: 'saturate(1.4) sepia(0.18) hue-rotate(-8deg)' },
  { id: 'cool', label: '寒色', css: 'saturate(1.2) hue-rotate(14deg) brightness(1.05)' },
  { id: 'bright', label: '明るく', css: 'brightness(1.18) contrast(1.05)' },
  { id: 'vivid', label: '鮮やか', css: 'saturate(1.7) contrast(1.08)' },
  { id: 'fade', label: 'フェード', css: 'contrast(0.85) brightness(1.1) saturate(0.82)' },
];

export function filterCssFor(id: string): string {
  return FILTERS.find((f) => f.id === id)?.css ?? '';
}

// ---- 描画ツールのプリセット ----
export const DRAW_COLORS = [
  '#FF3B30',
  '#FF9500',
  '#FFCC00',
  '#34C759',
  '#007AFF',
  '#AF52DE',
  '#FFFFFF',
  '#1A1A1A',
];

// 表示 px 基準のブラシ太さ (3 段階)
export const BRUSH_SIZES: { label: string; px: number }[] = [
  { label: '細', px: 6 },
  { label: '中', px: 14 },
  { label: '太', px: 26 },
];

// 写真スタンプ (絵文字)。視覚的な「シール」用途。
export const STAMP_EMOJIS = [
  '😂', '🥹', '😍', '🤣', '😎', '🥳', '😭', '😱', '🤔', '😤',
  '👍', '🙏', '👏', '🔥', '✨', '💯', '🎉', '❤️', '💛', '💜',
  '⭐', '🌈', '☀️', '🌸', '🍀', '⚡', '💥', '💢', '❓', '❗',
  '✅', '❌', '⭕', '➡️', '🎯', '🏆', '🐱', '🐶', '🍣', '☕',
];

// ---- op 型 ----
export interface StrokeOp {
  type: 'stroke';
  color: string;
  width: number; // 画像 px
  points: { x: number; y: number }[];
}
export interface MosaicOp {
  type: 'mosaic';
  width: number; // 画像 px (ブラシ径)
  points: { x: number; y: number }[];
}
export interface TextObj {
  type: 'text';
  text: string;
  color: string;
  x: number; // 画像 px (中心)
  y: number;
  size: number; // 画像 px (フォント高)
}
export interface StampObj {
  type: 'stamp';
  emoji: string;
  x: number; // 画像 px (中心)
  y: number;
  size: number; // 画像 px
}
export type EditorOp = StrokeOp | MosaicOp | TextObj | StampObj;

// ---- contain-fit 変換 (pure) ----
export interface FitTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
}

export function containFit(boxW: number, boxH: number, imgW: number, imgH: number): FitTransform {
  if (imgW <= 0 || imgH <= 0 || boxW <= 0 || boxH <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0, drawW: imgW, drawH: imgH };
  }
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  return { scale, offsetX: (boxW - drawW) / 2, offsetY: (boxH - drawH) / 2, drawW, drawH };
}

// フル解像度出力用の恒等変換 (scale=1, offset=0)
export function identityFit(imgW: number, imgH: number): FitTransform {
  return { scale: 1, offsetX: 0, offsetY: 0, drawW: imgW, drawH: imgH };
}

// 画面(canvas CSS px) → 画像 px
export function screenToImage(sx: number, sy: number, fit: FitTransform): { x: number; y: number } {
  return { x: (sx - fit.offsetX) / fit.scale, y: (sy - fit.offsetY) / fit.scale };
}
// 画像 px → 画面(canvas CSS px)
export function imageToScreen(ix: number, iy: number, fit: FitTransform): { x: number; y: number } {
  return { x: ix * fit.scale + fit.offsetX, y: iy * fit.scale + fit.offsetY };
}

// 全角(CJK/かな/絵文字等)は約 1.0em、半角は約 0.56em として文字幅を概算する。
// GEEK は日本語が主対象なので、全角を 0.6em 扱いにすると当たり判定/選択枠が
// 実際の文字より大幅に狭くなる (端タップで選択できない / 枠が文字にめり込む)。
function isWideChar(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK 部首・康熙・CJK 記号
    (cp >= 0x3041 && cp <= 0x33ff) || // ひらがな/カタカナ/CJK 記号
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 拡張A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 統合漢字
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || // ハングル音節
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 互換漢字
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // 全角形
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    cp >= 0x1f000 // 絵文字など (概ね幅広)
  );
}

export function estimateTextWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    em += isWideChar(ch.codePointAt(0) ?? 0) ? 1.0 : 0.56;
  }
  return em * size;
}

// テキスト/スタンプの当たり判定用 bounding box (画像 px)。中心 x,y。
export function objBounds(op: TextObj | StampObj): { x: number; y: number; w: number; h: number } {
  if (op.type === 'stamp') {
    const s = op.size;
    return { x: op.x - s / 2, y: op.y - s / 2, w: s, h: s };
  }
  // text: 字種を考慮した概算幅 (全角=1.0em / 半角=0.56em)
  const w = Math.max(op.size, estimateTextWidth(op.text, op.size));
  const h = op.size * 1.3;
  return { x: op.x - w / 2, y: op.y - h / 2, w, h };
}

// 当たり判定: 最前面 (配列後方) の text/stamp を優先して返す。無ければ -1。
export function hitTestObject(ops: EditorOp[], px: number, py: number, pad = 0): number {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (!op || (op.type !== 'text' && op.type !== 'stamp')) continue;
    const b = objBounds(op);
    if (px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad) {
      return i;
    }
  }
  return -1;
}

// ============================================================
// ↓ web 専用 (DOM canvas)。Platform.OS==='web' でのみ呼ぶこと。
// ============================================================

type AnyCanvas = HTMLCanvasElement;

// 画像をブロック化 (モザイク用の低解像度→等倍プレビュー元) して canvas を返す。
export function buildPixelated(img: CanvasImageSource, imgW: number, imgH: number, block = 0): AnyCanvas {
  const b = block > 0 ? block : Math.max(8, Math.round(Math.max(imgW, imgH) / 48));
  const smallW = Math.max(1, Math.round(imgW / b));
  const smallH = Math.max(1, Math.round(imgH / b));
  const small = document.createElement('canvas');
  small.width = smallW;
  small.height = smallH;
  const sctx = small.getContext('2d');
  if (sctx) {
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(img, 0, 0, smallW, smallH);
  }
  // 等倍 canvas にニアレストで拡大
  const full = document.createElement('canvas');
  full.width = imgW;
  full.height = imgH;
  const fctx = full.getContext('2d');
  if (fctx) {
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(small, 0, 0, smallW, smallH, 0, 0, imgW, imgH);
  }
  return full;
}

// 1 フレーム描画 (表示にも出力にも使う)。target ctx に fit で配置する。
export function renderEditor(
  ctx: CanvasRenderingContext2D,
  base: CanvasImageSource,
  pixelated: CanvasImageSource | null,
  ops: EditorOp[],
  filterId: string,
  fit: FitTransform,
): void {
  const TX = (ix: number) => ix * fit.scale + fit.offsetX;
  const TY = (iy: number) => iy * fit.scale + fit.offsetY;
  const SW = (w: number) => w * fit.scale;

  const css = filterCssFor(filterId);

  // ベース (フィルター適用)
  ctx.save();
  if (css) ctx.filter = css;
  ctx.drawImage(base, fit.offsetX, fit.offsetY, fit.drawW, fit.drawH);
  ctx.restore();

  for (const op of ops) {
    if (op.type === 'mosaic') {
      if (!pixelated) continue;
      ctx.save();
      ctx.beginPath();
      const r = Math.max(1, SW(op.width) / 2);
      for (const p of op.points) {
        const cx = TX(p.x);
        const cy = TY(p.y);
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.clip();
      // モザイクにもベースと同じフィルターを当てる (色フィルター時にブロックだけ
      // 元色で浮くのを防ぐ)。smoothing を切って表示/出力でブロック感を揃える。
      if (css) ctx.filter = css;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pixelated, fit.offsetX, fit.offsetY, fit.drawW, fit.drawH);
      ctx.restore();
    } else if (op.type === 'stroke') {
      if (op.points.length === 0) continue;
      ctx.save();
      ctx.strokeStyle = op.color;
      ctx.lineWidth = Math.max(1, SW(op.width));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const first = op.points[0]!;
      ctx.moveTo(TX(first.x), TY(first.y));
      if (op.points.length === 1) {
        // 1 点タップ → 点を打つ
        ctx.lineTo(TX(first.x) + 0.1, TY(first.y) + 0.1);
      } else {
        for (let i = 1; i < op.points.length; i++) {
          const p = op.points[i]!;
          ctx.lineTo(TX(p.x), TY(p.y));
        }
      }
      ctx.stroke();
      ctx.restore();
    } else if (op.type === 'text') {
      ctx.save();
      const fs = Math.max(8, SW(op.size));
      ctx.font = `700 ${fs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 視認性のための縁取り
      ctx.lineWidth = Math.max(2, fs * 0.14);
      ctx.strokeStyle = op.color === '#1A1A1A' || op.color === '#000000' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.55)';
      ctx.lineJoin = 'round';
      ctx.strokeText(op.text, TX(op.x), TY(op.y));
      ctx.fillStyle = op.color;
      ctx.fillText(op.text, TX(op.x), TY(op.y));
      ctx.restore();
    } else if (op.type === 'stamp') {
      ctx.save();
      const fs = Math.max(8, SW(op.size));
      ctx.font = `${fs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(op.emoji, TX(op.x), TY(op.y));
      ctx.restore();
    }
  }
}

// フル解像度で書き出して JPEG data URL を返す。
export function exportEditor(
  base: CanvasImageSource,
  pixelated: CanvasImageSource | null,
  ops: EditorOp[],
  filterId: string,
  imgW: number,
  imgH: number,
  quality = 0.9,
  maxEdge = 1600,
): string {
  // ★ 長辺を maxEdge に収める (downscale)。フル解像度のまま出すと、HEIC/巨大画像で
  //   前処理 1600px をすり抜けたソースのとき data URL が 5MB 超になり upload が失敗する。
  const longest = Math.max(imgW, imgH);
  const k = longest > maxEdge ? maxEdge / longest : 1;
  const outW = Math.max(1, Math.round(imgW * k));
  const outH = Math.max(1, Math.round(imgH * k));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('export: canvas 2d context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  renderEditor(ctx, base, pixelated, ops, filterId, { scale: k, offsetX: 0, offsetY: 0, drawW: outW, drawH: outH });
  const out = canvas.toDataURL('image/jpeg', quality);
  if (!out || !out.startsWith('data:image/') || out.length < 200) {
    throw new Error(`export: toDataURL が無効 (len=${out?.length ?? 0})`);
  }
  return out;
}
