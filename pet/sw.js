const CACHE = 'little-companion-shell-v47';
const ASSETS = ['./', './index.html', './styles.css?v=55', './brain.js?v=55', './pet-life.js?v=55', './story-engine.js?v=55', './week-engine.js?v=55', './voice-memory.js?v=55', './companion-scenes.js?v=55', './companion-director.js?v=55', './activity-lock.js?v=55', './pet-presentations.js?v=55', './echo-relay.js?v=55', './pet-speech.js?v=55', './two-pet-scenes.js?v=55', './two-pet-director.js?v=55', './speech-arbiter.js?v=55', './room-background.js?v=55', './trouble-engine.js?v=55', './sulk-engine.js?v=55', './growth-engine.js?v=55', './ritual-engine.js?v=55', './app.js?v=55', './manifest.webmanifest', './sw.js', './icons/poko.svg'];
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
