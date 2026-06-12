import { useEffect, useState, useCallback } from 'react';
import { View, Text, Platform, Switch } from 'react-native';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';
import { swallow } from '../../lib/swallow';
import { showPermissionRescue } from '../../lib/permissionRescue';
import {
  pushSubscribe,
  pushUnsubscribe,
  isVapidConfigured,
  VAPID_PUBLIC_KEY,
  urlBase64ToUint8Array,
} from '../../lib/api/push';

// ============================================================
// 設定画面から呼び出す Web Push 切替トグル。
//
// - native (iOS/Android) では service worker が存在しないので非表示
// - ブラウザが Push 非対応なら情報行のみ表示
// - VAPID 公開鍵が未設定なら disabled (運営側未設定)
// ============================================================

type Status =
  | 'loading'           // 初期チェック中
  | 'unsupported'       // ブラウザ非対応
  | 'no-vapid'          // VAPID 鍵未設定
  | 'denied'            // 権限拒否
  | 'enabled'           // 購読済み
  | 'disabled';         // 未購読 (有効化可能)

const isWeb = Platform.OS === 'web';

// 型ナローイング用 (web のみのため、native ビルドでもクラッシュしないように guard)
function hasWebPushSupport(): boolean {
  if (!isWeb) return false;
  if (typeof window === 'undefined') return false;
  if (typeof navigator === 'undefined') return false;
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!hasWebPushSupport()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
    if (!reg) return null;
    return (await reg.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export function PushNotificationToggle() {
  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isWeb) {
      setStatus('unsupported');
      return;
    }
    if (!hasWebPushSupport()) {
      setStatus('unsupported');
      return;
    }
    if (!isVapidConfigured()) {
      setStatus('no-vapid');
      return;
    }
    const permission: NotificationPermission = Notification.permission;
    if (permission === 'denied') {
      setStatus('denied');
      return;
    }
    const sub = await getCurrentSubscription();
    setStatus(sub ? 'enabled' : 'disabled');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'disabled');
        // 拒否済みブラウザは requestPermission が無言で 'denied' を返すだけ (silent fail)。
        // web は Linking.openSettings() が無いのでサイト設定の変更手順を toast で案内する
        if (permission === 'denied') {
          showPermissionRescue('通知がブロックされています');
        }
        return;
      }
      const reg = await navigator.serviceWorker.register('/push-sw.js');
      // ready は activate を待つ
      await navigator.serviceWorker.ready;

      const appKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      if (appKey.length === 0) {
        setError('VAPID 鍵の解析に失敗しました');
        setStatus('no-vapid');
        return;
      }
      // applicationServerKey は BufferSource を受ける。Uint8Array の
      // ArrayBufferLike 型が DOM lib の ArrayBuffer 厳密マッチで弾かれるため、
      // 安全な BufferSource として渡すために .buffer を ArrayBuffer 化して渡す。
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appKey.buffer as ArrayBuffer,
      });
      const res = await pushSubscribe(sub);
      if (res.error) {
        setError(res.error);
        // 保存に失敗したら端末側もロールバック
        try { await sub.unsubscribe(); } catch (e) { swallow('push.unsubscribe.rollback', e); }
        setStatus('disabled');
        return;
      }
      setStatus('enabled');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '購読に失敗しました';
      setError(msg);
      // 既存購読の取り直し
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const sub = await getCurrentSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        try { await sub.unsubscribe(); } catch (e) { swallow('push.unsubscribe.device', e); }
        await pushUnsubscribe(endpoint);
      }
      setStatus('disabled');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '解除に失敗しました';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, []);

  // native では何も出さない (Expo Notifications 側で扱う)
  if (!isWeb) return null;

  const enabled = status === 'enabled';
  const disabledControl =
    status === 'loading' ||
    status === 'unsupported' ||
    status === 'no-vapid' ||
    status === 'denied' ||
    busy;

  const subText = (() => {
    switch (status) {
      case 'loading': return '確認中…';
      case 'unsupported': return 'このブラウザは Web Push に対応していません';
      case 'no-vapid': return '管理者がプッシュ通知を有効にしていません';
      case 'denied': return 'ブラウザで通知がブロックされています。アドレスバーの鍵アイコン → サイトの設定 → 通知 から許可し、ページを再読み込みしてください';
      case 'enabled': return 'このブラウザでお知らせを受け取ります';
      case 'disabled': return 'ブラウザを閉じていてもお知らせが届きます';
    }
  })();

  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: enabled ? C.accent : C.bg3,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon.bell
          size={22}
          color={enabled ? '#fff' : C.text3}
          strokeWidth={2.2}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[T.bodyM, { color: C.text, fontWeight: '700' }]}>
          プッシュ通知を受け取る
        </Text>
        <Text style={[T.caption, { color: C.text3, marginTop: 2 }]}>
          {subText}
        </Text>
        {error && (
          <Text style={[T.caption, { color: C.red, marginTop: 4 }]}>
            {error}
          </Text>
        )}
      </View>
      <Switch
        value={enabled}
        onValueChange={(v) => {
          if (v) void enable();
          else void disable();
        }}
        disabled={disabledControl}
        trackColor={{ false: C.bg4, true: C.accent }}
        thumbColor="#fff"
      />
    </View>
  );
}
