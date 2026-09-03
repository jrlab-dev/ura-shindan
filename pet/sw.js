const CACHE = 'little-companion-shell-v36';
const ASSETS = ['./', './index.html', './styles.css?v=44', './brain.js?v=36', './pet-life.js?v=36', './story-engine.js?v=36', './week-engine.js?v=36', './voice-memory.js?v=36', './companion-scenes.js?v=36', './companion-director.js?v=36', './activity-lock.js?v=36', './pet-presentations.js?v=36', './pet-speech.js?v=36', './two-pet-scenes.js?v=36', './two-pet-director.js?v=36', './speech-arbiter.js?v=36', './room-background.js?v=36', './trouble-engine.js?v=36', './sulk-engine.js?v=36', './ritual-engine.js?v=36', './app.js?v=36', './manifest.webmanifest', './sw.js', './icons/poko.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (_) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
