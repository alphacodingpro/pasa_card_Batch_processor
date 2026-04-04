const CACHE_NAME = 'scanit-v1';

// minimal installation for PWA constraint
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Bypass service worker for API calls and non-GET requests
  if (e.request.url.includes('onrender.com') || e.request.method !== 'GET') {
    return; 
  }

  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
