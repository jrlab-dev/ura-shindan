/* おんがくの直接録音（設計書 ラジカセくん録音v1）。
   マイクを使わずMusicAudioBusのMediaStreamDestinationだけを録る。
   既存radio-recorder.jsへ保存し、録音は常に1件だけにする。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionMusicRecording = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_DURATION_MS = 30000;
  const MIN_KEEP_MS = 1000;
  const MAX_BYTES = 3072 * 1024;
  const MIME_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  const supportedMime = mime => /^audio\/(?:webm|ogg|mp4|mpeg)(?:;|$)/i.test(String(mime || ''));

  function pickMimeType(MediaRecorderClass) {
    if (!MediaRecorderClass) return '';
    if (typeof MediaRecorderClass.isTypeSupported !== 'function') return '';
    return MIME_TYPES.find(type => { try { return MediaRecorderClass.isTypeSupported(type); } catch (_) { return false; } }) || '';
  }

  function MusicRecordingController(options = {}) {
    this.audioBus = options.audioBus || null;
    this.radioEngine = options.radioEngine || null;
    this.MediaRecorderClass = options.MediaRecorderClass || (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null);
    this.now = options.now || (() => Date.now());
    this.setTimeout = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeout = options.clearTimeout || (id => clearTimeout(id));
    this.decodeAudio = options.decodeAudio || null;
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
    this.recording = null;
    this.timer = null;
    this.stopTimer = null;
    this.generation = 0;
  }

  MusicRecordingController.prototype.state = function (extra = {}) {
    const current = this.recording;
    const elapsed = current ? Math.max(0, this.now() - current.startedAt) : 0;
    return Object.assign({ recording:Boolean(current), elapsedMs:elapsed, remainingSeconds:Math.max(0, Math.ceil((MAX_DURATION_MS - elapsed) / 1000)), message:'', reason:'' }, extra);
  };
  MusicRecordingController.prototype.emit = function (extra) { if (this.onChange) this.onChange(this.state(extra)); };
  MusicRecordingController.prototype.clearTimer = function () { if (this.timer != null) this.clearTimeout(this.timer); if (this.stopTimer != null) this.clearTimeout(this.stopTimer); this.timer = null; this.stopTimer = null; };
  MusicRecordingController.prototype.tick = function (token) {
    if (!this.recording || this.recording.token !== token) return;
    this.emit();
    this.timer = this.setTimeout(() => this.tick(token), 200);
  };
  MusicRecordingController.prototype.start = async function () {
    if (this.recording) return { ok:false, reason:'busy' };
    const route = this.audioBus && this.audioBus.ensure ? this.audioBus.ensure() : null;
    const MR = this.MediaRecorderClass;
    if (!route || !route.destination || !route.destination.stream || !MR) { this.emit({ message:'この端末では おんがくを録れないよ', reason:'unsupported' }); return { ok:false, reason:'unsupported' }; }
    const token = ++this.generation;
    if (token !== this.generation) return { ok:false, reason:'cancelled' };
    try {
      if (route.context && route.context.state === 'suspended' && route.context.resume) await route.context.resume();
      if (token !== this.generation) return { ok:false, reason:'cancelled' };
      const mimeType = pickMimeType(MR);
      const recorder = mimeType ? new MR(route.destination.stream, { mimeType }) : new MR(route.destination.stream);
      const state = { token, recorder, context:route.context, startedAt:this.now(), chunks:[], cancelled:false, stopping:false, resolve:null, promise:null };
      this.recording = state;
      const resultPromise = new Promise(resolve => { state.resolve = resolve; });
      state.promise = resultPromise;
      recorder.ondataavailable = event => { if (!state.cancelled && event.data && event.data.size) state.chunks.push(event.data); };
      recorder.onerror = () => {
        state.cancelled = true;
        state.cancelReason = 'record-failed';
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) { this._finish(state, { ok:false, reason:'record-failed' }); }
      };
      recorder.onstop = () => this._finish(state);
      recorder.start();
      this.emit({ message:'ろくおんちゅう… おんがくを えらんでね' });
      this.clearTimer();
      this.stopTimer = this.setTimeout(() => { if (this.recording && this.recording.token === token) this.stop(); }, MAX_DURATION_MS);
      this.tick(token);
      return resultPromise;
    } catch (_) {
      this.clearTimer();
      this.recording = null;
      this.emit({ message:'この端末では おんがくを録れないよ', reason:'unsupported' });
      return { ok:false, reason:'unsupported' };
    }
  };
  MusicRecordingController.prototype.stop = function () {
    const current = this.recording;
    if (!current) return Promise.resolve({ ok:false, reason:'not-recording' });
    if (current.stopping) return current.promise || Promise.resolve({ ok:false, reason:'stopping' });
    current.stopping = true;
    try { if (current.recorder.state !== 'inactive') current.recorder.stop(); else this._finish(current); } catch (_) { this._finish(current, { ok:false, reason:'record-failed' }); }
    return current.promise || Promise.resolve({ ok:false, reason:'record-failed' });
  };
  MusicRecordingController.prototype.cancel = function (reason = 'cancelled') {
    this.generation += 1;
    const current = this.recording;
    if (!current) { this.clearTimer(); this.emit({ message:'', reason }); return Promise.resolve({ ok:false, reason }); }
    current.cancelled = true;
    current.cancelReason = reason;
    if (this.radioEngine && typeof this.radioEngine.cancelPendingSave === 'function') this.radioEngine.cancelPendingSave();
    if (current.stopping) return current.promise || Promise.resolve({ ok:false, reason });
    current.stopping = true;
    try { if (current.recorder.state !== 'inactive') current.recorder.stop(); else this._finish(current); } catch (_) { this._finish(current, { ok:false, reason }); }
    return current.promise || Promise.resolve({ ok:false, reason });
  };
  MusicRecordingController.prototype._finish = function (current, forcedResult = null) {
    if (!current || current.done) return;
    current.done = true;
    this.clearTimer();
    const finish = async () => {
      const elapsed = Math.max(0, (current.stoppedAt || this.now()) - current.startedAt);
      let result = forcedResult;
      if (!result && current.cancelled) result = { ok:false, reason:current.cancelReason || 'cancelled' };
      if (!result) {
        const type = current.recorder.mimeType || (current.chunks[0] && current.chunks[0].type) || '';
        const blob = new Blob(current.chunks, { type });
        if (!supportedMime(blob.type) || !blob.size || blob.size > MAX_BYTES) result = { ok:false, reason:'invalid-radio-clip' };
        else if (elapsed < MIN_KEEP_MS) result = { ok:false, reason:'too-short' };
        else if (elapsed > MAX_DURATION_MS + 800) result = { ok:false, reason:'too-long' };
        else {
          const decoded = await this.inspectBlob(blob, current);
          if (!decoded.ok) result = decoded;
          else if (!this.radioEngine || typeof this.radioEngine.save !== 'function') result = { ok:false, reason:'save-failed' };
          else if (current.token !== this.generation) result = { ok:false, reason:'cancelled' };
          else result = await this.radioEngine.save({ blob, mimeType:blob.type, durationMs:decoded.durationMs, bytes:blob.size });
          if (current.token !== this.generation) result = { ok:false, reason:'cancelled' };
        }
      }
      if (this.recording === current) this.recording = null;
      this.emit({ message:result.ok ? 'うつったよ！ きいてみてね' : result.reason === 'too-short' ? 'ちょっと みじかかった。もういちど！' : result.reason === 'cancelled' ? '' : 'ろくおんできなかったよ', reason:result.reason });
      if (current.resolve) current.resolve(result);
      return result;
    };
    current.stoppedAt = this.now();
    current.promise = finish();
  };

  MusicRecordingController.prototype.inspectBlob = async function (blob, current) {
    const decoder = this.decodeAudio || (current && current.context && current.context.decodeAudioData ? current.context.decodeAudioData.bind(current.context) : null);
    if (!decoder) return { ok:false, reason:'decode-failed' };
    try {
      const bytes = await blob.arrayBuffer();
      const decoded = await decoder(bytes);
      const durationMs = Math.round(Number(decoded && decoded.duration) * 1000);
      if (!Number.isFinite(durationMs) || durationMs < MIN_KEEP_MS) return { ok:false, reason:'too-short' };
      if (durationMs > MAX_DURATION_MS + 800) return { ok:false, reason:'too-long' };
      let peak = 0;
      const channels = Math.max(0, Math.min(8, Math.floor(Number(decoded && decoded.numberOfChannels) || 0)));
      for (let channel = 0; channel < channels; channel += 1) {
        const data = decoded.getChannelData(channel);
        for (let index = 0; index < data.length; index += 1) peak = Math.max(peak, Math.abs(Number(data[index]) || 0));
      }
      if (peak <= 0.0001) return { ok:false, reason:'silent' };
      return { ok:true, durationMs, peak };
    } catch (_) { return { ok:false, reason:'decode-failed' }; }
  };

  return { MAX_DURATION_MS, MIN_KEEP_MS, MAX_BYTES, MIME_TYPES, supportedMime, pickMimeType, MusicRecordingController };
}));
