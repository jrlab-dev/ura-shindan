/* 音声時計に合わせた伴奏専用プレーヤー。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./music-accompaniment-data.js'));
  else root.LittleCompanionMusicAccompaniment = factory(root.LittleCompanionMusicAccompanimentData);
}(typeof self !== 'undefined' ? self : this, function (Data) {
  'use strict';
  const AHEAD = .15;
  const LATE = .06;
  function Player(ctx, output, data = Data) {
    this.ctx = ctx; this.data = data || {}; this.output = output || ctx.destination;
    this.voices = new Set(); this.track = null; this.cursor = 0; this.volume = .35;
    this.bus = ctx.createGain(); this.bus.gain.setValueAtTime(this.volume, ctx.currentTime); this.bus.connect(this.output);
  }
  Player.prototype.setVolume = function (value) {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : this.volume));
    if (this.bus.gain.setTargetAtTime) this.bus.gain.setTargetAtTime(this.volume, this.ctx.currentTime, .015);
    else this.bus.gain.setValueAtTime(this.volume, this.ctx.currentTime);
  };
  Player.prototype.start = function (id, at, speed) {
    this.stop();
    if (!this.data[id] || !Number.isFinite(at) || ![.5,.75,1].includes(speed)) return false;
    this.track = this.data[id]; this.at = at; this.speed = speed; this.cursor = 0;
    this.pump(); return true;
  };
  Player.prototype.release = function (voice, stop = false) {
    if (!this.voices.delete(voice)) return;
    if (stop) { try { voice.source.stop(); } catch (_) {} }
    voice.source.disconnect(); voice.gain.disconnect();
  };
  Player.prototype.stop = function () {
    this.track = null; this.cursor = 0;
    for (const voice of [...this.voices]) this.release(voice, true);
  };
  Player.prototype.pump = function () {
    if (!this.track) return;
    const now = this.ctx.currentTime;
    for (const voice of [...this.voices]) if (voice.end <= now) this.release(voice);
    while (this.cursor < this.track.notes.length) {
      const note = this.track.notes[this.cursor];
      const due = this.at + note[1] / this.speed;
      if (due > now + AHEAD) break;
      this.cursor++;
      const end = this.at + (note[1] + note[2]) / this.speed;
      // A delayed UI tick must never replay a burst of missed notes.
      if (due < now - LATE || end <= now + .01) continue;
      const start = Math.max(now, due);
      const source = this.ctx.createOscillator(), gain = this.ctx.createGain();
      source.type = 'triangle'; source.frequency.setValueAtTime(440 * 2 ** ((note[0] - 69) / 12), start);
      const peak = .07 / Math.sqrt(Math.max(1, this.track.maxVoices));
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, Math.min(start + .008, start + (end-start)*.2));
      gain.gain.exponentialRampToValueAtTime(peak * .55, start + (end-start)*.55);
      gain.gain.exponentialRampToValueAtTime(.0001, end);
      source.connect(gain); gain.connect(this.bus);
      const voice = {source, gain, end}; this.voices.add(voice);
      source.addEventListener('ended', () => this.release(voice));
      source.start(start); source.stop(end);
    }
  };
  return { Player, Data, AHEAD, LATE };
}));
