// ============================================================
// テーマモード store (system / light / dark)
// ------------------------------------------------------------
// 設計:
//   - zustand 1 store だけで完結 (provider 不要)
//   - 永続化は lib/storage の同期 wrapper (MMKV / localStorage)
//   - 起動時の hydrate を 1ms 以下で完了させる (cold start に乗らない)
//   - `mode = 'system'` の解決は `useResolvedTheme()` 側でやる (system が
//     変わったときに自動 re-render するため)
// ============================================================

import { create } from 'zustand';
import { useColorScheme as useRNColorScheme } from 'react-native';
import { getString, setString } from '../storage';
import { applyThemeC } from '../../design/tokens';
import { PALETTE_DARK, PALETTE_LIGHT } from './palettes';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'geek:theme:mode';

type ThemeState = {
  mode: ThemeMode;
  hydrated: boolean;
  /** MMKV / localStorage から同期で読み出す (App 起動時 1 回) */
  hydrate: () => void;
  /** ユーザー操作で切り替え。設定 UI から呼ぶ */
  setMode: (mode: ThemeMode) => void;
};

const VALID_MODES: ThemeMode[] = ['system', 'light', 'dark'];
function isValidMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && (VALID_MODES as string[]).includes(v);
}

export const useThemeStore = create<ThemeState>((set) => ({
  // 既存ユーザーを「いきなりライト化」させないために default は 'dark'。
  // 'system' default にすると iOS の light mode 端末で突然画面が真っ白になる。
  // ユーザーが明示的に 'system' を選んだ時だけシステム連動する。
  mode: 'dark',
  hydrated: false,
  hydrate: () => {
    try {
      const v = getString(STORAGE_KEY);
      set({ mode: isValidMode(v) ? v : 'dark', hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  setMode: (mode) => {
    set({ mode });
    try {
      setString(STORAGE_KEY, mode);
    } catch {
      /* swallow — 失敗しても in-memory には反映済 */
    }
  },
}));

/**
 * 現在の解決済みテーマ (light or dark).
 * `mode = 'system'` のときだけ RN の `useColorScheme()` 経由で OS 設定を読む。
 *
 * 注: `useRNColorScheme()` を常に呼ぶことで、system 設定変更 → React 再 render
 * が自動で走る。`mode !== 'system'` の場合は値を使わないだけで購読コストは無い。
 */
export function useResolvedTheme(): ResolvedTheme {
  const mode = useThemeStore((s) => s.mode);
  const system = useRNColorScheme();
  if (mode === 'system') {
    return system === 'light' ? 'light' : 'dark';
  }
  return mode;
}

/**
 * design/tokens の static C / GRAD を resolvedTheme に応じて hot-swap する。
 * _layout.tsx の useEffect 経由で呼ばれ、テーマ切替で全 193+ ファイル
 * (static `import { C }` の同期 importer) が一斉に追従する。
 *
 * 注: 値の書換だけでは React の再 render は走らないので、呼出元で
 * key remount (例: <View key={theme}> で全 tree 再構築) も併用する。
 */
export function syncStaticPaletteWithTheme(theme: ResolvedTheme): void {
  const palette = theme === 'light' ? PALETTE_LIGHT : PALETTE_DARK;
  applyThemeC(palette);
  // GRAD は LinearGradient の strict tuple 型と相性悪く mutable 化を断念。
  // brand 色 (primary / warm / success) は theme 非依存で OK、fadeBottom 等は
  // dark 固定で残る (light モード時に bottom fade が黒寄りになる小さな違和感は
  // 許容)。
}
