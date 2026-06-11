const CACHE = 'flow-world-v1';
const ASSETS = [
  '/', '/index.html', '/app.js', '/styles.css',
  '/manifest.json',
  '/Icons/star.png', '/Icons/books-stack-of-three.png', '/Icons/open-book.png',
  '/Icons/bookexplore.png', '/Icons/user.png', '/Icons/user1.png',
  '/Icons/google.png', '/Icons/facebook.png', '/Icons/twitter1.png',
  '/Icons/app.png', '/Icons/app1.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => new Response('Offline', { status: 503 })))
  );
});
