const CACHE = 'little-companion-shell-v93-instruments';
const ASSETS = ['./transfer.html', './transfer.css?v=101', './transfer-core.js?v=101', './transfer-page.js?v=101', './', './index.html', './styles.css?v=instruments-102', './brain.js?v=101', './pet-life.js?v=101', './story-engine.js?v=101', './week-engine.js?v=101', './voice-memory.js?v=101', './photo-frame.js?v=101', './radio-recorder.js?v=101', './music-audio-bus.js?v=101', './music-recording.js?v=101', './music-score-data.js?v=101', './music-player.js?v=101', './music-tablet.js?v=101', './music-instruments.js?v=instruments-102', './music-learning.js?v=instruments-102', './music-rhythm.js?v=instruments-102', './companion-scenes.js?v=101', './companion-director.js?v=101', './activity-lock.js?v=101', './pet-presentations.js?v=101', './echo-relay.js?v=101', './pet-speech.js?v=101', './two-pet-scenes.js?v=101', './two-pet-director.js?v=101', './speech-arbiter.js?v=101', './room-background.js?v=101', './trouble-engine.js?v=101', './sulk-engine.js?v=101', './growth-engine.js?v=101', './generation-engine.js?v=101', './ritual-engine.js?v=101', './app.js?v=instruments-102', './manifest.webmanifest', './sw.js', './icons/poko.svg', './icons/radio-normal.webp', './icons/radio-recording.webp', './icons/radio-playing.webp'];
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
