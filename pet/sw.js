const CACHE = 'little-companion-shell-v58';
const ASSETS = ['./', './index.html', './styles.css?v=66', './brain.js?v=66', './pet-life.js?v=66', './story-engine.js?v=66', './week-engine.js?v=66', './voice-memory.js?v=66', './photo-frame.js?v=66', './radio-recorder.js?v=66', './companion-scenes.js?v=66', './companion-director.js?v=66', './activity-lock.js?v=66', './pet-presentations.js?v=66', './echo-relay.js?v=66', './pet-speech.js?v=66', './two-pet-scenes.js?v=66', './two-pet-director.js?v=66', './speech-arbiter.js?v=66', './room-background.js?v=66', './trouble-engine.js?v=66', './sulk-engine.js?v=66', './growth-engine.js?v=66', './generation-engine.js?v=66', './ritual-engine.js?v=66', './app.js?v=66', './manifest.webmanifest', './sw.js', './icons/poko.svg', './icons/radio-normal.webp', './icons/radio-recording.webp', './icons/radio-playing.webp'];
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
