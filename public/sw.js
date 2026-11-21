// Service worker для нагадувань. Сам push порожній: текст беремо з сервера.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let items = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const ep = sub ? encodeURIComponent(sub.endpoint) : '';
      const r = await fetch('/api/push/pending?ep=' + ep, { cache: 'no-store' });
      if (r.ok) items = await r.json();
    } catch (err) {}
    if (!items.length) items = [{ id: 'reminder', title: 'Нагадування', body: 'Відкрийте нотатки' }];
    for (const it of items) {
      await self.registration.showNotification(it.title || 'Нагадування', {
        body: it.body || '',
        tag: it.id,
        icon: '/icon-v8-180.png',
        badge: '/icon-v8-180.png',
        data: { id: it.id },
      });
    }
  })());
});

// натискання на сповіщення відкриває саму нотатку
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = (e.notification.data && e.notification.data.id) || '';
  const url = id && !id.startsWith('test-') && id !== 'reminder' ? '/#n=' + encodeURIComponent(id) : '/';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) {
        c.postMessage({ open: id });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
