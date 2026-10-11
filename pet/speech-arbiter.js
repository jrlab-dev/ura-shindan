/* 発話を一匹ずつ直列化する小さな仲裁器。音声APIや保存は持たない。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionSpeechArbiter = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function SpeechArbiter() { this.queue = []; this.activePetId = ''; this.activeRequest = null; this.generation = 0; this.running = false; }
  SpeechArbiter.prototype.enqueue = function (petId, run) {
    const generation = this.generation;
    return new Promise(resolve => { this.queue.push({petId, run, request:null, generation, resolve}); this._drain(); });
  };
  SpeechArbiter.prototype.speak = function (request, run) {
    const value = request && typeof request === 'object' ? request : {};
    const petId = value.petId === 'pet-2' ? 'pet-2' : 'pet-1';
    const execute = typeof run === 'function' ? run : value.run;
    if (typeof execute !== 'function') return Promise.resolve(false);
    const generation = this.generation;
    const normalized = {
      petId,
      text: String(value.text || ''),
      sound: value.sound || null,
      assetKey: value.assetKey || '',
      activityToken: value.activityToken || null
    };
    return new Promise(resolve => { this.queue.push({petId, request:normalized, run:valid => execute(valid, normalized), generation, resolve}); this._drain(); });
  };
  SpeechArbiter.prototype._drain = async function () {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const item = this.queue.shift();
      if (item.generation !== this.generation) { item.resolve(false); continue; }
      this.activePetId = item.petId;
      this.activeRequest = item.request;
      try { await item.run(() => item.generation === this.generation); item.resolve(item.generation === this.generation); }
      catch (_) { item.resolve(false); }
      this.activePetId = '';
      this.activeRequest = null;
    }
    this.running = false;
  };
  SpeechArbiter.prototype.cancel = function () { this.generation += 1; this.queue.splice(0).forEach(item => item.resolve(false)); this.activePetId = ''; this.activeRequest = null; return this.generation; };
  SpeechArbiter.prototype.snapshot = function () { return { activePetId:this.activePetId, queued:this.queue.length, generation:this.generation, request:this.activeRequest }; };
  return { SpeechArbiter };
}));
