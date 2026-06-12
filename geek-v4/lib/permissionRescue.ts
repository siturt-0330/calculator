// ============================================================
// permissionRescue — OS 権限拒否後の救済導線 (Apple HIG「Requesting Permission」)
// ============================================================
// 一度拒否された OS 権限 (通知 / 写真 / カメラ) はアプリから再プロンプトできない。
// HIG に従い「設定で許可できる」ことを案内し、設定アプリへ deep link する。
//
// - native: toast にアクション「設定を開く」を付けて Linking.openSettings() を呼ぶ
// - web: Linking.openSettings() が react-native-web に存在しないため、
//        ブラウザのサイト設定 (アドレスバーの鍵アイコン) を文言で案内するのみ
//
// 使い方 (permission denied の分岐で):
//   showPermissionRescue('写真へのアクセスが許可されていません');
// ============================================================

import { Linking, Platform } from 'react-native';
import { useToastStore } from '../stores/toastStore';
import { swallow } from './swallow';

// アクションボタン付き toast は「読む + 押す」時間が要るため通常より長めに表示する
const RESCUE_TOAST_MS = 6000;

/**
 * 権限拒否を伝えつつ設定への導線を出す toast。
 * @param deniedWhat 「〜が許可されていません」形の主文 (句点なし)
 */
export function showPermissionRescue(deniedWhat: string): void {
  const show = useToastStore.getState().show;
  if (Platform.OS === 'web') {
    // web には設定アプリへの deep link が無い — ブラウザ側の操作を案内する
    show(
      `${deniedWhat}。ブラウザのサイト設定 (アドレスバーの鍵アイコン) から変更してください`,
      'warn',
    );
    return;
  }
  show(`${deniedWhat}。設定アプリから変更できます`, 'warn', {
    undoLabel: '設定を開く',
    onUndo: () => {
      Linking.openSettings().catch((e) => swallow('permission.openSettings', e));
    },
    duration: RESCUE_TOAST_MS,
  });
}
