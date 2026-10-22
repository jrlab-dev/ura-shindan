/* 鍵盤用の軽量な合成音色。基音を保ち、高域成分は短く減衰させる。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionMusicInstruments = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const INSTRUMENTS = Object.freeze([
    { id:'piano', name:'ピアノ' }, { id:'musicbox', name:'オルゴール' }, { id:'wood', name:'木琴' }
  ].map(Object.freeze));
  // ratio / relative amplitude / decay time constant (seconds).
  const PARTIALS = Object.freeze({
    musicbox:[[1,.76,3.8],[2,.17,1.4],[3,.05,.55],[4,.02,.25]],
    wood:[[1,.84,1.35],[4,.14,.22],[10,.02,.08]]
  });
  function normalize(id) { return INSTRUMENTS.some(item => item.id === id) ? id : 'piano'; }
  function optionsHtml() { return INSTRUMENTS.map(item => `<option value="${item.id}">${item.name}</option>`).join(''); }
  function partialsFor(id, hz, sampleRate = 44100) {
    return (PARTIALS[normalize(id)] || []).filter(part => hz * part[0] < Math.min(14000, sampleRate * .45)).map(part => part.slice());
  }
  function createSource(ctx, id, hz, pianoWave = 'sine') {
    if (normalize(id) === 'piano') {
      const source = ctx.createOscillator();
      source.type = pianoWave;
      source.frequency.setValueAtTime(hz, ctx.currentTime);
      return source;
    }
    const parts = [];
    let disconnected = false;
    const disconnect = () => {
      if (disconnected) return;
      disconnected = true;
      parts.forEach(part => { try { part.osc.disconnect(); } catch (_) {} try { part.gain.disconnect(); } catch (_) {} });
    };
    try {
      for (const [ratio, amplitude, decay] of partialsFor(id, hz, ctx.sampleRate)) {
        const osc = ctx.createOscillator();
        const part = { osc, gain:null, amplitude, decay };
        parts.push(part);
        part.gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(hz * ratio, ctx.currentTime);
        osc.connect(part.gain);
      }
      if (!parts.length) throw new Error('unsupported pitch');
      return {
        connect(target) { parts.forEach(part => part.gain.connect(target)); },
        disconnect,
        start(at) {
          parts.forEach(part => {
            part.gain.gain.setValueAtTime(part.amplitude, at);
            const tail = Math.min(8, part.decay * 12);
            part.gain.gain.exponentialRampToValueAtTime(part.amplitude * Math.exp(-tail / part.decay), at + tail);
            if (tail < 8) part.gain.gain.exponentialRampToValueAtTime(.00000001, at + 8);
            part.osc.start(at);
          });
        },
        stop(at) { parts.forEach(part => { try { part.osc.stop(at); } catch (_) {} }); },
        addEventListener(name, callback) { parts[0].osc.addEventListener(name, callback); }
      };
    } catch (error) {
      parts.forEach(part => { try { part.osc.stop(); } catch (_) {} });
      disconnect();
      throw error;
    }
  }
  return { INSTRUMENTS, normalize, optionsHtml, partialsFor, createSource };
}));
