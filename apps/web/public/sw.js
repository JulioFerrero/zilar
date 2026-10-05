// Zilar service worker (T-0119). Hand-written, no build plugin: this file
// ships verbatim from `public/` and must stay dependency-free (no imports)
// so it runs as-is in every browser.
//
// What it does:
// - `push`: decrypts (the platform does it) and shows the server's payload
//   as `{ title, body, chatId }`. The server already applied mute, private
//   topic visibility and the previews setting before sending.
// - `notificationclick`: focuses the chat's window or opens `/c/<chatJid>`.
// - navigation fallback: an offline page for failed navigations only. API
//   and WebSocket traffic is never cached or intercepted.
//
// The pure decision bits (`notificationFor`, `clickUrlFor`) are top-level
// functions so the unit tests can drive them with fakes (see
// `src/lib/serviceWorker.test.ts`, which stubs `self` and imports this
// file).

const OFFLINE_CACHE = 'zilar-offline-v1';

function notificationFor(data) {
  const title = typeof data?.title === 'string' && data.title !== '' ? data.title : 'New message';
  const body = typeof data?.body === 'string' && data.body !== '' ? data.body : 'New message';
  const chatId = typeof data?.chatId === 'string' ? data.chatId : undefined;
  const tag =
    typeof data?.messageId === 'string' && data.messageId !== '' ? data.messageId : chatId;
  const options = { body, data: {} };
  if (tag !== undefined) {
    options.tag = tag;
    options.renotify = true;
  }
  if (chatId !== undefined) {
    options.data.chatId = chatId;
  }
  return { title, options };
}

// Dismissal contract (shared with `dismissChatNotifications` in
// `src/lib/push.ts`): the tag is per-message (`messageId`, falling back to
// the chat id), so one `getNotifications()` call can never enumerate a
// chat's notifications by tag. Dismissal therefore enumerates all visible
// notifications and closes the ones whose `data.chatId` matches. Both sides
// pin this: `serviceWorker.test.ts` drives the real `sw.js` show path and
// asserts `data.chatId` is set; `push.test.ts` asserts the dismiss side
// matches on `data.chatId`.

function clickUrlFor(chatId) {
  return chatId !== undefined && chatId !== '' ? `/c/${encodeURIComponent(chatId)}` : '/';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add('/offline.html'))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== OFFLINE_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('push', (event) => {
  let data;
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      try {
        data = { title: 'New message', body: event.data.text() };
      } catch {
        data = undefined;
      }
    }
  }
  const { title, options } = notificationFor(data);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;
  const url = clickUrlFor(chatId);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        try {
          if (new URL(client.url).pathname === url) {
            await client.focus();
            return;
          }
        } catch {
          // An unparsable client URL is never a match; keep looking.
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// Navigation fallback only: a failed page load shows the offline page. Every
// other request (API, WebSocket, assets) passes through untouched.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode !== 'navigate') {
    return;
  }
  event.respondWith(
    fetch(request).catch(() =>
      caches.match('/offline.html').then((cached) => cached ?? Response.error()),
    ),
  );
});
