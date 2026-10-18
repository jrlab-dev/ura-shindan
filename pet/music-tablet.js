/* 固定鍵盤で弾くための曲別編曲。原曲データは保持する。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionMusicTablet = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PLANS = {
    canon: { count:461, range:[59,83], runs:[[0,0],[141,12],[145,0],[149,12],[153,0],[225,-12],[253,0],[411,-12],[419,0],[433,12],[435,0]] },
    haru: { count:703, range:[64,88], runs:[[0,0],[326,12],[356,0],[372,12],[539,0]] },
    konpeito: { count:436, range:[62,86], runs:[[0,-12],[156,-24],[244,-12],[279,-24],[290,-12],[366,-24]],
      // カデンツァの広い分散和音を、同じ構成音の短い反復音型に編曲する。
      passage: { start:104, notes:[
        71,75,78,71,75,78,
        69,72,75,79,69,72,74,79,
        71,75,78,71,75,78,
        74,78,81,84,74,78,81,84,
        75,78,81,83,75,78,81,83,
        74,78,81,84,74,78,81,84,
        75,78,81,83,75,78,81,83
      ] }
    },
    donau: { count:484, range:[59,83], runs:[[0,0],[97,-12],[101,0],[106,-12],[167,0],[168,-12],[208,0],[250,-12],[254,0],[259,-12],[320,0],[321,12],[392,0],[402,12],[473,0]] }
  };
  function isBlack(midi) { return [1,3,6,8,10].includes((midi % 12 + 12) % 12); }
  function rangeFor(notes) {
    if (!notes.length) return null;
    let min = Math.min(...notes.map(n => n.midi));
    let max = Math.max(...notes.map(n => n.midi));
    const cMin = Math.floor(min / 12) * 12, cMax = Math.ceil(max / 12) * 12;
    if (cMax - cMin <= 24) return [cMin, cMax];
    if (isBlack(min)) min -= 1;
    if (isBlack(max)) max += 1;
    return max - min <= 24 ? [min, max] : null;
  }
  const cache = new WeakMap();
  function schoolKeyboardRange(score) {
    if (!score || !['twinkle','kakkou','chouchou','joy','musunde','ofuro'].includes(score.id)) return null;
    return score.notes?.length && score.notes.every(note => note.midi >= 53 && note.midi <= 77) ? [53,77] : null;
  }
  function arrange(score, edition = 'tablet') {
    if (!score || edition === 'original') return score;
    if (cache.has(score)) return cache.get(score);
    const plan = PLANS[score.id];
    if (plan && score.notes.length !== plan.count) return null;
    let run = 0;
    const notes = score.notes.map((note, index) => {
      if (!plan) return { ...note };
      while (run + 1 < plan.runs.length && index >= plan.runs[run + 1][0]) run += 1;
      const passageIndex = plan.passage ? index - plan.passage.start : -1;
      const midi = passageIndex >= 0 && passageIndex < plan.passage.notes.length ? plan.passage.notes[passageIndex] : note.midi + plan.runs[run][1];
      const octave = note.octave == null ? Math.floor(midi / 12) - 1 : note.octave + (midi - note.midi) / 12;
      return { ...note, midi, octave, name:note.name ? note.name.replace(/\d+$/, String(octave)) : '' };
    });
    const range = schoolKeyboardRange(score) || (plan ? plan.range : rangeFor(notes));
    if (!range || notes.some(n => n.midi < range[0] || n.midi > range[1])) return null;
    const result = { ...score, notes, edition:'tablet', arranged:Boolean(plan), keyboardRange:range.slice(), title:score.title?.replace(/（原曲）/g, '') };
    cache.set(score, result);
    return result;
  }
  return { arrange, rangeFor, isBlack, schoolKeyboardRange };
}));
