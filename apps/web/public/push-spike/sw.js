// Spike service worker (T-0118). Registered by
// apps/web/public/push-spike/index.html only; not part of the app bundle.
// Shows whatever the decrypted Web Push payload carries, and opens the chat
// on click.

self.addEventListener('push', (event) => {
  let data = { title: 'New message', body: 'New message', chatId: '' };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data = { ...data, body: event.data.text() };
    }
  }
  const options = {
    body: data.body,
    tag: data.messageId ?? data.chatId,
    renotify: true,
    data: { chatId: data.chatId },
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;
  const url = chatId ? `/chat/${encodeURIComponent(chatId)}` : '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).pathname === url) {
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
