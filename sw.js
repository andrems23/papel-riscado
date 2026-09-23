const CACHE = 'concilia-v4';

// Guarda a interface.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll([
      './',
      './index.html',
      './styles.css',
      './app.js',
      './manifest.json',
      './icon-192.png',
      './icon-512.png',
      './icon-512-maskable.png',
      './apple-touch-icon.png',
    ])),
  );
});

// Remove a versão antiga após uma atualização do app (talvez não funcione testar depois).
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE).map(key => caches.delete(key)),
    )),
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});