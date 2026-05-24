// ============================================================
// useAdminShortcut — dev-only Cmd/Ctrl+Shift+A で /admin へ飛ぶ
// ============================================================
// Web 限定 (Native では noop)。admin user (lib/admin.ts) のときだけ反応する。
// UI には一切痕跡を残さないので、知らないユーザーには無視される。
//
// 競合回避:
//   - input / textarea / contentEditable にフォーカスがあるときは無視
//     (検索バーで文字入力中に誤発火しないように)
//   - browser のデフォルトショートカット (Cmd+Shift+A など) と被るが、
//     こちらは preventDefault せずに併走させる (ブラウザ側の動作も尊重)
//     ※ "preventDefault しない" のが意図。誤発火しても無害。
//
// 隠し dev shortcut なので失敗時もログだけ、Toast は出さない。
// ============================================================
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { isAdminUser } from '../lib/admin';

export function useAdminShortcut() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!isAdminUser(user)) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd (mac) or Ctrl (win/linux) + Shift + A
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.shiftKey) return;
      if (e.key.toLowerCase() !== 'a') return;

      // 入力中フィールドにフォーカスがあるときは無視
      const active = (document.activeElement as HTMLElement | null);
      if (active) {
        const tag = active.tagName;
        const editable = active.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
      }

      // ここまで来たら admin が意図して叩いている → /admin へ
      try {
        router.push('/admin' as never);
      } catch (err) {
        // expo-router の動的型で push が落ちることがあるが silent fail で十分
        console.warn('[useAdminShortcut] router.push failed:', err);
      }
    };

    // capture=true で他の input handler より先に拾う (フォーカス除外は明示)
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [user, router]);
}
