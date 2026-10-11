/* おんがくリズムゲーム。表示と採点は音声の時計を共有し、押した鍵盤だけを鳴らす。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionMusicRhythm = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COUNTDOWN_MS = 3000;
  const PERFECT_MS = 120;
  const NICE_MS = 250;
  const TIMING_EPSILON_MS = 0.000001;
  const LOOK_AHEAD_SECONDS = 3;
  const KEY_DURATION = 0.42;
  const MAX_VOICES = 6;
  const PITCH_NAMES = ['ド','ド♯','レ','レ♯','ミ','ファ','ファ♯','ソ','ソ♯','ラ','ラ♯','シ'];
  const SPEEDS = Object.freeze({ slow:0.5, gentle:0.75, normal:1 });
  const SPEED_LABELS = Object.freeze({ slow:'ゆっくり', gentle:'すこしゆっくり', normal:'ふつう' });
  const DIFFICULTIES = Object.freeze({ easy:'かんたん', normal:'ふつう', hard:'むずかしい' });
  /* 標準速度の密度・黒鍵・音域・跳躍を見比べた初版の分類表。曲データの音を変更しない。 */
  const DIFFICULTY_TABLE = Object.freeze({
    twinkle:{ group:'easy', reason:'白鍵中心・単旋律・6音の入口' },
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
  function isBlack(midi) { return PITCH_CLASSES.includes(((Math.round(midi) % 12) + 12) % 12); }
  function keyboardLayout(score) {
    if (!score || !score.notes || !score.notes.length) return { min:0, max:0, whiteCount:0, keys:[] };
    const minNote = Math.min(...score.notes.map(note => note.midi));
    const maxNote = Math.max(...score.notes.map(note => note.midi));
    const min = Math.max(0, Math.floor(minNote / 12) * 12);
    const max = Math.min(127, Math.ceil(maxNote / 12) * 12);
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

  function MusicRhythmController(options = {}) {
    this.data = options.scoreData || null;
    this.trackIds = Array.isArray(options.trackIds) ? options.trackIds.slice() : [];
    this.audioContext = options.audioContext || null;
    this.outputNode = options.outputNode || null;
    this.audioContextFactory = options.audioContextFactory || null;
    this.beforePlay = typeof options.beforePlay === 'function' ? options.beforePlay : null;
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
    this.now = options.now || nowMs;
    this.setTimeout = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeout = options.clearTimeout || (id => clearTimeout(id));
    this.setInterval = options.setInterval || ((fn, ms) => setInterval(fn, ms));
    this.clearInterval = options.clearInterval || (id => clearInterval(id));
    this.root = null;
    this.ctx = null;
    this.score = null;
    this.trackId = '';
    this.speed = SPEEDS.gentle;
    this.phase = 'idle';
    this.generation = 0;
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
    this.message = '';
    this.error = '';
    this.voices = new Map();
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
  MusicRhythmController.prototype.getScore = function (id) { const score = getScoreMap(this.data)[id]; return normalizeScore(score && score.id ? score : null); };
  MusicRhythmController.prototype.select = function (id) {
    this.stop(false);
    this.trackId = id || '';
    this.score = this.getScore(this.trackId);
    this.emit();
    this.scrollToFirstNote();
    return this.score;
  };
  MusicRhythmController.prototype.setData = function (data) { this.data = data || null; this.score = this.getScore(this.trackId); this.emit(); };
  MusicRhythmController.prototype.clearTimers = function () {
    if (this.countdownTimer != null) this.clearTimeout(this.countdownTimer);
    if (this.timer != null) this.clearInterval(this.timer);
    this.countdownTimer = null; this.timer = null;
  };
  MusicRhythmController.prototype.clearVoices = function () {
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
  MusicRhythmController.prototype.stop = function (emit = true) {
    this.generation += 1;
    this.clearTimers(); this.clearVoices();
    this.phase = 'idle'; this.startedAt = 0; this.countdownEnd = 0; this.nextIndex = 0;
    this.judged = []; this.hits = 0; this.perfect = 0; this.nice = 0; this.missed = 0;
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
    if (this.beforePlay && this.beforePlay() === false) { this.error = '音がオフだよ。上の🔊でオンにしてね'; this.emit(); return false; }
    const ctx = this.audio();
    if (!ctx) { this.error = 'この端末では音を鳴らせないよ'; this.emit(); return false; }
    const token = ++this.generation;
    try { if (ctx.state === 'suspended' && ctx.resume) await ctx.resume(); } catch (_) { if (token === this.generation) { this.error = '音を準備できなかったよ。もう一度おしてね'; this.emit(); } return false; }
    if (token !== this.generation) return false;
    this.phase = 'countdown'; this.error = ''; this.message = 'じゅんび… 3'; this.countdownEnd = this.audioTime() + COUNTDOWN_MS / 1000;
    this.timer = this.setInterval(() => this.tick(), 50);
    this.countdownTimer = this.setTimeout(() => this.begin(token), COUNTDOWN_MS + 20);
    this.emit();
    this.scrollToFirstNote();
    return true;
  };
  MusicRhythmController.prototype.begin = function (token = this.generation) {
    if (token !== this.generation || this.phase !== 'countdown') return false;
    this.phase = 'playing'; this.startedAt = this.countdownEnd; this.nextIndex = 0; this.judged = this.score.notes.map(() => 'pending'); this.message = 'ひかりが線にきたら けんばんをおしてね';
    this.emit(); return true;
  };
  MusicRhythmController.prototype.dueTime = function (note) { const base = this.phase === 'countdown' ? this.countdownEnd : this.startedAt; return base + note.start / this.speed; };
  MusicRhythmController.prototype.songTime = function (atTime = this.audioTime()) { return Math.max(0, (atTime - this.startedAt) * this.speed); };
  MusicRhythmController.prototype.tick = function () {
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
    }
  };
  MusicRhythmController.prototype.playKeySound = function (midi, at) {
    const ctx = this.ctx || this.audio(); if (!ctx || !ctx.createOscillator || !ctx.createGain) return false;
    const old = this.voices.get(midi); if (old) this.releaseVoice(old);
    while (this.voices.size >= MAX_VOICES) { const oldest = this.voices.values().next().value; this.releaseVoice(oldest); }
    try {
      const oscillator = ctx.createOscillator(); const gain = ctx.createGain();
      const frequency = 440 * Math.pow(2, (midi - 69) / 12); oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.16, at + .025); gain.gain.exponentialRampToValueAtTime(.0001, at + KEY_DURATION);
      oscillator.connect(gain); gain.connect(this.outputNode || ctx.destination); oscillator.start(at); oscillator.stop(at + KEY_DURATION + .02);
      const entry = { midi, oscillator, gain, timer:null }; this.voices.set(midi, entry);
      const release = () => this.releaseVoice(entry, false);
      if (oscillator.addEventListener) oscillator.addEventListener('ended', release);
      const timer = this.setTimeout(release, (KEY_DURATION + .15) * 1000); entry.timer = timer; if (timer && typeof timer.unref === 'function') timer.unref();
      return true;
    } catch (_) { return false; }
  };
  MusicRhythmController.prototype.pressKey = async function (midi, atTime = null) {
    if (!this.score) return { ok:false, reason:'inactive' };
    /* 最初の光だけは判定線の手前250msから受け付け、演奏時計は予告終了時刻を保つ。 */
    if (this.phase === 'countdown') {
      const earlyAt = atTime == null ? this.audioTime() : Number(atTime);
      if (earlyAt < this.countdownEnd - (NICE_MS + TIMING_EPSILON_MS) / 1000) return { ok:false, reason:'inactive' };
      if (!this.begin(this.generation)) return { ok:false, reason:'stale' };
      atTime = earlyAt;
    }
    if (this.phase !== 'playing') return { ok:false, reason:'inactive' };
    const token = this.generation; const ctx = this.ctx || this.audio(); if (!ctx) return { ok:false, reason:'unsupported' };
    try { if (ctx.state === 'suspended' && ctx.resume) await ctx.resume(); } catch (_) { return { ok:false, reason:'resume-failed' }; }
    if (token !== this.generation || this.phase !== 'playing') return { ok:false, reason:'stale' };
    const at = atTime == null ? this.audioTime() : Number(atTime); const missedBefore = this.missed; this.markMissed(at); if (this.nextIndex >= this.score.notes.length) {
      if (at >= this.startedAt + this.score.duration / this.speed) this.finish();
      else if (this.missed > missedBefore) { this.message = 'つぎの光をみてね'; this.emit(); }
      return { ok:false, reason:'finished' };
    } if (this.missed > missedBefore) { this.message = 'つぎの光をみてね'; this.emit(); } this.playKeySound(Math.round(number(midi, -1)), at);
    const target = this.score.notes[this.nextIndex]; if (!target) return { ok:false, reason:'finished' };
    const diff = (at - this.dueTime(target)) * 1000;
    if (Math.round(number(midi, -1)) !== target.midi) { this.message = 'おしい！ つぎの光をみてね'; this.emit(); return { ok:false, reason:'wrong', diffMs:diff }; }
    if (Math.abs(diff) > NICE_MS + TIMING_EPSILON_MS) { this.message = diff < 0 ? 'ちょっと はやいよ' : 'つぎは もうすこし はやく'; this.emit(); return { ok:false, reason:diff < 0 ? 'early' : 'late', diffMs:diff }; }
    const grade = Math.abs(diff) <= PERFECT_MS + TIMING_EPSILON_MS ? 'perfect' : 'nice'; this.judged[this.nextIndex] = grade; this.nextIndex += 1; this.hits += 1; if (grade === 'perfect') this.perfect += 1; else this.nice += 1; this.message = grade === 'perfect' ? 'ぴったり！' : 'いいね！'; this.emit(); return { ok:true, grade, diffMs:diff, index:this.nextIndex - 1 };
  };
  MusicRhythmController.prototype.finish = function () {
    if (this.phase !== 'playing') return;
    while (this.nextIndex < (this.score ? this.score.notes.length : 0)) { this.judged[this.nextIndex] = 'missed'; this.missed += 1; this.nextIndex += 1; }
    this.phase = 'finished'; this.clearTimers(); this.clearVoices(); this.message = `${this.hits} / ${this.score.notes.length} おん あたったよ。もういちど？`; this.emit();
  };
  MusicRhythmController.prototype.getState = function () {
    const now = this.audioTime();
    const visibleNotes = (this.phase === 'countdown' || this.phase === 'playing') && this.score ? this.score.notes.map((note, index) => ({ note, index, until:this.dueTime(note) - now })).filter(item => item.until >= -NICE_MS / 1000 && item.until <= LOOK_AHEAD_SECONDS).map(item => Object.assign({}, item.note, { index:item.index, untilMs:Math.round(item.until * 1000) })) : [];
    return { trackId:this.trackId, phase:this.phase, playing:this.phase === 'playing', active:this.phase === 'countdown' || this.phase === 'playing', speed:this.speed, countdownMs:this.phase === 'countdown' ? Math.max(0, Math.round((this.countdownEnd - now) * 1000)) : 0, hits:this.hits, perfect:this.perfect, nice:this.nice, missed:this.missed, total:this.score ? this.score.notes.length : 0, nextIndex:this.nextIndex, message:this.message, error:this.error, visibleNotes, score:this.score };
  };
  MusicRhythmController.prototype.mount = function (rootNode) { this.root = rootNode; this.render(); this.scrollToFirstNote(); };
  MusicRhythmController.prototype.scrollToFirstNote = function () {
    if (!this.root || !this.score || !this.score.notes.length) return;
    const scroll = this.root.querySelector('.music-rhythm-scroll');
    if (!scroll || !scroll.clientWidth) return;
    const layout = keyboardLayout(this.score);
    const first = keyPosition(layout, this.score.notes[0].midi);
    const contentWidth = Math.max(scroll.scrollWidth, layout.whiteCount * 44);
    const center = ((first.left + first.width / 2) / 100) * contentWidth;
    const desired = Math.max(0, Math.min(contentWidth - scroll.clientWidth, center - scroll.clientWidth / 2));
    scroll.scrollLeft = desired;
  };
  MusicRhythmController.prototype.render = function () {
    if (!this.root || typeof document === 'undefined') return;
    const signature = `${this.trackId}|${this.score && this.score.id || ''}`;
    if (signature !== this.renderSignature || !this.root.querySelector('.music-rhythm-stage')) {
      this.renderSignature = signature;
      const groups = ['easy','normal','hard'].map(group => `<optgroup label="${DIFFICULTIES[group]}">${this.trackIds.filter(id => difficultyFor(id).group === group).map(id => { const score = this.getScore(id); return score ? `<option value="${id}">${score.title || id}</option>` : ''; }).join('')}</optgroup>`).join('');
      this.root.innerHTML = `<div class="music-rhythm-picker"><label for="music-rhythm-track">曲をえらぶ</label><select id="music-rhythm-track">${groups}</select><span class="music-rhythm-difficulty"></span></div><p class="music-rhythm-guide">ひかりが線にきたら おしてね。長い音も おしはじめだけだよ</p><div class="music-rhythm-stage"><div class="music-rhythm-scroll"><div class="music-rhythm-lane"><div class="music-rhythm-hitline" aria-hidden="true"></div><div class="music-rhythm-notes"></div></div><div class="music-rhythm-keyboard-wrap"><div class="music-rhythm-keyboard"></div></div></div></div><div class="music-rhythm-controls"><button type="button" class="music-rhythm-start">▶ はじめる</button><button type="button" class="music-rhythm-stop">■ とめる</button><div class="music-rhythm-speed" role="group" aria-label="速さ">${Object.keys(SPEEDS).map(key => `<button type="button" data-rhythm-speed="${key}">${SPEED_LABELS[key]}</button>`).join('')}</div></div><p class="music-rhythm-status" role="status" aria-live="polite"></p>`;
      const select = this.root.querySelector('#music-rhythm-track'); if (select) { select.value = this.trackId; select.addEventListener('change', () => this.select(select.value)); }
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
      const press = event => { if (event.type === 'keydown' && event.repeat) return; if (event.cancelable) event.preventDefault(); this.pressKey(Number(button.dataset.midi)); };
      button.addEventListener('pointerdown', press); button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') press(event); });
    });
  };
  MusicRhythmController.prototype.paint = function () {
    if (!this.root || !this.score) return;
    const state = this.getState(); const select = this.root.querySelector('#music-rhythm-track'); if (select) select.value = this.trackId;
    const difficulty = this.root.querySelector('.music-rhythm-difficulty'); if (difficulty) difficulty.textContent = DIFFICULTIES[difficultyFor(this.trackId).group];
    const guide = this.root.querySelector('.music-rhythm-guide'); if (guide) guide.textContent = this.trackId === 'twinkle' ? 'ひかりが線にきたら おしてね。長い音も おしはじめだけだよ' : '横にすると 広く見えるよ。入りきらないときは 横に動かしてね';
    const start = this.root.querySelector('.music-rhythm-start'); if (start) { start.disabled = state.phase === 'countdown' || state.phase === 'playing'; start.textContent = state.phase === 'finished' ? '▶ もういちど' : '▶ はじめる'; }
    const status = this.root.querySelector('.music-rhythm-status'); if (status) status.textContent = state.error || state.message || (state.phase === 'idle' ? '曲をえらんで はじめよう' : '');
    this.root.querySelectorAll('[data-rhythm-speed]').forEach(button => button.setAttribute('aria-pressed', String(Number(SPEEDS[button.dataset.rhythmSpeed]) === this.speed)));
    const layout = keyboardLayout(this.score); const keyboard = this.root.querySelector('.music-rhythm-keyboard');
    if (keyboard && !keyboard.dataset.layout) { keyboard.dataset.layout = `${layout.min}:${layout.max}`; keyboard.style.setProperty('--rhythm-min-width', `${layout.whiteCount * 44}px`); keyboard.innerHTML = layout.keys.map(key => { const pos = keyPosition(layout, key.midi); const label = `${PITCH_NAMES[((key.midi % 12) + 12) % 12]}${Math.floor(key.midi / 12) - 1}`; const cClass = !key.black && key.midi % 12 === 0 ? ' is-c' : ''; return `<button type="button" class="music-rhythm-key ${key.black ? 'is-black' : 'is-white'}${cClass}" data-midi="${key.midi}" style="left:${pos.left}%;width:${pos.width}%" aria-label="${label}のけんばん"><span>${label}</span></button>`; }).join(''); this.bindKeyboard(); }
    keyboard?.querySelectorAll('.music-rhythm-key').forEach(button => { const midi = Number(button.dataset.midi); button.classList.toggle('is-manual', this.voices.has(midi)); });
    const lane = this.root.querySelector('.music-rhythm-lane'); const notes = this.root.querySelector('.music-rhythm-notes');
    if (lane) lane.style.setProperty('--rhythm-lane-width', `${layout.whiteCount * 44}px`);
    if (notes) { const laneHeight = lane && lane.clientHeight || 150; const hitY = laneHeight - 9; if (lane) lane.dataset.hitlineY = String(hitY); notes.innerHTML = state.visibleNotes.map(note => { const pos = keyPosition(layout, note.midi); const progress = Math.max(0, Math.min(LOOK_AHEAD_SECONDS, note.untilMs / 1000)); const height = Math.max(10, note.duration / this.speed / LOOK_AHEAD_SECONDS * laneHeight); const top = hitY - progress / LOOK_AHEAD_SECONDS * laneHeight - height; return `<span class="music-rhythm-note" data-index="${note.index}" data-until-ms="${note.untilMs}" style="left:${pos.left}%;width:${pos.width}%;top:${Math.round(top)}px;height:${Math.round(height)}px"><span class="music-rhythm-leading" aria-hidden="true"></span></span>`; }).join(''); }
  };
  return { COUNTDOWN_MS, PERFECT_MS, NICE_MS, SPEEDS, SPEED_LABELS, DIFFICULTIES, DIFFICULTY_TABLE, normalizeScore, difficultyFor, keyboardLayout, keyPosition, MusicRhythmController };
}));
