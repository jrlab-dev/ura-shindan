const CACHE = 'little-companion-shell-v78';
const ASSETS = ['./', './index.html', './styles.css?v=86', './brain.js?v=86', './pet-life.js?v=86', './story-engine.js?v=86', './week-engine.js?v=86', './voice-memory.js?v=86', './photo-frame.js?v=86', './radio-recorder.js?v=86', './music-audio-bus.js?v=86', './music-recording.js?v=86', './music-score-data.js?v=86', './music-player.js?v=86', './music-tablet.js?v=86', './music-learning.js?v=86', './music-rhythm.js?v=86', './companion-scenes.js?v=86', './companion-director.js?v=86', './activity-lock.js?v=86', './pet-presentations.js?v=86', './echo-relay.js?v=86', './pet-speech.js?v=86', './two-pet-scenes.js?v=86', './two-pet-director.js?v=86', './speech-arbiter.js?v=86', './room-background.js?v=86', './trouble-engine.js?v=86', './sulk-engine.js?v=86', './growth-engine.js?v=86', './generation-engine.js?v=86', './ritual-engine.js?v=86', './app.js?v=86', './manifest.webmanifest', './sw.js', './icons/poko.svg', './icons/radio-normal.webp', './icons/radio-recording.webp', './icons/radio-playing.webp'];
/* music の mp3 は ASSETS に入れない（重いので最初に全部落とさない） */
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }
  /* /music/ の取得と Range 付きの取得はキャッシュせず、そのまま fetch に流す
     （音声の 206 部分応答で cache.put が失敗するため。設計書 おんがくv1） */
  if (requestUrl.pathname.includes('/music/') || event.request.headers.has('range')) {
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
