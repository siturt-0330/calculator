// ============================================================
// useReduceTransparency — OS の「透明度を下げる」設定を購読
// ------------------------------------------------------------
// Apple HIG の整理 (Obsidian: Apple Liquid Glass 設計言語 §4):
//   - Reduce Motion が無効化するのは「弾性アニメ・大きな移動」であって、
//     scroll に 1:1 追従する opacity 補間は motion ではない。
//   - blur / 透過をやめて不透明にするのは Reduce Transparency の役目。
//     → frosted glass 系 UI (TopBar 等) はこの hook が true のとき
//       BlurView / backdrop-filter をやめて不透明背景に fallback する。
//
// platform 挙動:
//   - iOS: AccessibilityInfo.isReduceTransparencyEnabled() の初期読み +
//     'reduceTransparencyChanged' イベント購読
//   - web: matchMedia('(prefers-reduced-transparency: reduce)') が
//     実装されていれば購読 (Safari 16.4+ / Chrome 118+)。無ければ false
//   - Android 等 API が undefined の platform は安全に false 固定
// ============================================================
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { swallow } from '../lib/swallow';

export function useReduceTransparency(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // ----- web: prefers-reduced-transparency media query -----
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return;
      }
      try {
        const mq = window.matchMedia('(prefers-reduced-transparency: reduce)');
        // media query 自体を解釈できないブラウザは matches=false のまま (= 透過 OK)
        setEnabled(mq.matches);
        const onChange = (e: MediaQueryListEvent) => setEnabled(e.matches);
        if (typeof mq.addEventListener === 'function') {
          mq.addEventListener('change', onChange);
          return () => mq.removeEventListener('change', onChange);
        }
        // 旧 Safari (< 14) は MediaQueryList が addListener しか持たない
        if (typeof mq.addListener === 'function') {
          mq.addListener(onChange);
          return () => mq.removeListener(onChange);
        }
      } catch (e) {
        swallow('a11y.reduceTransparency.web', e);
      }
      return;
    }

    // ----- native: AccessibilityInfo (実装は iOS のみ。他 platform は undefined → false) -----
    let mounted = true;
    try {
      const read = AccessibilityInfo.isReduceTransparencyEnabled;
      if (typeof read !== 'function') return; // Android 等: API 無し → false 固定
      read
        .call(AccessibilityInfo)
        .then((v: boolean) => {
          if (mounted) setEnabled(Boolean(v));
        })
        .catch((e: unknown) => swallow('a11y.reduceTransparency.read', e));
      const sub = AccessibilityInfo.addEventListener(
        'reduceTransparencyChanged',
        (v: boolean) => setEnabled(Boolean(v)),
      );
      return () => {
        mounted = false;
        sub?.remove?.();
      };
    } catch (e) {
      swallow('a11y.reduceTransparency.subscribe', e);
      return () => {
        mounted = false;
      };
    }
  }, []);

  return enabled;
}
