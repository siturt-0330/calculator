// ============================================================
// useWebKeyboardInset — web (iOS Safari / Android Chrome) のソフトキーボード高さ追跡
// ============================================================
// 2026-06-13: 「コメント入力バーをキーボードと一体化してほしい (X 流)」対応。
//
// 背景:
//   react-native-web の KeyboardAvoidingView は **no-op** (キーボードを一切追跡しない)。
//   iOS Safari はキーボード表示時に visualViewport だけが縮み layout viewport は
//   そのままなので、flex 下端に置いた composer は「キーボードの裏」または
//   「Safari の自動スクロールで中途半端な位置」に取り残され、
//   home indicator 用の safe-area padding も残って間延びした隙間が出ていた。
//
// 仕組み:
//   visualViewport の resize / scroll を購読し、
//   「layout viewport 下端が visual viewport 下端からどれだけ隠れているか」
//   (≒ キーボードの高さ) を px で返す。
//     hidden = window.innerHeight − vv.height − vv.offsetTop
//   呼び出し側はこの値を composer の marginBottom 等に足すと、
//   バーがちょうどキーボード上端に貼り付く。
//
// native では常に 0 を返す (KeyboardAvoidingView が担当)。
// ============================================================
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function useWebKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return; // 旧ブラウザ: 追跡なし (従来挙動のまま degrade)

    let raf = 0;
    const update = () => {
      // rAF で 1 フレームに 1 回へ間引く (scroll イベントは高頻度)
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const hidden = window.innerHeight - vv.height - vv.offsetTop;
        // 60px 未満は Safari の URL バー伸縮等のノイズ → キーボード扱いしない
        setInset(hidden >= 60 ? Math.round(hidden) : 0);
      });
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
