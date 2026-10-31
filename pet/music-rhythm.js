/* おんがくリズムゲーム。表示・採点・任意の伴奏は音声の時計を共有する。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./music-tablet.js'), require('./music-instruments.js'), require('./music-accompaniment.js'), require('./music-effects.js'));
  else root.LittleCompanionMusicRhythm = factory(root.LittleCompanionMusicTablet, root.LittleCompanionMusicInstruments, root.LittleCompanionMusicAccompaniment, root.LittleCompanionMusicEffects);
}(typeof self !== 'undefined' ? self : this, function (Tablet, Instruments, Accompaniment, Effects) {
  'use strict';

  const COUNTDOWN_MS = 3000;
  const PERFECT_MS = 180;
  const NICE_MS = 400;
  const HIT_FEEDBACK_SECONDS = .65;
  const TIMING_EPSILON_MS = 0.000001;
  const LOOK_AHEAD_SECONDS = 3;
  const KEY_TAP_SECONDS = 0.25;
  const KEY_RELEASE_SECONDS = 0.08;
  const KEY_DECAY_SECONDS = 6;
  const KEY_END_SECONDS = 8;
  const MAX_VOICES = 6;
  const PITCH_NAMES = ['ド','ド♯','レ','レ♯','ミ','ファ','ファ♯','ソ','ソ♯','ラ','ラ♯','シ'];
  const SPEEDS = Object.freeze({ slow:0.5, gentle:0.75, normal:1 });
  const SPEED_LABELS = Object.freeze({ slow:'ゆっくり', gentle:'すこしゆっくり', normal:'ふつう' });
  const DIFFICULTIES = Object.freeze({ easy:'かんたん', step:'かんたん＋', normal:'ふつう', hard:'むずかしい' });
  /* 標準速度の密度・黒鍵・音域・跳躍を見比べた初版の分類表。曲データの音を変更しない。 */
  const DIFFICULTY_TABLE = Object.freeze({
    twinkle:{ group:'easy', reason:'白鍵中心・単旋律・6音の入口' },
    kakkou:{ group:'easy', reason:'白鍵5音・3拍子・短い旋律で長音を練習' },
    london:{ group:'step', reason:'白鍵6音・短い曲で付点リズムを練習' },
    grace:{ group:'normal', reason:'長い音と黒鍵・短い音型を含むゆったりした旋律' },
    minuet:{ group:'normal', reason:'3拍子・八分音符の連続・黒鍵と広めの移動' },
    chouchou:{ group:'step', reason:'白鍵5音・同音反復と順次進行' },
    joy:{ group:'step', reason:'白鍵の単旋律で付点と八分音符に進む' },
    musunde:{ group:'step', reason:'白鍵6音・八分音符のリズムをゆったり練習' },
    ofuro:{ group:'normal', reason:'音域と跳躍が中程度' },
    masu:{ group:'hard', reason:'黒鍵が多く音域も広い' },
    jesu:{ group:'hard', reason:'音数と跳躍が多い' },
    donau:{ group:'hard', reason:'音域と跳躍が広い' },
    canon:{ group:'hard', reason:'音数と黒鍵が多く音域も広い' },
    haru:{ group:'hard', reason:'高密度・黒鍵・跳躍が多い' },
    konpeito:{ group:'hard', reason:'高密度・高音域・細かな跳躍' }
  });
  const PITCH_CLASSES = [1, 3, 6, 8, 10];

  function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function getScoreMap(data) { return data && data.scores && typeof data.scores === 'object' ? data.scores : data || {}; }
  function normalizeScore(score) {
    if (!score || !Array.isArray(score.notes)) return null;
    const notes = score.notes.map((note, index) => ({
      midi:Math.round(number(note.midi, 60)), start:Math.max(0, number(note.start)), duration:Math.max(.001, number(note.duration, .25)), index
    })).sort((a, b) => a.start - b.start || a.index - b.index);
    const duration = Math.max(number(score.duration), ...notes.map(note => note.start + note.duration), 0);
    return Object.assign({}, score, { notes, duration });
  }
  function difficultyFor(id) { return DIFFICULTY_TABLE[id] || { group:'normal', reason:'音数・音域を基準に分類' }; }
  function scorePoints(total, perfect, nice) { return total > 0 ? Math.max(0, Math.min(100, Math.round((perfect + nice * .7) / total * 100))) : 0; }
  function isBlack(midi) { return PITCH_CLASSES.includes(((Math.round(midi) % 12) + 12) % 12); }
  function keyboardLayout(score) {
    if (!score || !score.notes || !score.notes.length) return { min:0, max:0, whiteCount:0, keys:[] };
    const minNote = Math.min(...score.notes.map(note => note.midi));
    const maxNote = Math.max(...score.notes.map(note => note.midi));
    const range = Tablet.schoolKeyboardRange(score) || score.keyboardRange;
    const min = range ? range[0] : Math.max(0, Math.floor(minNote / 12) * 12);
    const max = range ? range[1] : Math.min(127, Math.ceil(maxNote / 12) * 12);
    let whiteIndex = 0;
    const keys = [];
    for (let midi = min; midi <= max; midi += 1) {
      if (isBlack(midi)) keys.push({ midi, black:true, boundary:whiteIndex });
      else { keys.push({ midi, black:false, boundary:whiteIndex }); whiteIndex += 1; }
    }
    return { min, max, whiteCount:whiteIndex, keys };
  }
  function keyPosition(layout, midi) {
    const key = layout.keys.find(item => item.midi === midi);
    if (!key || !layout.whiteCount) return { left:0, width:0 };
    const unit = 100 / layout.whiteCount;
    return { left:(key.black ? key.boundary - .33 : key.boundary) * unit, width:(key.black ? .66 : 1) * unit };
  }
  function nowMs() { return Date.now(); }
  function keyLevel(elapsed) {
    if (elapsed < .008) return .0001 + (.16 - .0001) * Math.max(0, elapsed) / .008;
    if (elapsed < .12) return .16 * Math.pow(.13 / .16, (elapsed - .008) / .112);
    if (elapsed < KEY_DECAY_SECONDS) return .13 * Math.pow(.02 / .13, (elapsed - .12) / (KEY_DECAY_SECONDS - .12));
    return .02 * Math.pow(.0001 / .02, Math.min(1, (elapsed - KEY_DECAY_SECONDS) / (KEY_END_SECONDS - KEY_DECAY_SECONDS)));
  }

  function MusicRhythmController(options = {}) {
    this.data = options.scoreData || null;
    this.trackIds = Array.isArray(options.trackIds) ? options.trackIds.slice() : [];
    this.audioContext = options.audioContext || null;
    this.outputNode = options.outputNode || null;
    this.audioContextFactory = options.audioContextFactory || null;
    this.beforePlay = typeof options.beforePlay === 'function' ? options.beforePlay : null;
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
    this.onRunStart = options.onRunStart || null;
    this.onRunFinish = options.onRunFinish || null;
    this.onRunCancel = options.onRunCancel || null;
    this.now = options.now || nowMs;
    this.setTimeout = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeout = options.clearTimeout || (id => clearTimeout(id));
    this.setInterval = options.setInterval || ((fn, ms) => setInterval(fn, ms));
    this.clearInterval = options.clearInterval || (id => clearInterval(id));
    this.requestFrame = options.requestAnimationFrame || (typeof requestAnimationFrame === 'function' ? fn => requestAnimationFrame(fn) : null);
    this.cancelFrame = options.cancelAnimationFrame || (typeof cancelAnimationFrame === 'function' ? id => cancelAnimationFrame(id) : () => {});
    this.frame = null;
    this.root = null;
    this.ctx = null;
    this.score = null;
    this.trackId = '';
    this.edition = 'tablet';
    this.instrument = 'piano';
    this.onInstrumentChange = typeof options.onInstrumentChange === 'function' ? options.onInstrumentChange : null;
    this.speed = SPEEDS.gentle;
    this.phase = 'idle';
    this.generation = 0;
    this.effects = new Effects.Events();
    this.effectsMode = 'normal';
    this.motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.startedAt = 0;
    this.countdownEnd = 0;
    this.countdownTimer = null;
    this.timer = null;
    this.nextIndex = 0;
    this.judged = [];
    this.hits = 0;
    this.perfect = 0;
    this.nice = 0;
    this.missed = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hitSequence = 0;
    this.lastGrade = '';
    this.lastHit = null;
    this.message = '';
    this.error = '';
    this.voices = new Map();
    this.heldInputs = new Map();
    this.volume = .9;
    this.keyOutput = null;
    this.accompaniment = false;
    this.accompanimentVolume = .35;
    this.accompanimentPlayer = null;
    this.renderSignature = '';
  }
  MusicRhythmController.prototype.emit = function () { if (this.onChange) this.onChange(this.getState()); this.render(); };
  MusicRhythmController.prototype.audio = function () {
    if (this.ctx) return this.ctx;
    if (this.audioContext) { this.ctx = this.audioContext; return this.ctx; }
    const Factory = this.audioContextFactory || (typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null));
    if (!Factory) return null;
    try { this.ctx = new Factory(); } catch (_) { this.ctx = null; }
    return this.ctx;
  };
  MusicRhythmController.prototype.audioTime = function () {
    /* 画面を開いただけではAudioContextを作らず、音声時計がない間は壁時計を使う。 */
    const ctx = this.ctx;
    return ctx && Number.isFinite(ctx.currentTime) ? ctx.currentTime : this.now() / 1000;
  };
  MusicRhythmController.prototype.getScore = function (id) { const score = getScoreMap(this.data)[id]; return normalizeScore(score && score.id ? Tablet.arrange(score, this.edition) : null); };
  MusicRhythmController.prototype.setInstrument = function (instrument) {
    const next = Instruments.normalize(instrument);
    if (next === this.instrument) return;
    this.stop(false);
    this.instrument = next;
    this.renderSignature = '';
    if (this.onInstrumentChange) this.onInstrumentChange(next);
    this.emit();
  };
  MusicRhythmController.prototype.setEdition = function (edition) {
    const next = edition === 'original' ? 'original' : 'tablet';
    if (next === this.edition) return;
    this.edition = next; this.select(this.trackId);
  };
  MusicRhythmController.prototype.fitsViewport = function () {
    return this.edition !== 'tablet' || !this.root || !this.root.clientWidth || this.root.clientWidth - 2 >= keyboardLayout(this.score).whiteCount * 44;
  };
  MusicRhythmController.prototype.select = function (id) {
    this.stop(false);
    this.trackId = id || '';
    this.score = this.getScore(this.trackId);
    this.emit();
    this.scrollToFirstNote();
    return this.score;
  };
  MusicRhythmController.prototype.setData = function (data) { this.stop(false); this.data = data || null; this.score = this.getScore(this.trackId); this.renderSignature = ''; this.emit(); };
  MusicRhythmController.prototype.clearTimers = function () {
    if (this.frame != null) this.cancelFrame(this.frame);
    this.frame = null;
    if (this.countdownTimer != null) this.clearTimeout(this.countdownTimer);
    if (this.timer != null) this.clearInterval(this.timer);
    this.countdownTimer = null; this.timer = null;
  };
  MusicRhythmController.prototype.clearVoices = function () {
    this.heldInputs.clear();
    Array.from(this.voices.values()).forEach(entry => this.releaseVoice(entry));
    this.voices.clear();
  };
  MusicRhythmController.prototype.releaseVoice = function (entry, stopNode = true) {
    if (!entry || entry.released) return;
    entry.released = true;
    if (this.voices.get(entry.midi) === entry) this.voices.delete(entry.midi);
    if (entry.timer != null) { try { this.clearTimeout(entry.timer); } catch (_) {} entry.timer = null; }
    if (stopNode) { try { entry.oscillator.stop(); } catch (_) {} }
    try { entry.oscillator.disconnect(); } catch (_) {}
    try { entry.gain.disconnect(); } catch (_) {}
  };
  MusicRhythmController.prototype.setEffectsMode = function (value) { this.effectsMode = value === 'quiet' ? 'quiet' : 'normal'; this.paint(); };
  MusicRhythmController.prototype.setVolume = function (value) {
    this.volume = Math.max(0, Math.min(1, number(value, this.volume)));
    if (this.keyOutput) {
      const gain = this.keyOutput.gain;
      if (gain.setTargetAtTime) gain.setTargetAtTime(this.volume, this.audioTime(), .015);
      else gain.setValueAtTime(this.volume, this.audioTime());
    }
    this.paint();
  };
  MusicRhythmController.prototype.setAccompaniment = function (enabled) {
    if (this.accompaniment === Boolean(enabled)) return;
    this.stop(false); this.accompaniment = Boolean(enabled); this.emit();
  };
  MusicRhythmController.prototype.setAccompanimentVolume = function (value) {
    this.accompanimentVolume = Math.max(0, Math.min(1, number(value, this.accompanimentVolume)));
    if (this.accompanimentPlayer) this.accompanimentPlayer.setVolume(this.accompanimentVolume);
    this.paint();
  };
  MusicRhythmController.prototype.endVoice = function (entry, at = this.audioTime()) {
    if (!entry || entry.released || Number.isFinite(entry.noteOffAt) || at >= entry.naturalEndAt) return;
    entry.noteOffAt = at;
    at = Math.max(at, entry.startedAt + .008);
    const gain = entry.gain.gain;
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(at);
    else if (gain.cancelScheduledValues) gain.cancelScheduledValues(at);
    const elapsed = Math.max(0, at - entry.startedAt);
    const level = keyLevel(elapsed);
    // 離鍵時の値を明示し、消音ランプが保持区間まで遡らないようにする。
    gain.setValueAtTime(level, at);
    gain.exponentialRampToValueAtTime(.0001, at + KEY_RELEASE_SECONDS);
    entry.oscillator.stop(at + KEY_RELEASE_SECONDS + .01);
    if (entry.timer != null) this.clearTimeout(entry.timer);
    const timer = this.setTimeout(() => { this.releaseVoice(entry, false); this.emit(); }, Math.max(0, at - this.audioTime()) * 1000 + 160);
    entry.timer = timer; if (timer && typeof timer.unref === 'function') timer.unref();
  };
  MusicRhythmController.prototype.releaseKey = function (inputId) {
    const input = this.heldInputs.get(inputId); if (!input) return;
    this.heldInputs.delete(inputId);
    if (![...this.heldInputs.values()].some(other => other.midi === input.midi)) this.endVoice(this.voices.get(input.midi));
    this.emit();
  };
  MusicRhythmController.prototype.stop = function (emit = true) {
    if (this.onRunCancel) this.onRunCancel();
    this.generation += 1;
    this.effects.reset(this.generation);
    this.clearTimers(); this.clearVoices();
    if (this.accompanimentPlayer) this.accompanimentPlayer.stop();
    this.phase = 'idle'; this.startedAt = 0; this.countdownEnd = 0; this.nextIndex = 0;
    this.judged = []; this.hits = 0; this.perfect = 0; this.nice = 0; this.missed = 0;
    this.combo = 0; this.maxCombo = 0; this.hitSequence = 0; this.lastGrade = '';
    this.lastHit = null;
    this.message = ''; this.error = '';
    if (emit) this.emit();
  };
  MusicRhythmController.prototype.setSpeed = function (speed) {
    const value = typeof speed === 'string' ? SPEEDS[speed] : number(speed, SPEEDS.gentle);
    const keys = Object.keys(SPEEDS); this.speed = keys.reduce((best, key) => Math.abs(SPEEDS[key] - value) < Math.abs(SPEEDS[best] - value) ? key : best, 'gentle');
    this.speed = SPEEDS[this.speed];
    this.stop(false); this.emit(); this.scrollToFirstNote();
  };
  MusicRhythmController.prototype.start = async function () {
    if (!this.score || !this.score.notes.length) { this.error = '曲をえらんでね'; this.emit(); return false; }
    this.stop(false);
    if (!this.fitsViewport()) { this.emit(); return false; }
    if (this.beforePlay && this.beforePlay() === false) { this.error = '音がオフだよ。上の🔊でオンにしてね'; this.emit(); return false; }
    const ctx = this.audio();
    if (!ctx) { this.error = 'この端末では音を鳴らせないよ'; this.emit(); return false; }
    const token = ++this.generation;
    this.effects.reset(token);
    try { if (ctx.state === 'suspended' && ctx.resume) await ctx.resume(); } catch (_) { if (token === this.generation) { this.error = '音を準備できなかったよ。もう一度おしてね'; this.emit(); } return false; }
    if (token !== this.generation) return false;
    if (!this.fitsViewport()) { this.emit(); return false; }
    this.phase = 'countdown'; this.error = ''; this.message = 'じゅんび… 3'; this.countdownEnd = this.audioTime() + COUNTDOWN_MS / 1000;
    if (this.onRunStart) this.onRunStart(this);
    if (this.accompaniment && Accompaniment) {
      if (!this.accompanimentPlayer) this.accompanimentPlayer = new Accompaniment.Player(ctx, this.outputNode);
      this.accompanimentPlayer.setVolume(this.accompanimentVolume);
      this.accompanimentPlayer.start(this.trackId, this.countdownEnd, this.speed);
    }
    this.timer = this.setInterval(() => this.tick(), 50);
    this.countdownTimer = this.setTimeout(() => this.begin(token), COUNTDOWN_MS + 20);
    if (this.requestFrame) {
      const animate = () => {
        if (token !== this.generation || (this.phase !== 'countdown' && this.phase !== 'playing')) return;
        this.paint();
        this.frame = this.requestFrame(animate);
      };
      this.frame = this.requestFrame(animate);
    }
    this.emit();
    this.scrollToFirstNote();
    return true;
  };
  MusicRhythmController.prototype.begin = function (token = this.generation) {
    if (token !== this.generation || this.phase !== 'countdown') return false;
    this.phase = 'playing'; this.startedAt = this.countdownEnd; this.nextIndex = 0; this.judged = this.score.notes.map(() => 'pending'); this.message = 'けんばんが光ったら おしてね';
    this.emit(); return true;
  };
  MusicRhythmController.prototype.dueTime = function (note) { const base = this.phase === 'countdown' ? this.countdownEnd : this.startedAt; return base + note.start / this.speed; };
  MusicRhythmController.prototype.songTime = function (atTime = this.audioTime()) { return Math.max(0, (atTime - this.startedAt) * this.speed); };
  MusicRhythmController.prototype.tick = function () {
    if (this.accompanimentPlayer && (this.phase === 'countdown' || this.phase === 'playing')) this.accompanimentPlayer.pump();
    if (this.phase === 'countdown') {
      const left = Math.max(0, this.countdownEnd - this.audioTime());
      this.message = left <= 0 ? 'スタート！' : `じゅんび… ${Math.ceil(left)}`;
      if (left <= 0) this.begin(this.generation); else this.emit();
      return;
    }
    if (this.phase !== 'playing' || !this.score) return;
    const at = this.audioTime();
    this.markMissed(at);
    if (this.nextIndex >= this.score.notes.length && at >= this.startedAt + this.score.duration / this.speed) this.finish();
    else this.emit();
  };
  MusicRhythmController.prototype.markMissed = function (at) {
    while (this.nextIndex < this.score.notes.length && at - this.dueTime(this.score.notes[this.nextIndex]) > (NICE_MS + TIMING_EPSILON_MS) / 1000) {
      this.judged[this.nextIndex] = 'missed'; this.missed += 1; this.nextIndex += 1;
      this.combo = 0; this.lastGrade = ''; this.message = 'つぎの光をみてね';
    }
  };
  MusicRhythmController.prototype.playKeySound = function (midi, at, held = false) {
    const ctx = this.ctx || this.audio(); if (!ctx || !ctx.createOscillator || !ctx.createGain) return false;
    const old = this.voices.get(midi); if (old) this.releaseVoice(old);
    while (this.voices.size >= MAX_VOICES) { const oldest = this.voices.values().next().value; this.releaseVoice(oldest); }
    try {
      if (!this.keyOutput) { this.keyOutput = ctx.createGain(); this.keyOutput.gain.setValueAtTime(this.volume, at); this.keyOutput.connect(this.outputNode || ctx.destination); }
      const frequency = 440 * Math.pow(2, (midi - 69) / 12);
      const oscillator = Instruments.createSource(ctx, this.instrument, frequency, 'triangle'); const gain = ctx.createGain();
      gain.gain.setValueAtTime(.0001, at);
      if (gain.gain.linearRampToValueAtTime) gain.gain.linearRampToValueAtTime(.16, at + .008);
      else gain.gain.exponentialRampToValueAtTime(.16, at + .008);
      gain.gain.exponentialRampToValueAtTime(.13, at + .12);
      gain.gain.exponentialRampToValueAtTime(.02, at + KEY_DECAY_SECONDS);
      gain.gain.exponentialRampToValueAtTime(.0001, at + KEY_END_SECONDS);
      oscillator.connect(gain); gain.connect(this.keyOutput); oscillator.start(at);
      oscillator.stop(at + KEY_END_SECONDS + .01);
      const entry = { midi, oscillator, gain, timer:null, startedAt:at, naturalEndAt:at + KEY_END_SECONDS, noteOffAt:Infinity }; this.voices.set(midi, entry);
      const release = () => { this.releaseVoice(entry, false); this.emit(); };
      if (oscillator.addEventListener) oscillator.addEventListener('ended', release);
      entry.timer = this.setTimeout(release, Math.max(0, at - this.audioTime() + KEY_END_SECONDS) * 1000 + 160);
      if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
      if (!held) this.endVoice(entry, at + KEY_TAP_SECONDS);
      return true;
    } catch (_) { return false; }
  };
  MusicRhythmController.prototype.pressKey = async function (midi, atTime = null, inputId = null) {
    if (!this.score) return { ok:false, reason:'inactive' };
    midi = Math.round(number(midi, -1));
    if (midi < 0 || midi > 127) return { ok:false, reason:'invalid' };
    if (inputId != null && this.heldInputs.has(inputId)) return { ok:false, reason:'repeat' };
    if (this.beforePlay && this.beforePlay() === false) { this.error = '音がオフだよ。上の🔊でオンにしてね'; this.emit(); return { ok:false, reason:'muted' }; }
    const token = this.generation; const ctx = this.ctx || this.audio(); if (!ctx) return { ok:false, reason:'unsupported' };
    const input = { midi };
    if (inputId != null) this.heldInputs.set(inputId, input);
    try { if (ctx.state === 'suspended' && ctx.resume) await ctx.resume(); } catch (_) {
      if (this.heldInputs.get(inputId) === input) this.heldInputs.delete(inputId);
      return { ok:false, reason:'resume-failed' };
    }
    if (token !== this.generation || (inputId != null && this.heldInputs.get(inputId) !== input)) return { ok:false, reason:'stale' };
    this.error = '';
    const at = atTime == null ? this.audioTime() : Number(atTime);
    this.playKeySound(midi, this.audioTime(), inputId != null);
    /* 初音もGOODの受付幅を使い、演奏時計は予告終了時刻を保つ。 */
    if (this.phase === 'countdown') {
      if (at < this.countdownEnd - (NICE_MS + TIMING_EPSILON_MS) / 1000) { this.emit(); return { ok:true, reason:'preview' }; }
      if (!this.begin(this.generation)) return { ok:false, reason:'stale' };
    }
    if (this.phase !== 'playing') { this.emit(); return { ok:true, reason:'preview' }; }
    const missedBefore = this.missed; this.markMissed(at); if (this.nextIndex >= this.score.notes.length) {
      if (at >= this.startedAt + this.score.duration / this.speed) this.finish();
      else if (this.missed > missedBefore) { this.message = 'つぎの光をみてね'; this.emit(); }
      this.emit(); return { ok:false, reason:'finished' };
    } if (this.missed > missedBefore) { this.message = 'つぎの光をみてね'; this.emit(); }
    const target = this.score.notes[this.nextIndex]; if (!target) return { ok:false, reason:'finished' };
    const diff = (at - this.dueTime(target)) * 1000;
    if (Math.round(number(midi, -1)) !== target.midi) { this.combo = 0; this.lastGrade = ''; this.message = 'おしい！ つぎの光をみてね'; this.emit(); return { ok:false, reason:'wrong', diffMs:diff }; }
    if (Math.abs(diff) > NICE_MS + TIMING_EPSILON_MS) { this.combo = 0; this.lastGrade = ''; this.message = diff < 0 ? 'ちょっと はやいよ' : 'つぎは もうすこし はやく'; this.emit(); return { ok:false, reason:diff < 0 ? 'early' : 'late', diffMs:diff }; }
    const grade = Math.abs(diff) <= PERFECT_MS + TIMING_EPSILON_MS ? 'perfect' : 'nice';
    this.judged[this.nextIndex] = grade; this.nextIndex += 1; this.hits += 1;
    if (grade === 'perfect') this.perfect += 1; else this.nice += 1;
    this.combo += 1; this.maxCombo = Math.max(this.maxCombo, this.combo); this.hitSequence += 1;
    this.lastGrade = grade; this.message = grade === 'perfect' ? 'GREAT' : 'GOOD';
    this.lastHit = { midi, grade, sequence:this.hitSequence, at:this.audioTime() };
    this.effects.hit(this.generation, this.lastHit, this.combo);
    this.emit(); return { ok:true, grade, diffMs:diff, index:this.nextIndex - 1 };
  };
  MusicRhythmController.prototype.finish = function () {
    if (this.phase !== 'playing') return;
    while (this.nextIndex < (this.score ? this.score.notes.length : 0)) { this.judged[this.nextIndex] = 'missed'; this.missed += 1; this.nextIndex += 1; this.combo = 0; }
    this.lastGrade = '';
    this.lastHit = null;
    this.phase = 'finished'; this.clearTimers(); this.clearVoices(); this.message = Effects.resultMessage(this.hits);
    this.effects.finish(this.generation, this.audioTime());
    if (this.requestFrame) {
      const token = this.generation, until = this.audioTime() + .75;
      const animate = () => {
        if (token !== this.generation || this.phase !== 'finished') return;
        this.paint();
        if (this.audioTime() < until) this.frame = this.requestFrame(animate);
      };
      this.frame = this.requestFrame(animate);
    }
    if (this.accompanimentPlayer) this.accompanimentPlayer.stop();
    if (this.onRunFinish) this.onRunFinish(this.getState());
    this.emit();
  };
  MusicRhythmController.prototype.getState = function () {
    const now = this.audioTime();
    const scheduled = (this.phase === 'countdown' || this.phase === 'playing') && this.score ? this.score.notes.map((note, index) => ({ note, index, due:this.dueTime(note) })) : [];
    const activeNotes = scheduled.filter(item => now >= item.due && now < item.due + item.note.duration / this.speed).map(item => Object.assign({}, item.note, { index:item.index }));
    const visibleNotes = scheduled.filter(item => now < item.due + item.note.duration / this.speed && item.due - now <= LOOK_AHEAD_SECONDS).map(item => Object.assign({}, item.note, { index:item.index, untilMs:(item.due - now) * 1000 }));
    const hitFeedback = this.phase === 'playing' && this.lastHit && now - this.lastHit.at < HIT_FEEDBACK_SECONDS ? this.lastHit : null;
    return { effectEvents:this.effects.snapshot(), effectsQuiet:this.effectsMode === 'quiet' || Boolean(this.motionQuery && this.motionQuery.matches), accompaniment:this.accompaniment, accompanimentVolume:this.accompanimentVolume, instrument:this.instrument, hitFeedback, trackId:this.trackId, phase:this.phase, playing:this.phase === 'playing', active:this.phase === 'countdown' || this.phase === 'playing' || this.voices.size > 0, combo:this.combo, maxCombo:this.maxCombo, lastGrade:this.lastGrade, points:scorePoints(this.score ? this.score.notes.length : 0, this.perfect, this.nice), speed:this.speed, countdownMs:this.phase === 'countdown' ? Math.max(0, Math.round((this.countdownEnd - now) * 1000)) : 0, hits:this.hits, perfect:this.perfect, nice:this.nice, missed:this.missed, total:this.score ? this.score.notes.length : 0, nextIndex:this.nextIndex, message:this.message, error:this.error, visibleNotes, activeNotes, score:this.score };
  };
  MusicRhythmController.prototype.mount = function (rootNode) {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (typeof window !== 'undefined') {
      if (this.blurHandler) window.removeEventListener('blur', this.blurHandler);
      this.blurHandler = () => {
        if (this.phase === 'playing' || this.phase === 'countdown') this.stop();
        else { this.generation += 1; this.clearVoices(); this.emit(); }
      };
      window.addEventListener('blur', this.blurHandler);
    }
    this.root = rootNode; this.render(); this.scrollToFirstNote();
    if (rootNode && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.fitsViewport() && (this.phase === 'playing' || this.phase === 'countdown')) this.stop();
        this.paint();
      });
      this.resizeObserver.observe(rootNode);
    }
  };
  MusicRhythmController.prototype.scrollToFirstNote = function () {
    if (!this.root || !this.score || !this.score.notes.length) return;
    const scroll = this.root.querySelector('.music-rhythm-scroll');
    if (!scroll || !scroll.clientWidth) return;
    if (this.edition === 'tablet') { scroll.scrollLeft = 0; return; }
    const layout = keyboardLayout(this.score);
    const first = keyPosition(layout, this.score.notes[0].midi);
    const contentWidth = Math.max(scroll.scrollWidth, layout.whiteCount * 44);
    const center = ((first.left + first.width / 2) / 100) * contentWidth;
    const desired = Math.max(0, Math.min(contentWidth - scroll.clientWidth, center - scroll.clientWidth / 2));
    scroll.scrollLeft = desired;
  };
  MusicRhythmController.prototype.render = function () {
    if (!this.root || typeof document === 'undefined') return;
    const signature = `${this.trackId}|${this.edition}|${this.score && this.score.id || ''}`;
    if (signature !== this.renderSignature || !this.root.querySelector('.music-rhythm-stage')) {
      this.renderSignature = signature;
      const groups = Object.keys(DIFFICULTIES).map(group => `<optgroup label="${DIFFICULTIES[group]}">${this.trackIds.filter(id => difficultyFor(id).group === group).map(id => { const score = this.getScore(id); return score ? `<option value="${id}">${score.title || id}</option>` : ''; }).join('')}</optgroup>`).join('');
      this.root.innerHTML = `<div class="music-rhythm-picker"><label for="music-rhythm-track">曲をえらぶ</label><select id="music-rhythm-track">${groups}</select><span class="music-rhythm-difficulty"></span></div><p class="music-rhythm-guide">ひかりが線にきたら おしてね。長い音も おしはじめだけだよ</p><div class="music-rhythm-stage"><div class="music-rhythm-scroll"><div class="music-rhythm-lane"><div class="music-rhythm-hitline" aria-hidden="true"></div><div class="music-rhythm-notes"></div></div><div class="music-rhythm-keyboard-wrap"><div class="music-rhythm-keyboard"></div></div></div></div><div class="music-rhythm-controls"><button type="button" class="music-rhythm-start">▶ はじめる</button><button type="button" class="music-rhythm-stop">■ とめる</button><div class="music-rhythm-speed" role="group" aria-label="速さ">${Object.keys(SPEEDS).map(key => `<button type="button" data-rhythm-speed="${key}">${SPEED_LABELS[key]}</button>`).join('')}</div></div><p class="music-rhythm-status"></p>`;
      const select = this.root.querySelector('#music-rhythm-track'); if (select) { select.value = this.trackId; select.addEventListener('change', () => this.select(select.value)); }
      this.root.querySelector('.music-rhythm-picker').insertAdjacentHTML('beforeend', `<select class="music-edition" aria-label="リズムの演奏版"><option value="tablet">タブレット版</option><option value="original">原曲版</option></select>`);
      const edition = this.root.querySelector('.music-edition'); edition.value = this.edition; edition.addEventListener('change', () => this.setEdition(edition.value));
    this.root.querySelector('.music-rhythm-picker').insertAdjacentHTML('beforeend', `<label class="music-instrument-label">音色<select class="music-instrument" aria-label="リズムの音色" title="切替で曲のはじめに戻る">${Instruments.optionsHtml()}</select></label>`);
    const instrument = this.root.querySelector('.music-instrument'); instrument.value = this.instrument; instrument.addEventListener('change', () => this.setInstrument(instrument.value));
      this.root.querySelector('.music-rhythm-stage').insertAdjacentHTML('beforebegin', '<p class="music-rhythm-width-hint" role="status">横向きにすると、全部のけんばんが見えるよ</p>');
      this.root.querySelector('.music-rhythm-stage').insertAdjacentHTML('beforebegin', '<div class="music-accompaniment-controls"><label class="music-accompaniment-toggle"><input type="checkbox" aria-label="伴奏あり" title="切替で曲のはじめに戻る">伴奏あり</label><label class="music-accompaniment-volume">伴奏の音量<input type="range" min="0" max="100" step="5" aria-label="伴奏の音量"><output></output></label></div>');
      const accompaniment = this.root.querySelector('.music-accompaniment-toggle input');
      accompaniment.addEventListener('change', () => this.setAccompaniment(accompaniment.checked));
      const accompanimentVolume = this.root.querySelector('.music-accompaniment-volume input');
      accompanimentVolume.addEventListener('input', () => this.setAccompanimentVolume(Number(accompanimentVolume.value) / 100));
      this.root.querySelector('.music-rhythm-lane').insertAdjacentHTML('beforeend', '<div class="music-rhythm-result" role="status" aria-live="polite" hidden><canvas class="music-result-pet" width="96" height="104" aria-hidden="true"></canvas><div><span>今回のスコア</span><strong class="music-rhythm-points"></strong></div><p class="music-rhythm-breakdown"></p><canvas class="music-result-pet" width="96" height="104" aria-hidden="true"></canvas></div>');
      this.root.querySelector('.music-rhythm-lane').insertAdjacentHTML('beforeend', '<strong class="music-rhythm-key-feedback" aria-hidden="true" hidden></strong>');
      this.root.querySelector('.music-rhythm-controls').insertAdjacentHTML('beforeend', '<label class="music-rhythm-volume">音量<input type="range" min="0" max="100" step="5" aria-label="鍵盤の音量"><output></output></label>');
      const volume = this.root.querySelector('.music-rhythm-volume input'); volume.value = String(this.volume * 100);
      this.root.querySelector('.music-rhythm-status').innerHTML = '<span class="music-rhythm-feedback"></span><strong class="music-rhythm-combo" hidden></strong>';
      volume.addEventListener('input', () => this.setVolume(Number(volume.value) / 100));
      this.root.querySelector('.music-rhythm-start')?.addEventListener('click', () => this.start());
      this.root.querySelector('.music-rhythm-stop')?.addEventListener('click', () => this.stop());
      this.root.querySelectorAll('[data-rhythm-speed]').forEach(button => button.addEventListener('click', () => this.setSpeed(button.dataset.rhythmSpeed)));
      this.bindKeyboard();
    }
    this.paint();
  };
  MusicRhythmController.prototype.bindKeyboard = function () {
    const keyboard = this.root && this.root.querySelector('.music-rhythm-keyboard'); if (!keyboard) return;
    keyboard.querySelectorAll('.music-rhythm-key').forEach(button => {
      if (button.dataset.bound) return; button.dataset.bound = 'true';
      const midi = Number(button.dataset.midi);
      button.addEventListener('pointerdown', event => {
        if (event.button != null && event.button !== 0) return;
        if (event.cancelable) event.preventDefault();
        try { button.setPointerCapture(event.pointerId); } catch (_) {}
        this.pressKey(midi, null, `pointer:${event.pointerId}`);
      });
      for (const type of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(type, event => this.releaseKey(`pointer:${event.pointerId}`));
      button.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); if (!event.repeat) this.pressKey(midi, null, `key:${midi}:${event.key}`);
      });
      button.addEventListener('keyup', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); this.releaseKey(`key:${midi}:${event.key}`);
      });
      button.addEventListener('blur', () => { this.releaseKey(`key:${midi}:Enter`); this.releaseKey(`key:${midi}: `); });
      button.addEventListener('click', event => { if (event.detail === 0) this.pressKey(midi); });
    });
  };
  MusicRhythmController.prototype.paint = function () {
    if (!this.root || !this.score) return;
    const state = this.getState(); const select = this.root.querySelector('#music-rhythm-track'); if (select) select.value = this.trackId;
    const accompaniment = this.root.querySelector('.music-accompaniment-toggle input'); if (accompaniment) accompaniment.checked = this.accompaniment;
    const accompanimentVolume = this.root.querySelector('.music-accompaniment-volume input');
    if (accompanimentVolume) { accompanimentVolume.value = String(Math.round(this.accompanimentVolume * 100)); accompanimentVolume.disabled = !this.accompaniment; }
    const accompanimentLevel = this.root.querySelector('.music-accompaniment-volume output'); if (accompanimentLevel) accompanimentLevel.textContent = `${Math.round(this.accompanimentVolume * 100)}%`;
    const difficulty = this.root.querySelector('.music-rhythm-difficulty'); if (difficulty) difficulty.textContent = DIFFICULTIES[difficultyFor(this.trackId).group];
    const fits = this.fitsViewport();
    this.root.classList.toggle('is-tablet', this.edition === 'tablet');
    this.root.classList.toggle('is-width-blocked', !fits);
    const guide = this.root.querySelector('.music-rhythm-guide'); if (guide) guide.textContent = (this.score.arranged ? '画面におさまる編曲だよ。' : '') + '光ったら おしてね。長くおすと 音の余韻がつづくよ';
    const start = this.root.querySelector('.music-rhythm-start'); if (start) { start.disabled = state.phase === 'countdown' || state.phase === 'playing'; start.textContent = state.phase === 'finished' ? '▶ もういちど' : '▶ はじめる'; }
    if (start && !fits) start.disabled = true;
    const status = this.root.querySelector('.music-rhythm-status');
    if (status) {
      const feedback = status.querySelector('.music-rhythm-feedback');
      const combo = status.querySelector('.music-rhythm-combo');
      const message = state.error || state.message || (state.phase === 'idle' ? 'はじめる前も けんばんで あそべるよ' : '');
      if (feedback.textContent !== message) feedback.textContent = message;
      status.dataset.grade = state.error ? '' : state.lastGrade;
      status.dataset.pulse = String(this.hitSequence % 2);
      combo.hidden = !state.playing;
      const fx = Effects.view(state.effectEvents, this.audioTime(), state.effectsQuiet);
      const comboText = `${fx.milestone ? '★ ' : ''}${state.combo} COMBO`;
      combo.style.transform = `scale(${fx.scale})`;
      if (combo.textContent !== comboText) combo.textContent = comboText;
    }
    const volume = this.root.querySelector('.music-rhythm-volume input');
    if (volume) { volume.value = String(Math.round(this.volume * 100)); volume.nextElementSibling.textContent = `${Math.round(this.volume * 100)}%`; }
    this.root.classList.toggle('music-effects-quiet', state.effectsQuiet);
    const result = this.root.querySelector('.music-rhythm-result');
    if (result) {
      result.hidden = state.phase !== 'finished';
      if (!result.hidden) {
        const fx = Effects.view(state.effectEvents, this.audioTime(), state.effectsQuiet);
        result.querySelectorAll('.music-result-pet').forEach((canvas, index) => {
          const ctx = canvas.getContext('2d'); if (!ctx) return;
          ctx.clearRect(0,0,96,104); Effects.drawPet(ctx,0,0,96,index===1,fx.bow*2);
        });
      }
      const signature = `${state.points}|${state.perfect}|${state.nice}|${state.missed}|${state.maxCombo}`;
      if (!result.hidden && result.dataset.result !== signature) {
        result.dataset.result = signature;
        result.querySelector('.music-rhythm-points').innerHTML = `${state.points}<small>点 / 100</small>`;
        result.querySelector('.music-rhythm-breakdown').textContent = `GREAT ${state.perfect}　GOOD ${state.nice}　みおくり ${state.missed}\n最大 ${state.maxCombo} COMBO`;
      }
    }
    this.root.querySelectorAll('[data-rhythm-speed]').forEach(button => button.setAttribute('aria-pressed', String(Number(SPEEDS[button.dataset.rhythmSpeed]) === this.speed)));
    const layout = keyboardLayout(this.score); const keyboard = this.root.querySelector('.music-rhythm-keyboard');
    if (keyboard && !keyboard.dataset.layout) { keyboard.dataset.layout = `${layout.min}:${layout.max}`; keyboard.style.setProperty('--rhythm-min-width', `${layout.whiteCount * 44}px`); keyboard.innerHTML = layout.keys.map(key => { const pos = keyPosition(layout, key.midi); const label = `${PITCH_NAMES[((key.midi % 12) + 12) % 12]}${Math.floor(key.midi / 12) - 1}`; const cClass = !key.black && key.midi % 12 === 0 ? ' is-c' : ''; return `<button type="button" class="music-rhythm-key ${key.black ? 'is-black' : 'is-white'}${cClass}" data-midi="${key.midi}" style="left:${pos.left}%;width:${pos.width}%" aria-label="${label}のけんばん"><span>${label}</span>${key.midi === Math.ceil(layout.min / 12) * 12 ? '<i class="music-c-sticker" aria-hidden="true" title="一番低いドの目印">★</i>' : ''}</button>`; }).join(''); this.bindKeyboard(); }
    const cues = new Map(state.activeNotes.map(note => [note.midi, note.index]));
    keyboard?.querySelectorAll('.music-rhythm-key').forEach(button => {
      const midi = Number(button.dataset.midi); const cue = cues.get(midi);
      const voice = this.voices.get(midi);
      button.classList.toggle('is-manual', Boolean(voice && this.audioTime() < Math.min(voice.noteOffAt, voice.naturalEndAt)));
      button.classList.toggle('is-cue', cue != null);
      if (cue != null && button.dataset.cue !== String(cue)) {
        button.dataset.pulse = button.dataset.pulse === 'a' ? 'b' : 'a';
      }
      button.dataset.cue = cue == null ? '' : String(cue);
    });
    const fx = Effects.view(state.effectEvents, this.audioTime(), state.effectsQuiet);
    const rings = new Map(fx.rings.map(r => [String(r.sequence), r]));
    keyboard?.querySelectorAll('.music-hit-ring').forEach(node => { if (!rings.has(node.dataset.sequence)) node.remove(); });
    fx.rings.forEach(ring => {
      const key = keyboard?.querySelector(`[data-midi="${ring.midi}"]`); if (!key) return;
      let node = key.querySelector(`[data-sequence="${ring.sequence}"]`);
      if (!node) { node = document.createElement('i'); node.className='music-hit-ring'; node.dataset.sequence=String(ring.sequence); node.setAttribute('aria-hidden','true'); key.appendChild(node); }
      node.style.opacity = String(.45*(1-ring.progress)); node.style.transform=`translateX(-50%) scale(${.65+.35*ring.progress})`;
    });
    const lane = this.root.querySelector('.music-rhythm-lane'); const notes = this.root.querySelector('.music-rhythm-notes');
    const keyFeedback = this.root.querySelector('.music-rhythm-key-feedback');
    if (keyFeedback) {
      const hit = state.hitFeedback;
      keyFeedback.hidden = !hit;
      if (hit) {
        const position = keyPosition(layout, hit.midi);
        keyFeedback.style.left = `clamp(48px, ${position.left + position.width / 2}%, calc(100% - 48px))`;
        keyFeedback.dataset.midi = String(hit.midi);
        keyFeedback.dataset.grade = hit.grade;
        keyFeedback.dataset.pulse = String(hit.sequence % 2);
        keyFeedback.textContent = hit.grade === 'perfect' ? 'GREAT' : 'GOOD';
      }
    }
    if (lane) lane.style.setProperty('--rhythm-lane-width', `${layout.whiteCount * 44}px`);
    if (notes) { const laneHeight = lane && lane.clientHeight || 150; const hitY = laneHeight - 9; if (lane) lane.dataset.hitlineY = String(hitY); notes.innerHTML = state.visibleNotes.map(note => { const pos = keyPosition(layout, note.midi); const progress = Math.min(LOOK_AHEAD_SECONDS, note.untilMs / 1000); const height = Math.max(10, note.duration / this.speed / LOOK_AHEAD_SECONDS * laneHeight); const top = hitY - progress / LOOK_AHEAD_SECONDS * laneHeight - height; return `<span class="music-rhythm-note" data-index="${note.index}" data-until-ms="${Math.round(note.untilMs)}" style="left:${pos.left}%;width:${pos.width}%;top:${Math.round(top)}px;height:${Math.round(height)}px"><span class="music-rhythm-leading" aria-hidden="true"></span></span>`; }).join(''); }
  };
  return { COUNTDOWN_MS, PERFECT_MS, NICE_MS, SPEEDS, SPEED_LABELS, DIFFICULTIES, DIFFICULTY_TABLE, scorePoints, normalizeScore, difficultyFor, keyboardLayout, keyPosition, MusicRhythmController };
}));
