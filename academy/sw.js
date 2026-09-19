// ProCoach OS Academy — service worker
// Handles two things only: receiving a push message and turning it into a
// visible notification, and reacting when someone taps that notification.
// Deliberately minimal — this is not an offline cache / asset-serving worker.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'ProCoach OS Academy', body: '' };
  if (event.data) {
    try { payload = event.data.json(); }
    catch (e) { payload = { title: 'ProCoach OS Academy', body: event.data.text() }; }
  }
  const options = {
    body: payload.body || '',
    data: { url: payload.url || './' },
    icon: './icon-512.png',
    // No badge set — Android expects a simple monochrome silhouette for
    // this specifically (it gets auto-tinted), and using the full-color
    // icon here would likely look worse than omitting it.
    tag: payload.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(payload.title || 'ProCoach OS Academy', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'push-notification-click', url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
