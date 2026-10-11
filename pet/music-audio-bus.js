/* おんがくの出力を一度だけ分岐する共通バス。
   スピーカーとラジカセ録音用MediaStreamDestinationへ同じ音を送る。
   録音できない端末でも、音楽再生本体は従来のWeb Audioへ戻れる。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionMusicAudioBus = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function defaultContextFactory() {
    const Factory = typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
    return Factory ? new Factory() : null;
  }

  function MusicAudioBus(options = {}) {
    this.audioContextFactory = options.audioContextFactory || defaultContextFactory;
    this.context = options.context || null;
    this.output = null;
    this.destination = null;
    this.route = null;
    this.failed = false;
  }

  MusicAudioBus.prototype.ensure = function () {
    if (this.route) return this.route;
    if (this.failed) return null;
    const Factory = this.audioContextFactory;
    if (!Factory || typeof Factory !== 'function') { this.failed = true; return null; }
    try {
      if (!this.context) {
        let created = null;
        try { created = Factory(); } catch (_) { created = null; }
        this.context = created && typeof created.createGain === 'function' ? created : new Factory();
      }
      if (!this.context.createGain || !this.context.createMediaStreamDestination || !this.context.destination) throw new Error('unsupported');
      this.output = this.context.createGain();
      this.destination = this.context.createMediaStreamDestination();
      this.output.connect(this.context.destination);
      this.output.connect(this.destination);
      this.route = { context:this.context, output:this.output, destination:this.destination };
      return this.route;
    } catch (_) {
      this.failed = true;
      this.output = null;
      this.destination = null;
      this.route = null;
      return null;
    }
  };

  MusicAudioBus.prototype.resume = function () {
    const route = this.ensure();
    if (!route || !route.context || typeof route.context.resume !== 'function') return Promise.resolve(route);
    if (route.context.state !== 'suspended') return Promise.resolve(route);
    return Promise.resolve(route.context.resume()).then(() => route).catch(() => null);
  };

  return { MusicAudioBus, defaultContextFactory };
}));
