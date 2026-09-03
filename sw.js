const CACHE = 'flow-world-v2';
const ASSETS = [
  '/', '/index.html', '/app.js', '/styles.css',
  '/manifest.json',
  '/Icons/star.png', '/Icons/books-stack-of-three.png', '/Icons/open-book.png',
  '/Icons/bookexplore.png', '/Icons/user.png', '/Icons/user1.png',
  '/Icons/google.png', '/Icons/facebook.png', '/Icons/twitter1.png',
  '/Icons/app.png', '/Icons/app1.png',
  '/Icons/book.png', '/Icons/view.png', '/Icons/fire.png', '/Icons/fire-flame.png',
  '/Icons/icons8-check-mark-50.png', '/Icons/icons8-logout-50.png',
  '/Icons/flames.png', '/Icons/inbox.png', '/Icons/help.png', '/Icons/theme.png',
  '/Icons/bin.png', '/Icons/editpen.png', '/Icons/person-plus.png',
  '/Icons/graph.png', '/Icons/settings.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all(
      caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (request.url.includes('/api/')) return;

  const isShell = ['/index.html', '/app.js', '/styles.css', '/', '/manifest.json'].some(p => {
    const u = new URL(request.url);
    return u.pathname === p || u.pathname.toLowerCase().endsWith(p);
  });

  if (isShell) {
    // Network-first for the app shell so fixes always reach the browser on the
    // next online load, falling back to the cached copy when offline.
    e.respondWith(
      fetch(request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(request).then(r => r || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Cache-first for static assets (icons, images).
  e.respondWith(
    caches.match(request).then(r => r || fetch(request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => new Response('Offline', { status: 503 })))
  );
});
