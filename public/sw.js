const CACHE = 'habits-v1';
const SHELL = ['/', '/app.js', '/styles.css', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// network-first for the app shell (so updates show up), never cache the API
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});

self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'Habit Tracker', body: '' };
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.forEach(c => c.postMessage('chime'))).then(() => self.registration.showNotification(d.title, {
    body: d.body, tag: d.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    actions: d.actions || [], data: d, renotify: true, requireInteraction: true,
    vibrate: [300, 150, 300, 150, 600], silent: false,
  })));
});

self.addEventListener('notificationclick', e => {
  const d = e.notification.data || {};
  e.notification.close();
  const url = e.action === 'done' ? d.doneUrl : e.action === 'skip' ? d.skipUrl : null;
  if (url) { e.waitUntil(fetch(url)); return; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) { c.postMessage('refresh'); return c.focus(); }
    return self.clients.openWindow(d.url || '/');
  }));
});
