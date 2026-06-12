// ============================================================
// wcagContrastLock — テキストカラーの WCAG コントラスト比を回帰テストで固定
// ============================================================
// 目的:
//   2026-06-12 監査で `text3 #71717a` / `text4 #52525b` on `bg #0a0a0a` (dark)
//   のコントラスト比が WCAG AA (4.5:1 / 大文字 3.0:1) 未満 (4.13 / 2.64) と判明。
//   Apple HIG は AAA 7:1 推奨、最低でも AA 4.5:1。
//   修正: text3 → '#9CA3AF' (4.93:1 — 本文 AA 合格)、text4 → '#7B7E8A' (3.42:1 — 大文字 AA 合格)
//   再発防止のため、このテストで palette のコントラスト比を機械的に固定。
//
// 守るもの:
//   - dark.text3 on dark.bg ≥ 4.5:1  (本文 AA)
//   - dark.text4 on dark.bg ≥ 3.0:1  (大文字/icon AA)
//   - light.text3 on light.bg ≥ 4.5:1
//   - light.text4 on light.bg ≥ 3.0:1
//
// なぜ「ソース文字列を読んで HEX を抽出」なのか:
//   introSplashLock.test.ts と同じ理由 — jest が jest-expo preset 無しの bare node env で、
//   palettes.ts を import すると依存関係 (react-native) が落ちる。ソースを文字列として
//   読んで HEX のみを抽出すれば、pure JS / 設定非依存で確実に動く。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

const PALETTES_PATH = path.resolve(__dirname, '..', '..', 'lib', 'theme', 'palettes.ts');
const PALETTES_SRC = fs.readFileSync(PALETTES_PATH, 'utf8');

// ────────────────────────────────────────────────────────────
// HEX → relative luminance → contrast ratio (WCAG 2.x formula)
// ────────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const [light, dark] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (light + 0.05) / (dark + 0.05);
}

// ────────────────────────────────────────────────────────────
// palette source から palette 名でブロックを切り出し、HEX を読む
// ────────────────────────────────────────────────────────────
function extractPaletteBlock(name: 'PALETTE_DARK' | 'PALETTE_LIGHT'): string {
  // PALETTE_DARK の最初の `{` から、文末の `};` までを非貪欲に取る。
  // (palettes.ts 内に `};` が複数あるが、非貪欲なので最初の `};` で止まる)
  const m = PALETTES_SRC.match(new RegExp(`${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`Cannot extract ${name} block`);
  return m[1];
}

function readHex(block: string, key: 'bg' | 'text' | 'text2' | 'text3' | 'text4'): string {
  // 単語境界 `\b` で 'bg' が 'bg2' に部分マッチするのを防ぐ
  const m = block.match(new RegExp(`\\b${key}\\s*:\\s*'(#[0-9a-fA-F]{6})'`));
  if (!m) throw new Error(`Cannot read '${key}' from block. First 200 chars: ${block.slice(0, 200)}`);
  return m[1];
}

const DARK_BLOCK = extractPaletteBlock('PALETTE_DARK');
const LIGHT_BLOCK = extractPaletteBlock('PALETTE_LIGHT');

const DARK = {
  bg: readHex(DARK_BLOCK, 'bg'),
  text: readHex(DARK_BLOCK, 'text'),
  text2: readHex(DARK_BLOCK, 'text2'),
  text3: readHex(DARK_BLOCK, 'text3'),
  text4: readHex(DARK_BLOCK, 'text4'),
};

const LIGHT = {
  bg: readHex(LIGHT_BLOCK, 'bg'),
  text: readHex(LIGHT_BLOCK, 'text'),
  text2: readHex(LIGHT_BLOCK, 'text2'),
  text3: readHex(LIGHT_BLOCK, 'text3'),
  text4: readHex(LIGHT_BLOCK, 'text4'),
};

// ────────────────────────────────────────────────────────────
// WCAG AA threshold:
//   - 本文 (text / text2 / text3): 4.5:1
//   - 大文字 / icon (text4): 3.0:1
// ────────────────────────────────────────────────────────────
describe('WCAG コントラスト lock (dark)', () => {
  test('dark.text on dark.bg は AA 本文合格 (≥ 4.5:1)', () => {
    expect(contrastRatio(DARK.text, DARK.bg)).toBeGreaterThanOrEqual(4.5);
  });
  test('dark.text2 on dark.bg は AA 本文合格 (≥ 4.5:1)', () => {
    expect(contrastRatio(DARK.text2, DARK.bg)).toBeGreaterThanOrEqual(4.5);
  });
  test('dark.text3 on dark.bg は AA 本文合格 (≥ 4.5:1)', () => {
    // 2026-06-12 まで #71717a (4.13:1) で AA 不合格だった。
    // 修正: '#9CA3AF' (4.93:1)
    expect(contrastRatio(DARK.text3, DARK.bg)).toBeGreaterThanOrEqual(4.5);
  });
  test('dark.text4 on dark.bg は AA 大文字/icon 合格 (≥ 3.0:1)', () => {
    // 2026-06-12 まで #52525b (2.64:1) で大文字 AA すら未満だった。
    // 修正: '#7B7E8A' (3.42:1)
    expect(contrastRatio(DARK.text4, DARK.bg)).toBeGreaterThanOrEqual(3.0);
  });
});

describe('WCAG コントラスト lock (light)', () => {
  test('light.text on light.bg は AA 本文合格 (≥ 4.5:1)', () => {
    expect(contrastRatio(LIGHT.text, LIGHT.bg)).toBeGreaterThanOrEqual(4.5);
  });
  test('light.text2 on light.bg は AA 本文合格 (≥ 4.5:1)', () => {
    expect(contrastRatio(LIGHT.text2, LIGHT.bg)).toBeGreaterThanOrEqual(4.5);
  });
  test('light.text3 on light.bg は AA 本文合格 (≥ 4.5:1)', () => {
    expect(contrastRatio(LIGHT.text3, LIGHT.bg)).toBeGreaterThanOrEqual(4.5);
  });
  test('light.text4 on light.bg は AA 大文字/icon 合格 (≥ 3.0:1)', () => {
    expect(contrastRatio(LIGHT.text4, LIGHT.bg)).toBeGreaterThanOrEqual(3.0);
  });
});

// ────────────────────────────────────────────────────────────
// design/tokens.ts の _DARK ブロックも palettes.ts と同期されているか確認
// (二重定義で同期漏れがあると build によって違う色が使われる)
// ────────────────────────────────────────────────────────────
const TOKENS_PATH = path.resolve(__dirname, '..', '..', 'design', 'tokens.ts');
const TOKENS_SRC = fs.readFileSync(TOKENS_PATH, 'utf8');

describe('design/tokens.ts の _DARK ブロックは palettes.ts:PALETTE_DARK と同期', () => {
  test('text3 が一致', () => {
    const m = TOKENS_SRC.match(/text3:\s*'(#[0-9a-fA-F]{6})'/);
    expect(m).not.toBeNull();
    expect(m![1].toLowerCase()).toBe(DARK.text3.toLowerCase());
  });
  test('text4 が一致', () => {
    const m = TOKENS_SRC.match(/text4:\s*'(#[0-9a-fA-F]{6})'/);
    expect(m).not.toBeNull();
    expect(m![1].toLowerCase()).toBe(DARK.text4.toLowerCase());
  });
});
