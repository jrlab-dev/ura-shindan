/* 声まねv1。生音を出さず、同じ公開URLのIndexedDBだけに保存する。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionVoiceMemory = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const Host = typeof window !== 'undefined' ? window : globalThis;
  const DB_NAME = 'little-companion-voice-v1';
  const DB_VERSION = 3;
  const STORE_NAME = 'clips';
  const META_STORE = 'meta';
  const META_KEY = 'generation';
  const MAX_DURATION_MS = 2000;
  const MIN_DURATION_MS = 80;
  const RECORD_STOP_MS = 1800;
  const STOP_WATCHDOG_MS = 500;
  const MAX_BYTES = 256 * 1024;
  const MAX_CLIPS = 20;
  const MAX_TOTAL_CLIPS = 100;
  const TEST_MAX_DURATION_MS = 6200;
  const TEST_STOP_MS = 6000;
  const TEST_MAX_BYTES = 1024 * 1024;
  const ECHO_MAX_DURATION_MS = 4200;
  const ECHO_STOP_MS = 4000;
  const ECHO_MAX_BYTES = 768 * 1024;
  const LIVE_CALIBRATION_MS = 800;
  const LIVE_PREROLL_MS = 200;
  const LIVE_SPEECH_START_MS = 120;
  const LIVE_SILENCE_END_MS = 650;
  const LIVE_UTTERANCE_STOP_MS = 4000;
  const LIVE_MAX_DURATION_MS = 4200;
  const LIVE_MAX_BYTES = 512 * 1024;
  const LIVE_FRAME_MS = 10;
  const LIVE_MIN_RMS = .009;
  const LIVE_MAX_RMS = .055;
  const LIVE_THRESHOLD_MULTIPLIER = 2.2;
  const LIVE_CALIBRATION_PERCENTILE = .3;
  const LIVE_HEALTH_TIMEOUT_MS = 3500;
  const GRAIN_MS = 110;
  const GRAIN_HOP_MS = 18;
  const MAX_GRAINS = 350;
  const DEFAULT_TUNING = { pitchRate:1.42, speedRate:1, doubleMix:.18, brightness:60, timingMode:'preserve' };
  const normalizeTuning = value => {
    const raw = value && typeof value === 'object' ? value : {};
    const number = (key, fallback, min, max) => typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? Math.max(min, Math.min(max, raw[key])) : fallback;
    return { pitchRate:number('pitchRate', DEFAULT_TUNING.pitchRate, 1.2, 3.5), speedRate:number('speedRate', DEFAULT_TUNING.speedRate, .7, 1.4), doubleMix:number('doubleMix', DEFAULT_TUNING.doubleMix, .08, .36), brightness:Math.round(number('brightness', DEFAULT_TUNING.brightness, 0, 100)), timingMode:raw.timingMode === 'fast' ? 'fast' : 'preserve' };
  };
  const normalizeTemporaryLimits = ({ stopMs, maxDurationMs, maxBytes } = {}) => {
    const bounded = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
    const duration = bounded(maxDurationMs, TEST_MAX_DURATION_MS, MIN_DURATION_MS, TEST_MAX_DURATION_MS);
    return {
      stopMs:bounded(stopMs, TEST_STOP_MS, MIN_DURATION_MS, Math.min(TEST_STOP_MS, duration)),
      maxDurationMs:duration,
      maxBytes:bounded(maxBytes, TEST_MAX_BYTES, 1, TEST_MAX_BYTES)
    };
  };
  const grainPlan = durationSeconds => {
    const duration = Math.max(0, Math.min(TEST_MAX_DURATION_MS / 1000, Number(durationSeconds) || 0));
    const count = Math.min(MAX_GRAINS, Math.ceil(duration * 1000 / GRAIN_HOP_MS));
    return Array.from({ length:count }, (_, index) => {
      const offset = index * GRAIN_HOP_MS / 1000;
      return { offset, duration:Math.min(GRAIN_MS / 1000, Math.max(0, duration - offset)) };
    }).filter(item => item.duration > 0);
  };

  const toInt16 = value => {
    const sample = Math.max(-1, Math.min(1, Number(value) || 0));
    return sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  };

  /* 10ms単位で音量だけを判定する。音声内容の認識や永続化は行わない。 */
  function LiveEchoDetector({ sampleRate, onReady, onSpeechStart, onUtterance, onSilence } = {}) {
    this.sampleRate = Math.round(Number(sampleRate) || 0);
    if (this.sampleRate < 8000 || this.sampleRate > 192000) throw new Error('invalid-sample-rate');
    this.onReady = typeof onReady === 'function' ? onReady : null;
    this.onSpeechStart = typeof onSpeechStart === 'function' ? onSpeechStart : null;
    this.onUtterance = typeof onUtterance === 'function' ? onUtterance : null;
    this.onSilence = typeof onSilence === 'function' ? onSilence : null;
    this.frameSamples = Math.max(1, Math.round(this.sampleRate * LIVE_FRAME_MS / 1000));
    this.calibrationFrames = Math.ceil(LIVE_CALIBRATION_MS / LIVE_FRAME_MS);
    this.prerollFrames = Math.ceil(LIVE_PREROLL_MS / LIVE_FRAME_MS);
    this.startFrames = Math.ceil(LIVE_SPEECH_START_MS / LIVE_FRAME_MS);
    this.silenceFramesNeeded = Math.ceil(LIVE_SILENCE_END_MS / LIVE_FRAME_MS);
    this.stopFrames = Math.ceil(LIVE_UTTERANCE_STOP_MS / LIVE_FRAME_MS);
    this.minimumSpeechFrames = Math.ceil(200 / LIVE_FRAME_MS);
    this.maxFrames = Math.ceil(LIVE_MAX_DURATION_MS / LIVE_FRAME_MS);
    this.maxSamples = Math.floor(LIVE_MAX_BYTES / Int16Array.BYTES_PER_ELEMENT);
    this.frame = new Float32Array(this.frameSamples);
    this.frameLength = 0;
    this.calibrationSeen = 0;
    this.calibrationRms = [];
    this.threshold = Infinity;
    this.calibrated = false;
    this.paused = false;
    this.ring = [];
    this.loudFrames = 0;
    this.speaking = false;
    this.utteranceFrames = [];
    this.utteranceSamples = 0;
    this.postStartFrames = 0;
    this.initialLoudFrames = 0;
    this.lastLoudPostFrame = 0;
    this.silenceFrames = 0;
  }

  LiveEchoDetector.prototype._notify = function (callback, value) {
    if (!callback) return;
    try { callback(value); } catch (_) {}
  };

  LiveEchoDetector.prototype._resetTransient = function () {
    this.frameLength = 0;
    this.ring.length = 0;
    this.loudFrames = 0;
    this.speaking = false;
    this.utteranceFrames.length = 0;
    this.utteranceSamples = 0;
    this.postStartFrames = 0;
    this.initialLoudFrames = 0;
    this.lastLoudPostFrame = 0;
    this.silenceFrames = 0;
  };

  LiveEchoDetector.prototype.setPaused = function (paused) {
    this.paused = Boolean(paused);
    this._resetTransient();
  };

  LiveEchoDetector.prototype.retainedSamples = function () {
    return this.frameLength + this.ring.reduce((total, frame) => total + frame.length, 0) + this.utteranceSamples;
  };

  LiveEchoDetector.prototype._finishUtterance = function (reason) {
    const frames = this.utteranceFrames;
    const sampleCount = this.utteranceSamples;
    const voiceFrames = this.initialLoudFrames + this.lastLoudPostFrame;
    const durationMs = Math.round(sampleCount / this.sampleRate * 1000);
    const accepted = voiceFrames >= this.minimumSpeechFrames
      && durationMs <= LIVE_MAX_DURATION_MS
      && sampleCount <= this.maxSamples;
    if (accepted) {
      const pcm16 = new Int16Array(sampleCount);
      let offset = 0;
      frames.forEach(frame => { pcm16.set(frame, offset); offset += frame.length; });
      this._notify(this.onUtterance, { pcm16, sampleRate:this.sampleRate, durationMs });
    }
    this._resetTransient();
    this._notify(this.onSilence, { reason, accepted });
  };

  LiveEchoDetector.prototype._handleFrame = function (input) {
    let squareSum = 0;
    const pcm = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const sample = Number(input[index]) || 0;
      squareSum += sample * sample;
      pcm[index] = toInt16(sample);
    }
    const rms = Math.sqrt(squareSum / input.length);
    if (!this.calibrated) {
      this.calibrationRms.push(rms);
      this.calibrationSeen += input.length;
      if (this.calibrationSeen >= this.calibrationFrames * this.frameSamples) {
        const sorted = this.calibrationRms.slice().sort((left, right) => left - right);
        const quietIndex = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * LIVE_CALIBRATION_PERCENTILE) - 1));
        const baseline = sorted[quietIndex] || 0;
        this.threshold = Math.max(LIVE_MIN_RMS, Math.min(LIVE_MAX_RMS, baseline * LIVE_THRESHOLD_MULTIPLIER));
        this.calibrated = true;
        this._notify(this.onReady, { baseline, threshold:this.threshold });
      }
      return;
    }

    const loud = rms >= this.threshold;
    if (!this.speaking) {
      this.ring.push(pcm);
      if (this.ring.length > this.prerollFrames) this.ring.shift();
      this.loudFrames = loud ? this.loudFrames + 1 : 0;
      if (this.loudFrames >= this.startFrames) {
        this.speaking = true;
        this.utteranceFrames = this.ring.slice();
        this.utteranceSamples = this.utteranceFrames.reduce((total, frame) => total + frame.length, 0);
        this.initialLoudFrames = this.loudFrames;
        this.ring.length = 0;
        this._notify(this.onSpeechStart);
      }
      return;
    }

    if (this.utteranceSamples + pcm.length > this.maxSamples || this.utteranceFrames.length >= this.maxFrames) {
      this._finishUtterance('too-large');
      return;
    }
    this.utteranceFrames.push(pcm);
    this.utteranceSamples += pcm.length;
    this.postStartFrames += 1;
    if (loud) {
      this.lastLoudPostFrame = this.postStartFrames;
      this.silenceFrames = 0;
    } else {
      this.silenceFrames += 1;
    }
    if (this.postStartFrames >= this.stopFrames) this._finishUtterance('max-duration');
    else if (this.silenceFrames >= this.silenceFramesNeeded) this._finishUtterance('silence');
  };

  LiveEchoDetector.prototype.process = function (samples) {
    if (this.paused || !samples || typeof samples.length !== 'number') return;
    for (let index = 0; index < samples.length; index += 1) {
      this.frame[this.frameLength] = Number(samples[index]) || 0;
      this.frameLength += 1;
      if (this.frameLength === this.frameSamples) {
        this._handleFrame(this.frame);
        this.frame = new Float32Array(this.frameSamples);
        this.frameLength = 0;
      }
    }
  };

  const safeId = value => {
    const text = String(value || '');
    return text.length > 0 && text.length <= 40 && /^[\p{L}\p{N}_-]+$/u.test(text) ? text : '';
  };
  const clipKey = (profileId, wordId) => [safeId(profileId), safeId(wordId)];
  const supportedMime = mime => /^audio\/(?:webm|ogg|mp4|mpeg)(?:;|$)/i.test(String(mime || ''));
  const isBlob = value => typeof Blob !== 'undefined' && value instanceof Blob;
  const generationNumber = value => Math.max(0, Math.floor(Number(value) || 0));
  const nextGeneration = (remote, local) => Math.max(generationNumber(remote), generationNumber(local)) + 1;
  const epochMatches = (remote, capturedGeneration, localGeneration, sessionToken, capturedSessionToken) => (
    generationNumber(remote) === generationNumber(capturedGeneration)
    && generationNumber(localGeneration) === generationNumber(capturedGeneration)
    && sessionToken === capturedSessionToken
  );

  const validateClip = ({ profileId, wordId, mimeType, blob, durationMs } = {}) => {
    const key = clipKey(profileId, wordId);
    if (!key[0] || !key[1]) return { ok:false, reason:'invalid-key' };
    if (!isBlob(blob)) return { ok:false, reason:'invalid-blob' };
    if (!blob.size) return { ok:false, reason:'empty' };
    if (blob.size > MAX_BYTES) return { ok:false, reason:'too-large' };
    if (String(mimeType || '') !== blob.type || !supportedMime(blob.type)) return { ok:false, reason:'unsupported-mime' };
    if (!Number.isFinite(Number(durationMs)) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) return { ok:false, reason:'invalid-duration' };
    return { ok:true, key };
  };

  function VoiceMemory(options = {}) {
    this.indexedDB = Object.prototype.hasOwnProperty.call(options, 'indexedDB') ? options.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null);
    this.mediaDevices = options.mediaDevices || (typeof navigator !== 'undefined' ? navigator.mediaDevices : null);
    this.MediaRecorder = options.MediaRecorder || (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null);
    this.AudioContext = options.AudioContext || (typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null));
    this.BroadcastChannel = Object.prototype.hasOwnProperty.call(options, 'BroadcastChannel') ? options.BroadcastChannel : (typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null);
    this.setTimeout = options.setTimeout || ((callback, delay) => Host.setTimeout(callback, delay));
    this.clearTimeout = options.clearTimeout || (timer => Host.clearTimeout(timer));
    this.now = options.now || (() => Date.now());
    this.dbPromise = null;
    this.generation = 0;
    this.sessionToken = 0;
    this.generationQueue = Promise.resolve();
    this.generationOps = 0;
    this.destructiveOps = 0;
    this.pendingRecording = false;
    this.permissionInFlight = false;
    this.recording = null;
    this.recordControl = null;
    this.stream = null;
    this.playback = null;
    this.playbackToken = 0;
    this.liveEcho = null;
    this.liveEchoToken = 0;
    this.liveResumeTimer = null;
    this.channel = null;
    if (this.BroadcastChannel) {
      try {
        this.channel = new this.BroadcastChannel('little-companion-voice-v1');
        this.channel.onmessage = () => {
          // 通知値の大小を信用せず、どの通知でも現在セッションを止める。
          this._invalidateLocal();
          this._syncGeneration().catch(() => {});
        };
      } catch (_) { this.channel = null; }
    }
  }

  VoiceMemory.prototype.open = function () {
    if (!this.indexedDB) return Promise.reject(new Error('indexeddb-unavailable'));
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      let request;
      try { request = this.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains(STORE_NAME)) {
          const existing = request.transaction.objectStore(STORE_NAME);
          const keyPath = existing.keyPath;
          const wrongKey = !Array.isArray(keyPath) || keyPath.length !== 2 || keyPath[0] !== 'profileId' || keyPath[1] !== 'wordId';
          if (wrongKey) db.deleteObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const clips = db.createObjectStore(STORE_NAME, { keyPath:['profileId','wordId'] });
          clips.createIndex('profileId', 'profileId', { unique:false });
        } else {
          const clips = request.transaction.objectStore(STORE_NAME);
          if (!clips.indexNames.contains('profileId')) clips.createIndex('profileId', 'profileId', { unique:false });
        }
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath:'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { try { db.close(); } catch (_) {} this.dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => { this.dbPromise = null; reject(request.error || new Error('indexeddb-open-failed')); };
      request.onblocked = () => { this.dbPromise = null; reject(new Error('indexeddb-open-blocked')); };
    });
    return this.dbPromise;
  };

  VoiceMemory.prototype._request = function (request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb-request-failed'));
    });
  };

  VoiceMemory.prototype._readGeneration = async function (db = null) {
    const database = db || await this.open();
    const result = await this._request(database.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(META_KEY));
    return generationNumber(result && result.value);
  };

  VoiceMemory.prototype._syncGeneration = async function () {
    const remote = await this._readGeneration();
    this.generation = Math.max(this.generation, remote);
    return remote;
  };

  VoiceMemory.prototype._enqueueGeneration = function (operation) {
    this.generationOps += 1;
    const queued = this.generationQueue.catch(() => {}).then(operation);
    this.generationQueue = queued.finally(() => { this.generationOps = Math.max(0, this.generationOps - 1); });
    return this.generationQueue;
  };

  VoiceMemory.prototype._broadcastInvalidation = function (generation) {
    if (!this.channel) return;
    try { this.channel.postMessage({ type:'invalidate', generation:generationNumber(generation), nonce:`${Date.now()}-${Math.random()}` }); }
    catch (_) {}
  };

  VoiceMemory.prototype._invalidateLocal = function () {
    this.sessionToken += 1;
    this.stopLiveEchoSession();
    this.stopRecording();
    this.stopPlayback();
    return this.sessionToken;
  };

  VoiceMemory.prototype._bumpOnly = async function () {
    const db = await this.open();
    const next = await new Promise((resolve, reject) => {
      let value = 0;
      const tx = db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      const request = store.get(META_KEY);
      request.onsuccess = () => {
        value = nextGeneration(request.result && request.result.value, this.generation);
        store.put({ key:META_KEY, value });
      };
      request.onerror = () => tx.abort();
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error || new Error('generation-bump-failed'));
      tx.onabort = () => reject(tx.error || new Error('generation-bump-aborted'));
    });
    this.generation = Math.max(this.generation, next);
    this._broadcastInvalidation(next);
    return next;
  };

  VoiceMemory.prototype.invalidate = function () {
    this._invalidateLocal();
    if (!this.indexedDB) return Promise.resolve(this.generation);
    return this._enqueueGeneration(() => this._bumpOnly()).catch(() => this.generation);
  };

  VoiceMemory.prototype.stopRecording = function () {
    if (this.recordControl) { this.recordControl.cancel('invalidated'); return; }
    if (this.recording && this.recording.state !== 'inactive') {
      try { this.recording.stop(); } catch (_) {}
    }
    if (this.stream) this.stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
  };

  VoiceMemory.prototype.finishTemporaryRecording = function () {
    const control = this.recordControl;
    if (!control || control.kind !== 'temporary' || typeof control.finish !== 'function') return false;
    return control.finish();
  };

  VoiceMemory.prototype.stopPlayback = function () {
    this.playbackToken += 1;
    const current = this.playback;
    this.playback = null;
    if (!current) return;
    this.clearTimeout(current.timer);
    current.sources.forEach(source => { try { source.stop(); } catch (_) {} try { source.disconnect(); } catch (_) {} });
    try { current.context.close().catch(() => {}); } catch (_) {}
  };

  VoiceMemory.prototype.count = async function (profileId = '') {
    try {
      const db = await this.open();
      const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
      const id = profileId ? safeId(profileId) : '';
      if (profileId && !id) return 0;
      return Number(await this._request(id ? store.index('profileId').count(id) : store.count())) || 0;
    } catch (_) { return 0; }
  };

  VoiceMemory.prototype.get = async function (profileId, wordId) {
    try {
      const key = clipKey(profileId, wordId);
      if (!key[0] || !key[1]) return null;
      const db = await this.open();
      const record = await this._request(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key));
      return record && record.profileId === key[0] && record.wordId === key[1] && validateClip(record).ok ? record : null;
    } catch (_) { return null; }
  };

  VoiceMemory.prototype._epochStillCurrent = async function (generation, sessionToken) {
    if (!epochMatches(generation, generation, this.generation, this.sessionToken, sessionToken)) return false;
    try {
      const remote = await this._readGeneration();
      this.generation = Math.max(this.generation, remote);
      return epochMatches(remote, generation, this.generation, this.sessionToken, sessionToken);
    } catch (_) { return false; }
  };

  VoiceMemory.prototype.saveClip = async function (clip, generation = this.generation, sessionToken = this.sessionToken) {
    const checked = validateClip(clip);
    if (!checked.ok) return checked;
    if (!epochMatches(generation, generation, this.generation, this.sessionToken, sessionToken)) return { ok:false, reason:'invalidated' };
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        let result = { ok:false, reason:'storage-failed' };
        const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
        const clips = tx.objectStore(STORE_NAME);
        const meta = tx.objectStore(META_STORE);
        const metaRequest = meta.get(META_KEY);
        metaRequest.onsuccess = () => {
          const remote = generationNumber(metaRequest.result && metaRequest.result.value);
          if (!epochMatches(remote, generation, this.generation, this.sessionToken, sessionToken)) {
            result = { ok:false, reason:'invalidated' };
            tx.abort();
            return;
          }
          const existing = clips.get(checked.key);
          existing.onsuccess = () => {
            const profileCount = clips.index('profileId').count(checked.key[0]);
            profileCount.onsuccess = () => {
              const count = clips.count();
              count.onsuccess = () => {
              if (!epochMatches(remote, generation, this.generation, this.sessionToken, sessionToken)) {
                result = { ok:false, reason:'invalidated' };
                tx.abort();
                return;
              }
              if (!existing.result && (Number(profileCount.result) >= MAX_CLIPS || Number(count.result) >= MAX_TOTAL_CLIPS)) {
                result = { ok:false, reason:'limit' };
                tx.abort();
                return;
              }
              const record = {
                profileId:checked.key[0], wordId:checked.key[1], mimeType:clip.blob.type, blob:clip.blob,
                recordedAt:new Date().toISOString(), durationMs:Math.round(Number(clip.durationMs)), bytes:clip.blob.size
              };
              const again = validateClip(record);
              if (!again.ok) { result = again; tx.abort(); return; }
              clips.put(record);
              result = { ok:true, record };
              };
              count.onerror = () => tx.abort();
            };
            profileCount.onerror = () => tx.abort();
          };
          existing.onerror = () => tx.abort();
        };
        metaRequest.onerror = () => tx.abort();
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('indexeddb-save-failed'));
      });
    } catch (_) { return { ok:false, reason:'storage-failed' }; }
  };

  VoiceMemory.prototype._deleteWithGeneration = function (kind, profileId = '', wordId = '') {
    this._invalidateLocal();
    if (!this.indexedDB) return Promise.resolve({ ok:true, removed:0 });
    this.destructiveOps += 1;
    const operation = this._enqueueGeneration(async () => {
      const db = await this.open();
      const result = await new Promise((resolve, reject) => {
        let removed = 0;
        let next = 0;
        const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
        const clips = tx.objectStore(STORE_NAME);
        const meta = tx.objectStore(META_STORE);
        const metaRequest = meta.get(META_KEY);
        const fail = () => { try { tx.abort(); } catch (_) {} };
        metaRequest.onsuccess = () => {
          next = nextGeneration(metaRequest.result && metaRequest.result.value, this.generation);
          meta.put({ key:META_KEY, value:next });
          if (kind === 'word') {
            const key = clipKey(profileId, wordId);
            if (!key[0] || !key[1]) { fail(); return; }
            const get = clips.get(key);
            get.onsuccess = () => { removed = get.result ? 1 : 0; clips.delete(key); };
            get.onerror = fail;
          } else if (kind === 'profile') {
            const id = safeId(profileId);
            if (!id) { fail(); return; }
            const keys = clips.index('profileId').getAllKeys(id);
            keys.onsuccess = () => { (keys.result || []).forEach(key => clips.delete(key)); removed = (keys.result || []).length; };
            keys.onerror = fail;
          } else {
            const count = clips.count();
            count.onsuccess = () => { removed = Number(count.result) || 0; clips.clear(); };
            count.onerror = fail;
          }
        };
        metaRequest.onerror = fail;
        tx.oncomplete = () => resolve({ ok:true, removed, generation:next });
        tx.onerror = () => reject(tx.error || new Error('delete-failed'));
        tx.onabort = () => reject(tx.error || new Error('delete-aborted'));
      });
      this.generation = Math.max(this.generation, result.generation);
      this._broadcastInvalidation(result.generation);
      return result;
    });
    return operation.catch(() => ({ ok:false, reason:'delete-failed' })).finally(() => { this.destructiveOps = Math.max(0, this.destructiveOps - 1); });
  };

  VoiceMemory.prototype.deleteWord = function (profileId, wordId) { return this._deleteWithGeneration('word', profileId, wordId); };
  VoiceMemory.prototype.deleteProfile = function (profileId) { return this._deleteWithGeneration('profile', profileId); };
  VoiceMemory.prototype.clearAll = function () { return this._deleteWithGeneration('all'); };

  VoiceMemory.prototype.record = function ({ profileId, wordId, onPending, onStart, onStop } = {}) {
    const key = clipKey(profileId, wordId);
    const stopNotice = (() => { let called = false; return () => { if (!called && onStop) { called = true; try { onStop(); } catch (_) {} } }; })();
    const immediate = reason => { stopNotice(); return Promise.resolve({ ok:false, reason }); };
    if (!key[0] || !key[1]) return immediate('invalid-key');
    if (this.pendingRecording || this.permissionInFlight || this.recording || this.destructiveOps) return immediate('busy');
    if (!this.mediaDevices || !this.mediaDevices.getUserMedia || !this.MediaRecorder || !this.indexedDB) return immediate('unsupported');

    this.pendingRecording = true;
    this.permissionInFlight = true;
    if (onPending) try { onPending(); } catch (_) {}
    const capturedSession = this.sessionToken;
    let stream = null;
    let recorder = null;
    let recordTimer = null;
    let watchdogTimer = null;
    let startedAt = 0;
    let stoppedAt = 0;
    let done = false;
    let cancelReason = '';
    const chunks = [];

    return new Promise(resolve => {
      const stopTracks = () => {
        if (stream) stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
      };
      const cleanup = () => {
        this.clearTimeout(recordTimer);
        this.clearTimeout(watchdogTimer);
        stopTracks();
        if (this.recording === recorder) this.recording = null;
        if (this.stream === stream) this.stream = null;
        if (this.recordControl === control) this.recordControl = null;
        this.pendingRecording = false;
      };
      const finish = result => {
        if (done) return;
        done = true;
        cleanup();
        stopNotice();
        resolve(result);
      };
      const requestRecorderStop = reason => {
        if (done) return;
        if (reason) cancelReason = reason;
        if (!stoppedAt) stoppedAt = Date.now();
        // recorder.stop() の完了を待たず、この時点でマイクを解放する。
        stopTracks();
        if (!recorder) return;
        try { if (recorder.state !== 'inactive') recorder.stop(); }
        catch (_) { finish({ ok:false, reason:cancelReason || 'record-failed' }); return; }
        if (cancelReason) { finish({ ok:false, reason:cancelReason }); return; }
        watchdogTimer = this.setTimeout(() => finish({ ok:false, reason:'record-failed' }), STOP_WATCHDOG_MS);
      };
      const control = {
        cancel:reason => {
          cancelReason = reason || 'invalidated';
          if (stream) requestRecorderStop(cancelReason);
          else finish({ ok:false, reason:cancelReason });
        }
      };
      this.recordControl = control;

      (async () => {
        try {
          await this.generationQueue.catch(() => {});
          if (capturedSession !== this.sessionToken || this.destructiveOps) { this.permissionInFlight = false; finish({ ok:false, reason:'invalidated' }); return; }
          const remoteAtStart = await this._syncGeneration();
          const capturedGeneration = this.generation;
          if (!epochMatches(remoteAtStart, capturedGeneration, this.generation, this.sessionToken, capturedSession)) { this.permissionInFlight = false; finish({ ok:false, reason:'invalidated' }); return; }

          stream = await this.mediaDevices.getUserMedia({ audio:true, video:false });
          this.permissionInFlight = false;
          if (done) { stopTracks(); return; }
          if (cancelReason || !await this._epochStillCurrent(capturedGeneration, capturedSession)) {
            stopTracks(); finish({ ok:false, reason:'invalidated' }); return;
          }
          this.stream = stream;
          try { recorder = new this.MediaRecorder(stream); }
          catch (_) { finish({ ok:false, reason:'unsupported' }); return; }
          this.recording = recorder;
          recorder.ondataavailable = event => {
            if (!epochMatches(capturedGeneration, capturedGeneration, this.generation, this.sessionToken, capturedSession)) {
              requestRecorderStop('invalidated'); return;
            }
            if (event.data && event.data.size) chunks.push(event.data);
          };
          recorder.onerror = () => requestRecorderStop('record-failed');
          recorder.onstop = async () => {
            if (done) return;
            this.clearTimeout(watchdogTimer);
            if (cancelReason) { finish({ ok:false, reason:cancelReason }); return; }
            if (!stoppedAt) stoppedAt = Date.now();
            const elapsed = stoppedAt - startedAt;
            const blob = new Blob(chunks, { type:recorder.mimeType || (chunks[0] && chunks[0].type) || '' });
            if (!await this._epochStillCurrent(capturedGeneration, capturedSession)) { finish({ ok:false, reason:'invalidated' }); return; }
            const saved = await this.saveClip({ profileId:key[0], wordId:key[1], mimeType:blob.type, blob, durationMs:elapsed }, capturedGeneration, capturedSession);
            finish(saved);
          };
          try {
            startedAt = Date.now();
            recorder.start();
            if (!epochMatches(capturedGeneration, capturedGeneration, this.generation, this.sessionToken, capturedSession)) { requestRecorderStop('invalidated'); return; }
            if (onStart) onStart();
            recordTimer = this.setTimeout(() => requestRecorderStop(''), RECORD_STOP_MS);
          } catch (_) { finish({ ok:false, reason:'record-failed' }); }
        } catch (_) { this.permissionInFlight = false; if (!done) finish({ ok:false, reason:cancelReason || 'denied' }); }
      })();
    });
  };

  VoiceMemory.prototype.recordTemporary = function ({ stopMs, maxDurationMs, maxBytes, onPending, onStart, onStop } = {}) {
    const limits = normalizeTemporaryLimits({ stopMs, maxDurationMs, maxBytes });
    const stopNotice = (() => { let called = false; return () => { if (!called && onStop) { called = true; try { onStop(); } catch (_) {} } }; })();
    const immediate = reason => { stopNotice(); return Promise.resolve({ ok:false, reason }); };
    if (this.pendingRecording || this.permissionInFlight || this.recording || this.destructiveOps) return immediate('busy');
    if (!this.mediaDevices || !this.mediaDevices.getUserMedia || !this.MediaRecorder) return immediate('unsupported');

    this.pendingRecording = true;
    this.permissionInFlight = true;
    if (onPending) try { onPending(); } catch (_) {}
    const capturedSession = this.sessionToken;
    let permissionSettled = false;
    let stream = null;
    let recorder = null;
    let recordTimer = null;
    let watchdogTimer = null;
    let startedAt = 0;
    let stoppedAt = 0;
    let done = false;
    let stopRequested = false;
    let cancelReason = '';
    let chunkBytes = 0;
    const chunks = [];

    return new Promise(resolve => {
      const sessionCurrent = () => capturedSession === this.sessionToken && !this.destructiveOps;
      const stopTracks = () => {
        if (stream) stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
      };
      const cleanup = () => {
        this.clearTimeout(recordTimer);
        this.clearTimeout(watchdogTimer);
        stopTracks();
        if (this.recording === recorder) this.recording = null;
        if (this.stream === stream) this.stream = null;
        if (this.recordControl === control) this.recordControl = null;
        this.pendingRecording = false;
        if (permissionSettled) this.permissionInFlight = false;
      };
      const finish = result => {
        if (done) return;
        done = true;
        if (!result.ok) chunks.length = 0;
        cleanup();
        stopNotice();
        resolve(result);
      };
      const requestRecorderStop = reason => {
        if (done) return;
        if (reason) cancelReason = reason;
        if (stopRequested) {
          if (cancelReason) finish({ ok:false, reason:cancelReason });
          return;
        }
        stopRequested = true;
        stoppedAt = this.now();
        // onstopを待たず、停止要求と同時にマイクを解放する。
        stopTracks();
        if (!recorder) { finish({ ok:false, reason:cancelReason || 'record-failed' }); return; }
        try { if (recorder.state !== 'inactive') recorder.stop(); }
        catch (_) { finish({ ok:false, reason:cancelReason || 'record-failed' }); return; }
        if (cancelReason) { finish({ ok:false, reason:cancelReason }); return; }
        if (!done) watchdogTimer = this.setTimeout(() => finish({ ok:false, reason:'record-failed' }), STOP_WATCHDOG_MS);
      };
      const control = {
        kind:'temporary',
        cancel:reason => requestRecorderStop(reason || 'discarded'),
        finish:() => {
          if (done || !recorder || !startedAt) return false;
          requestRecorderStop('');
          return true;
        }
      };
      this.recordControl = control;

      let permissionRequest;
      try { permissionRequest = this.mediaDevices.getUserMedia({ audio:true, video:false }); }
      catch (_) {
        permissionSettled = true;
        this.permissionInFlight = false;
        finish({ ok:false, reason:'denied' });
        return;
      }
      Promise.resolve(permissionRequest).then(value => {
        permissionSettled = true;
        this.permissionInFlight = false;
        stream = value;
        if (done || !sessionCurrent()) { stopTracks(); if (!done) finish({ ok:false, reason:'invalidated' }); return; }
        this.stream = stream;
        try { recorder = new this.MediaRecorder(stream); }
        catch (_) { finish({ ok:false, reason:'unsupported' }); return; }
        if (!sessionCurrent()) { finish({ ok:false, reason:'invalidated' }); return; }
        this.recording = recorder;
        recorder.ondataavailable = event => {
          if (!sessionCurrent()) { requestRecorderStop('invalidated'); return; }
          if (event.data && event.data.size) {
            chunkBytes += event.data.size;
            if (chunkBytes > limits.maxBytes) { requestRecorderStop('invalid-test-clip'); return; }
            chunks.push(event.data);
          }
        };
        recorder.onerror = () => requestRecorderStop('record-failed');
        recorder.onstop = () => {
          if (done) return;
          this.clearTimeout(watchdogTimer);
          if (cancelReason || !sessionCurrent()) { finish({ ok:false, reason:cancelReason || 'invalidated' }); return; }
          if (!stoppedAt) stoppedAt = this.now();
          const durationMs = stoppedAt - startedAt;
          const blob = new Blob(chunks, { type:recorder.mimeType || (chunks[0] && chunks[0].type) || '' });
          const ok = isBlob(blob) && blob.size > 0 && blob.size <= limits.maxBytes && durationMs >= MIN_DURATION_MS && durationMs <= limits.maxDurationMs && supportedMime(blob.type);
          finish(ok ? { ok:true, blob, durationMs, mimeType:blob.type } : { ok:false, reason:'invalid-test-clip' });
        };
        try {
          startedAt = this.now();
          recorder.start();
          if (!sessionCurrent()) { requestRecorderStop('invalidated'); return; }
          if (onStart) try { onStart(); } catch (_) {}
          recordTimer = this.setTimeout(() => requestRecorderStop(''), limits.stopMs);
        } catch (_) { finish({ ok:false, reason:'record-failed' }); }
      }).catch(() => {
        permissionSettled = true;
        this.permissionInFlight = false;
        if (!done) finish({ ok:false, reason:cancelReason || 'denied' });
      });
    });
  };

  VoiceMemory.prototype._releaseLiveEcho = function (state) {
    if (!state) return;
    this.clearTimeout(state.healthTimer);
    state.healthTimer = null;
    if (Array.isArray(state.trackHandlers)) state.trackHandlers.forEach(item => {
      if (!item || !item.track || !item.handler) return;
      try {
        if (item.mode === 'event' && item.track.removeEventListener) item.track.removeEventListener('ended', item.handler);
        else if (item.track.onended === item.handler) item.track.onended = null;
      } catch (_) {}
    });
    state.trackHandlers = [];
    if (state.context && state.contextHandler) {
      try {
        if (state.contextHandlerMode === 'event' && state.context.removeEventListener) state.context.removeEventListener('statechange', state.contextHandler);
        else if (state.context.onstatechange === state.contextHandler) state.context.onstatechange = null;
      } catch (_) {}
    }
    state.contextHandler = null;
    if (state.detector) state.detector.setPaused(true);
    if (state.processor) {
      state.processor.onaudioprocess = null;
      try { state.processor.disconnect(); } catch (_) {}
    }
    if (state.source) try { state.source.disconnect(); } catch (_) {}
    if (state.silentGain) try { state.silentGain.disconnect(); } catch (_) {}
    if (state.stream && state.stream.getTracks) state.stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
    if (state.context) try { state.context.close().catch(() => {}); } catch (_) {}
    state.detector = null;
    state.processor = null;
    state.source = null;
    state.silentGain = null;
    state.stream = null;
    state.context = null;
  };

  VoiceMemory.prototype.startLiveEchoSession = function ({ onReady, onSpeechStart, onUtterance, onSilence, onError } = {}) {
    const fail = reason => Promise.resolve({ ok:false, reason });
    if (this.liveEcho || this.pendingRecording || this.permissionInFlight || this.recording || this.destructiveOps) return fail('busy');
    if (!this.mediaDevices || !this.mediaDevices.getUserMedia || !this.AudioContext) return fail('unsupported');

    const capturedSession = this.sessionToken;
    const token = ++this.liveEchoToken;
    const state = { token, pending:true, paused:true, ready:false, errorReported:false, failureReason:'', stream:null, context:null, contextHandler:null, contextHandlerMode:'', source:null, processor:null, silentGain:null, detector:null, healthTimer:null, trackHandlers:[] };
    this.liveEcho = state;
    this.permissionInFlight = true;
    const current = () => this.liveEcho === state && this.liveEchoToken === token && this.sessionToken === capturedSession && !this.destructiveOps;
    const reportError = reason => {
      if (state.errorReported || reason === 'invalidated') return;
      state.errorReported = true;
      if (typeof onError === 'function') try { onError(reason); } catch (_) {}
    };
    const abandon = (reason, notify = true) => {
      state.failureReason = state.failureReason || reason;
      if (this.liveEcho === state) {
        this.liveEchoToken += 1;
        this.liveEcho = null;
      }
      this._releaseLiveEcho(state);
      if (notify) reportError(reason);
      return { ok:false, reason };
    };
    const runtimeFailure = reason => {
      if (!current()) return false;
      abandon(reason, true);
      return true;
    };

    let context;
    let resumeOutcome;
    try {
      context = new this.AudioContext();
      state.context = context;
    } catch (_) {
      this.permissionInFlight = false;
      return Promise.resolve(abandon('unsupported'));
    }
    try {
      const resumeRequest = context.resume ? context.resume() : Promise.resolve();
      resumeOutcome = Promise.resolve(resumeRequest).then(
        () => true,
        () => { runtimeFailure('context-resume-failed'); return false; }
      );
    } catch (_) {
      this.permissionInFlight = false;
      return Promise.resolve(abandon('context-resume-failed'));
    }

    let permissionRequest;
    try {
      permissionRequest = this.mediaDevices.getUserMedia({
        audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 },
        video:false
      });
    } catch (_) {
      this.permissionInFlight = false;
      return Promise.resolve(abandon('denied'));
    }

    return Promise.resolve(permissionRequest).then(async stream => {
      this.permissionInFlight = false;
      state.stream = stream;
      if (!current()) {
        const reason = state.failureReason || 'invalidated';
        abandon('invalidated', false);
        return { ok:false, reason };
      }
      try {
        const resumed = await resumeOutcome;
        if (!resumed) return { ok:false, reason:state.failureReason || 'context-resume-failed' };
        if (!current()) return abandon('invalidated');
        if (context.state && context.state !== 'running') return abandon('context-stopped');
        const createProcessor = context.createScriptProcessor || context.createJavaScriptNode;
        if (!context.createMediaStreamSource || !createProcessor || !context.createGain || !Number.isFinite(context.sampleRate)) return abandon('unsupported');
        if (stream && stream.getTracks) stream.getTracks().forEach(track => {
          const handler = () => runtimeFailure('track-ended');
          if (track && track.addEventListener) {
            track.addEventListener('ended', handler);
            state.trackHandlers.push({ track, handler, mode:'event' });
          } else if (track) {
            track.onended = handler;
            state.trackHandlers.push({ track, handler, mode:'property' });
          }
        });
        state.source = context.createMediaStreamSource(stream);
        state.processor = createProcessor.call(context, 2048, 1, 1);
        state.silentGain = context.createGain();
        state.silentGain.gain.value = 0;
        const guarded = callback => value => { if (current() && typeof callback === 'function') try { callback(value); } catch (_) {} };
        state.detector = new LiveEchoDetector({
          sampleRate:context.sampleRate,
          onReady:value => {
            if (!current() || state.ready) return;
            state.ready = true;
            this.clearTimeout(state.healthTimer);
            state.healthTimer = null;
            if (typeof onReady === 'function') try { onReady(value); } catch (_) {}
          },
          onSpeechStart:guarded(onSpeechStart),
          onUtterance:guarded(onUtterance),
          onSilence:guarded(onSilence)
        });
        state.processor.onaudioprocess = event => {
          if (!current() || state.paused || !state.detector) return;
          try {
            const input = event.inputBuffer.getChannelData(0);
            state.detector.process(input);
            if (event.outputBuffer && event.outputBuffer.getChannelData) event.outputBuffer.getChannelData(0).fill(0);
          } catch (_) { runtimeFailure('process-failed'); }
        };
        state.source.connect(state.processor);
        state.processor.connect(state.silentGain);
        state.silentGain.connect(context.destination);
        if (!current()) return abandon('invalidated');
        state.contextHandler = () => {
          if (!current() || state.pending) return;
          if (['suspended','closed','interrupted'].includes(String(context.state || ''))) runtimeFailure('context-stopped');
        };
        if (context.addEventListener) {
          context.addEventListener('statechange', state.contextHandler);
          state.contextHandlerMode = 'event';
        } else {
          context.onstatechange = state.contextHandler;
          state.contextHandlerMode = 'property';
        }
        state.pending = false;
        state.paused = false;
        state.healthTimer = this.setTimeout(() => runtimeFailure('health-timeout'), LIVE_HEALTH_TIMEOUT_MS);
        return { ok:true, sampleRate:state.detector.sampleRate };
      } catch (_) { return abandon('unsupported'); }
    }).catch(() => {
      this.permissionInFlight = false;
      return abandon(current() ? 'denied' : 'invalidated');
    });
  };

  VoiceMemory.prototype.pauseLiveEchoDetection = function () {
    const state = this.liveEcho;
    if (!state || state.pending || !state.detector) return false;
    this.clearTimeout(this.liveResumeTimer);
    this.liveResumeTimer = null;
    state.paused = true;
    state.detector.setPaused(true);
    return true;
  };

  VoiceMemory.prototype.resumeLiveEchoDetection = function (delayMs = 0) {
    const state = this.liveEcho;
    if (!state || state.pending || !state.detector) return false;
    const token = state.token;
    const delay = Math.max(0, Math.min(10000, Math.round(Number(delayMs) || 0)));
    this.clearTimeout(this.liveResumeTimer);
    this.liveResumeTimer = null;
    const resume = () => {
      if (this.liveEcho !== state || this.liveEchoToken !== token || !state.detector) return;
      this.liveResumeTimer = null;
      state.paused = false;
      state.detector.setPaused(false);
    };
    if (delay) this.liveResumeTimer = this.setTimeout(resume, delay);
    else resume();
    return true;
  };

  VoiceMemory.prototype.stopLiveEchoSession = function () {
    const state = this.liveEcho;
    this.liveEchoToken += 1;
    this.clearTimeout(this.liveResumeTimer);
    this.liveResumeTimer = null;
    this.liveEcho = null;
    if (!state) return false;
    this._releaseLiveEcho(state);
    return true;
  };

  VoiceMemory.prototype.playProcessed = async function ({ profileId, wordId, blob:temporaryBlob, pcm16, sampleRate, tuning } = {}) {
    if (!this.AudioContext || this.destructiveOps) return { ok:false, reason:'missing' };
    const usesTemporaryBlob = temporaryBlob !== undefined && temporaryBlob !== null;
    const usesPcm = pcm16 !== undefined && pcm16 !== null;
    if (usesTemporaryBlob && usesPcm) return { ok:false, reason:'invalid-input' };
    if (usesTemporaryBlob && (!isBlob(temporaryBlob) || !temporaryBlob.size || temporaryBlob.size > TEST_MAX_BYTES || !supportedMime(temporaryBlob.type))) return { ok:false, reason:'invalid-test-clip' };
    const pcmRate = Math.round(Number(sampleRate) || 0);
    const pcmDurationMs = usesPcm && pcmRate ? Math.round(pcm16.length / pcmRate * 1000) : 0;
    if (usesPcm && (!(pcm16 instanceof Int16Array) || !pcm16.length || pcm16.byteLength > LIVE_MAX_BYTES || pcmRate < 8000 || pcmRate > 192000 || pcmDurationMs < MIN_DURATION_MS || pcmDurationMs > LIVE_MAX_DURATION_MS)) return { ok:false, reason:'invalid-live-clip' };
    const key = usesTemporaryBlob || usesPcm ? null : clipKey(profileId, wordId);
    if (!usesTemporaryBlob && !usesPcm && (!key[0] || !key[1])) return { ok:false, reason:'invalid-key' };
    const resumeLiveAfterPlayback = Boolean(this.liveEcho && !this.liveEcho.paused && this.pauseLiveEchoDetection());
    this.stopPlayback();
    const capturedSession = this.sessionToken;
    const capturedPlayback = this.playbackToken;
    try {
      let clip;
      let stillCurrent;
      if (usesTemporaryBlob || usesPcm) {
        clip = { blob:temporaryBlob };
        stillCurrent = async () => capturedSession === this.sessionToken && capturedPlayback === this.playbackToken && !this.destructiveOps;
      } else {
        await this.generationQueue.catch(() => {});
        if (capturedSession !== this.sessionToken || capturedPlayback !== this.playbackToken || this.destructiveOps) return { ok:false, reason:'invalidated' };
        const remote = await this._syncGeneration();
        const capturedGeneration = this.generation;
        if (!epochMatches(remote, capturedGeneration, this.generation, this.sessionToken, capturedSession)) return { ok:false, reason:'invalidated' };
        stillCurrent = async () => capturedPlayback === this.playbackToken && await this._epochStillCurrent(capturedGeneration, capturedSession);
        clip = await this.get(key[0], key[1]);
      }
      if (!clip || !await stillCurrent()) return { ok:false, reason:'missing' };
      let context;
      const sources = [];
      try {
        context = new this.AudioContext();
        if (context.state === 'suspended') await context.resume();
        if (!await stillCurrent()) throw new Error('invalidated');
        let audio;
        if (usesPcm) {
          if (!context.createBuffer) throw new Error('unsupported-pcm');
          audio = context.createBuffer(1, pcm16.length, pcmRate);
          const floats = new Float32Array(pcm16.length);
          for (let index = 0; index < pcm16.length; index += 1) floats[index] = pcm16[index] / (pcm16[index] < 0 ? 32768 : 32767);
          if (audio.copyToChannel) audio.copyToChannel(floats, 0);
          else if (audio.getChannelData) audio.getChannelData(0).set(floats);
          else throw new Error('unsupported-pcm');
        } else {
          const bytes = await clip.blob.arrayBuffer();
          audio = await context.decodeAudioData(bytes.slice(0));
        }
        if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) throw new Error('invalid-audio');
        if (usesTemporaryBlob && (audio.duration * 1000 < MIN_DURATION_MS || audio.duration * 1000 > TEST_MAX_DURATION_MS)) throw new Error('invalid-test-clip');
        if (usesPcm && audio.duration * 1000 > LIVE_MAX_DURATION_MS + 1) throw new Error('invalid-live-clip');
        if (!await stillCurrent()) throw new Error('invalidated');
        const settings = normalizeTuning(tuning);
        const durationSeconds = Math.min(TEST_MAX_DURATION_MS / 1000, audio.duration);
        const high = context.createBiquadFilter();
        const peak = context.createBiquadFilter();
        const compressor = context.createDynamicsCompressor();
        const mainGain = context.createGain();
        const echoDelay = context.createDelay();
        const echoGain = context.createGain();
        high.type = 'highpass'; high.frequency.value = 250 + settings.brightness * 6;
        peak.type = 'peaking'; peak.frequency.value = 1800; peak.Q.value = 1; peak.gain.value = settings.brightness / 15;
        compressor.threshold.value = -20; compressor.ratio.value = 5;
        mainGain.gain.value = .75;
        echoDelay.delayTime.value = .03;
        echoGain.gain.value = settings.doubleMix;
        high.connect(peak); peak.connect(compressor); compressor.connect(mainGain); compressor.connect(echoDelay); echoDelay.connect(echoGain);

        const baseTime = context.currentTime + .02;
        const starts = [];
        let durationMs;
        if (settings.timingMode === 'preserve') {
          const plan = grainPlan(durationSeconds);
          let audibleEnd = 0;
          plan.forEach(grain => {
            const source = context.createBufferSource();
            const windowGain = context.createGain();
            const scheduledOffset = grain.offset / settings.speedRate;
            const when = baseTime + scheduledOffset;
            const audibleGrainDuration = grain.duration / settings.pitchRate;
            audibleEnd = Math.max(audibleEnd, scheduledOffset + audibleGrainDuration);
            source.buffer = audio;
            source.playbackRate.value = settings.pitchRate;
            windowGain.gain.setValueAtTime(0, when);
            windowGain.gain.linearRampToValueAtTime(1, when + audibleGrainDuration / 2);
            windowGain.gain.linearRampToValueAtTime(0, when + audibleGrainDuration);
            source.connect(windowGain); windowGain.connect(high);
            sources.push(source);
            starts.push(() => source.start(when, grain.offset, grain.duration));
          });
          durationMs = Math.ceil(audibleEnd * 1000);
        } else {
          const source = context.createBufferSource();
          source.buffer = audio;
          source.playbackRate.value = settings.pitchRate;
          source.connect(high);
          sources.push(source);
          starts.push(() => source.start(baseTime, 0, durationSeconds));
          durationMs = Math.ceil(durationSeconds / settings.pitchRate * 1000);
        }
        // 保存音声はDB世代、一時音声はsessionを、出力接続の直前にも再確認する。
        if (!await stillCurrent()) throw new Error('invalidated');
        mainGain.connect(context.destination);
        echoGain.connect(context.destination);
        starts.forEach(start => start());
        const current = { context, sources, timer:null };
        this.playback = current;
        current.timer = this.setTimeout(() => {
          if (this.playback === current) this.playback = null;
          sources.forEach(source => { try { source.stop(); } catch (_) {} try { source.disconnect(); } catch (_) {} });
          try { context.close().catch(() => {}); } catch (_) {}
        }, Math.min(10000, durationMs + 180));
        if (resumeLiveAfterPlayback) this.resumeLiveEchoDetection(durationMs + 370);
        return { ok:true, durationMs, timingMode:settings.timingMode };
      } catch (_) {
        if (this.playback && this.playback.context === context) this.playback = null;
        sources.forEach(source => { try { source.stop(); } catch (_) {} try { source.disconnect(); } catch (_) {} });
        if (context) try { context.close().catch(() => {}); } catch (_) {}
        if (resumeLiveAfterPlayback) this.resumeLiveEchoDetection();
        return { ok:false, reason:'process-failed' };
      }
    } catch (_) {
      if (resumeLiveAfterPlayback) this.resumeLiveEchoDetection();
      return { ok:false, reason:'process-failed' };
    }
  };

  return {
    DB_NAME, DB_VERSION, STORE_NAME, META_STORE, MAX_DURATION_MS, MIN_DURATION_MS, RECORD_STOP_MS,
    STOP_WATCHDOG_MS, MAX_BYTES, MAX_CLIPS, MAX_TOTAL_CLIPS, TEST_MAX_DURATION_MS, TEST_STOP_MS, TEST_MAX_BYTES,
    ECHO_MAX_DURATION_MS, ECHO_STOP_MS, ECHO_MAX_BYTES, LIVE_CALIBRATION_MS, LIVE_PREROLL_MS,
    LIVE_SPEECH_START_MS, LIVE_SILENCE_END_MS, LIVE_UTTERANCE_STOP_MS, LIVE_MAX_DURATION_MS,
    LIVE_MAX_BYTES, LIVE_FRAME_MS, LIVE_MIN_RMS, LIVE_MAX_RMS, LIVE_THRESHOLD_MULTIPLIER,
    LIVE_CALIBRATION_PERCENTILE, LIVE_HEALTH_TIMEOUT_MS, GRAIN_MS, GRAIN_HOP_MS, MAX_GRAINS,
    DEFAULT_TUNING, normalizeTuning, normalizeTemporaryLimits, grainPlan, safeId, clipKey, supportedMime, validateClip,
    LiveEchoDetector,
    nextGeneration, epochMatches, VoiceMemory
  };
}));
