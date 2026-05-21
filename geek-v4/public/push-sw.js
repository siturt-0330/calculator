// ============================================================
// Geek v4 — Web Push Service Worker
// ============================================================
// /push-sw.js として serve される。Expo は `public/` を静的配信。
// クライアント側 (PushNotificationToggle) から register される。
//
// 送られてくる push payload (edge function: send-push) の形:
//   { title: string, body: string, url?: string, tag?: string }
// ============================================================

/* eslint-disable no-restricted-globals */
self.addEventListener('install', () => {
  // 新バージョンを即時アクティブ化
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 既存タブを即時 claim
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    // text fallback
    try {
      data = { title: 'Geek', body: event.data ? event.data.text() : '' };
    } catch (_e2) {
      data = {};
    }
  }

  const title = data.title || 'Geek';
  const options = {
    body: data.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: data.tag || 'geek-notification',
    data: data.url || '/',
    // 同じ tag で再通知された場合は古い方を置き換え
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification && event.notification.data) || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // 既に開いているタブがあればフォーカス + そこへナビゲート
      for (const client of allClients) {
        if ('focus' in client) {
          try {
            await client.focus();
            if ('navigate' in client) {
              try { await client.navigate(targetUrl); } catch (_e) {}
            }
            return;
          } catch (_e) {}
        }
      }
      // どのタブも開いていなければ新規ウィンドウ
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
