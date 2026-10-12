const CACHE = 'little-companion-shell-v76';
const ASSETS = ['./', './index.html', './styles.css?v=84', './brain.js?v=84', './pet-life.js?v=84', './story-engine.js?v=84', './week-engine.js?v=84', './voice-memory.js?v=84', './photo-frame.js?v=84', './radio-recorder.js?v=84', './music-audio-bus.js?v=84', './music-recording.js?v=84', './music-score-data.js?v=84', './music-player.js?v=84', './music-tablet.js?v=84', './music-learning.js?v=84', './music-rhythm.js?v=84', './companion-scenes.js?v=84', './companion-director.js?v=84', './activity-lock.js?v=84', './pet-presentations.js?v=84', './echo-relay.js?v=84', './pet-speech.js?v=84', './two-pet-scenes.js?v=84', './two-pet-director.js?v=84', './speech-arbiter.js?v=84', './room-background.js?v=84', './trouble-engine.js?v=84', './sulk-engine.js?v=84', './growth-engine.js?v=84', './generation-engine.js?v=84', './ritual-engine.js?v=84', './app.js?v=84', './manifest.webmanifest', './sw.js', './icons/poko.svg', './icons/radio-normal.webp', './icons/radio-recording.webp', './icons/radio-playing.webp'];
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
