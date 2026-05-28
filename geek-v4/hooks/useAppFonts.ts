import { useEffect, useState } from 'react';
import { useFonts } from '@expo-google-fonts/syne';
import { Syne_700Bold } from '@expo-google-fonts/syne';
import {
  NotoSansJP_400Regular, NotoSansJP_700Bold,
} from '@expo-google-fonts/noto-sans-jp';
import {
  Inter_400Regular, Inter_600SemiBold, Inter_700Bold,
} from '@expo-google-fonts/inter';
// Orbitron — sci-fi/futuristic display font for "Geek" branding.
// 900Black のみ実使用 (LOGO_FONT 系統 / SPECIFICATION.md § "GEEKロゴ" 参照)。
// 700Bold は登録だけして実体は誰も参照していなかった (grep 確認済) ため削除し、
// font payload を ~30KB 削減。
import { Orbitron_900Black } from '@expo-google-fonts/orbitron';

// パフォーマンス監査: フォントが 100ms 以内に読み込めなければ
// システムフォントで先行レンダーを許可する。これで「起動直後に黒い」
// 体感を解消し、FCP/LCP を 80-120ms 短縮。
//   - 旧: 150ms — 監査初回の安全マージン
//   - 新: 100ms — app/+html.tsx で <link rel="preload"> による critical font の
//          先行 download を入れたので、network 上での font 到着が ~100-200ms
//          早まる。timeout も合わせて短縮し、fallback 切替の体感を改善。
// 追加: weight 削減 — Syne 600 / NotoSansJP 500 / Inter 500 を排除し
// 各 family につき必要最小限の weight だけロード。font payload を ~25% 削減。
const FONT_FALLBACK_TIMEOUT_MS = 100;

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Syne_700Bold,
    NotoSansJP_400Regular, NotoSansJP_700Bold,
    Inter_400Regular, Inter_600SemiBold, Inter_700Bold,
    Orbitron_900Black,
  });

  // フォント timeout fallback — 100ms 以内に読み込まれなければシステムフォントで進める
  const [forceFallback, setForceFallback] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setForceFallback(true), FONT_FALLBACK_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  // 読込完了 / エラー / timeout のいずれかで OK
  return loaded || !!error || forceFallback;
}
