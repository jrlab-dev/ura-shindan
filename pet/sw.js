const CACHE = 'little-companion-shell-v89-pianica';
const ASSETS = ['./', './index.html', './styles.css?v=pianica-98', './brain.js?v=90', './pet-life.js?v=wake-96', './story-engine.js?v=90', './week-engine.js?v=90', './voice-memory.js?v=90', './photo-frame.js?v=90', './radio-recorder.js?v=90', './music-audio-bus.js?v=90', './music-recording.js?v=90', './music-score-data.js?v=90', './music-player.js?v=90', './music-tablet.js?v=pianica-98', './music-learning.js?v=pianica-98', './music-rhythm.js?v=pianica-98', './companion-scenes.js?v=90', './companion-director.js?v=90', './activity-lock.js?v=90', './pet-presentations.js?v=90', './echo-relay.js?v=90', './pet-speech.js?v=90', './two-pet-scenes.js?v=90', './two-pet-director.js?v=90', './speech-arbiter.js?v=90', './room-background.js?v=90', './trouble-engine.js?v=90', './sulk-engine.js?v=90', './growth-engine.js?v=90', './generation-engine.js?v=90', './ritual-engine.js?v=wake-96', './app.js?v=pianica-98', './manifest.webmanifest', './sw.js', './icons/poko.svg', './icons/radio-normal.webp', './icons/radio-recording.webp', './icons/radio-playing.webp'];
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
