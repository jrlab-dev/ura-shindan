/* おんがく学習v2：音符と鍵盤の自動演奏。
   音符データを持たずに仮の音を作らない。score-data.js が提供する音符を、
   Web Audio の予約と画面表示の両方で共有する。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./music-tablet.js'));
  else root.LittleCompanionMusicLearning = factory(root.LittleCompanionMusicTablet);
}(typeof self !== 'undefined' ? self : this, function (Tablet) {
  'use strict';

  const SPEEDS = Object.freeze({ slow: 0.5, gentle: 0.75, normal: 1 });
  const SPEED_LABELS = Object.freeze({ slow: 'ゆっくり', gentle: 'すこしゆっくり', normal: 'ふつう' });
  const MIN_NOTE = 0.001;
  const MANUAL_DURATION = 0.6;
  const MANUAL_MAX_VOICES = 6;
  const LOOK_AHEAD = 0.8;
  const TICK_MS = 80;
  const pitchName = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
  const pitchStep = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  /* 学習画面は、カードの短い呼び名ではなく原曲名を見出しにする。 */
  const LEARNING_TITLES = Object.freeze({
    twinkle: 'きらきら星',
    joy: 'よろこびのうた',
    ofuro: '人形の夢（抜粋）',
    canon: 'カノン（メインから）',
    jesu: '主よ、人の望みの喜びよ',
    haru: '春',
    konpeito: '金平糖の精の踊り',
    masu: 'ます',
    donau: '美しく青きドナウ'
  });

  function number(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function normalizeScore(score) {
    if (!score || !Array.isArray(score.notes)) return null;
    const notes = score.notes.map(note => ({
      midi: Math.round(number(note.midi, 60)),
      start: Math.max(0, number(note.start)),
      duration: Math.max(MIN_NOTE, number(note.duration, 0.25)),
      name: note.name || '', step: note.step || '', octave: note.octave, accidental: note.accidental || null, beat: note.beat
    })).sort((a, b) => a.start - b.start || a.midi - b.midi);
    const duration = Math.max(number(score.duration), notes.reduce((last, note) => Math.max(last, note.start + note.duration), 0));
    const phrases = Array.isArray(score.phrases) && score.phrases.length ? score.phrases.map(phrase => ({
      start: Math.max(0, number(phrase.start)),
      end: Math.max(0, number(phrase.end))
    })).filter(phrase => phrase.end > phrase.start) : [{ start: 0, end: duration }];
    return Object.assign({}, score, { duration, notes, phrases });
  }
  function getScoreMap(data) {
    if (!data) return {};
    if (data.scores && typeof data.scores === 'object') return data.scores;
    return data;
  }
  function getScore(data, id) {
    const map = getScoreMap(data);
    const score = map && map[id];
    return normalizeScore(score && score.id ? score : null);
  }
  function learningTitle(score) {
    if (!score) return '';
    return LEARNING_TITLES[score.id] || score.title || score.id || '';
  }
  function getCurrentNote(score, position) {
    if (!score) return null;
    const pos = number(position);
    return score.notes.find(note => pos >= note.start && pos < note.start + note.duration) || null;
  }
  function phraseAt(score, index) {
    if (!score || !score.phrases.length) return null;
    const i = Math.max(0, Math.min(score.phrases.length - 1, Math.floor(number(index))));
    return score.phrases[i];
  }
  function midiName(midi, supplied) {
    if (supplied) return String(supplied);
    const m = Math.round(number(midi, 60));
    const pc = ((m % 12) + 12) % 12;
    return `${pitchName[pc]}${Math.floor(m / 12) - 1}`;
  }
  function displayNoteName(note) {
    if (!note) return '';
    const step = note.step || String(note.name || '').match(/[A-G]/i)?.[0] || pitchStep[((Math.round(number(note.midi, 60)) % 12) + 12) % 12][0];
    const octave = note.octave == null ? Math.floor(number(note.midi, 60) / 12) - 1 : note.octave;
    const accidental = note.accidental === 'flat' || note.accidental === '♭' ? '♭' : note.accidental === 'sharp' || note.accidental === '♯' ? '♯' : '';
    const names = { C:'ド', D:'レ', E:'ミ', F:'ファ', G:'ソ', A:'ラ', B:'シ' };
    return `${names[String(step).toUpperCase()] || midiName(note.midi).replace(/[0-9-]+$/, '')}${accidental}${octave}`;
  }
  function notePositionFor(note) {
    const step = String(note && note.step || '').toUpperCase();
    const index = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 }[step];
    if (index == null) return notePosition(note && note.midi);
    const octave = note.octave == null ? Math.floor(number(note.midi, 60) / 12) - 1 : Number(note.octave);
    return (octave + 1) * 7 + index;
  }
  function ledgerLineCount(note) {
    const step = notePositionFor(note) - 37;
    return step < 0 ? Math.floor(-step / 2) : step > 8 ? Math.floor((step - 8) / 2) : 0;
  }
  function staffStep(note) { return notePositionFor(note) - 37; }
  function notePosition(midi) {
    const m = Math.round(number(midi, 60));
    return Math.floor(m / 12) * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][((m % 12) + 12) % 12];
  }
  function frequency(midi) { return 440 * Math.pow(2, (number(midi, 69) - 69) / 12); }

  function MusicLearningController(options = {}) {
    this.data = options.scoreData || null;
    this.trackIds = Array.isArray(options.trackIds) ? options.trackIds.slice() : [];
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
    this.beforePlay = typeof options.beforePlay === 'function' ? options.beforePlay : null;
    this.audioContextFactory = options.audioContextFactory || null;
    this.audioContext = options.audioContext || null;
    this.outputNode = options.outputNode || null;
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.root = null;
    this.score = null;
    this.trackId = '';
    this.edition = 'tablet';
    this.phraseIndex = 0;
    this.position = 0;
    this.speed = 0.75;
    this.repeat = false;
    this.showNotes = true;
    this.showKeyboard = true;
    this.playing = false;
    this.ctx = null;
    this.startedAt = 0;
    this.timer = null;
    this.raf = null;
    this.scheduled = new Map();
    this.generation = 0;
    this.lastPaint = 0;
    this.renderSignature = '';
    this.lastCurrentKey = '';
    this.error = '';
    this.manualVoices = new Map();
    this.manualEpoch = 0;
    this.manualResumePromise = null;
  }
  MusicLearningController.prototype.emit = function () {
    if (this.onChange) this.onChange(this.getState());
    this.render();
  };
  MusicLearningController.prototype.notify = function () { if (this.onChange) this.onChange(this.getState()); };
  MusicLearningController.prototype.getState = function () {
    return { trackId: this.trackId, position: this.getPosition(), speed: this.speed, playing: this.playing, active: this.isActive(), repeat: this.repeat, phraseIndex: this.phraseIndex, showNotes: this.showNotes, showKeyboard: this.showKeyboard, score: this.score };
  };
  MusicLearningController.prototype.isActive = function () {
    return Boolean(this.playing || this.manualVoices.size || this.manualResumePromise);
  };
  MusicLearningController.prototype.getPosition = function () {
    if (!this.playing || !this.ctx) return this.position;
    return Math.max(0, Math.min(this.score ? this.score.duration : this.position, (this.ctx.currentTime - this.startedAt) * this.speed));
  };
  MusicLearningController.prototype.select = function (id) {
    this.stop();
    this.trackId = id || '';
    this.score = normalizeScore(Tablet.arrange(getScoreMap(this.data)[this.trackId], this.edition));
    this.renderSignature = '';
    this.phraseIndex = 0;
    this.position = 0;
    this.emit();
    return this.score;
  };
  MusicLearningController.prototype.setData = function (data) {
    this.stop();
    this.data = data || null;
    if (this.trackId) this.score = normalizeScore(Tablet.arrange(getScoreMap(this.data)[this.trackId], this.edition));
    this.renderSignature = '';
    this.emit();
  };
  MusicLearningController.prototype.setEdition = function (edition) {
    const next = edition === 'original' ? 'original' : 'tablet';
    if (next === this.edition) return;
    this.edition = next; this.select(this.trackId);
  };
  MusicLearningController.prototype.audio = function () {
    if (this.ctx) return this.ctx;
    if (this.audioContext) { this.ctx = this.audioContext; return this.ctx; }
    const Factory = this.audioContextFactory || (typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null));
    if (!Factory) return null;
    try { this.ctx = new Factory(); } catch (_) { this.ctx = null; }
    return this.ctx;
  };
  MusicLearningController.prototype.cancelScheduled = function () {
    this.scheduled.forEach(entry => { try { entry.oscillator.stop(); } catch (_) {} try { entry.oscillator.disconnect(); } catch (_) {} try { entry.gain.disconnect(); } catch (_) {} });
    this.scheduled.clear();
  };
  MusicLearningController.prototype.releaseManualVoice = function (entry, stopNode = true) {
    if (!entry || entry.released) return;
    entry.released = true;
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    if (this.manualVoices.get(entry.midi) === entry) this.manualVoices.delete(entry.midi);
    if (stopNode) { try { entry.oscillator.stop(); } catch (_) {} }
    try { entry.oscillator.disconnect(); } catch (_) {}
    try { entry.gain.disconnect(); } catch (_) {}
    this.paint();
    this.notify();
  };
  MusicLearningController.prototype.clearManualVoices = function () {
    this.manualEpoch += 1;
    this.manualResumePromise = null;
    Array.from(this.manualVoices.values()).forEach(entry => this.releaseManualVoice(entry));
    this.manualVoices.clear();
  };
  MusicLearningController.prototype.resumeForManual = function (ctx) {
    if (!ctx || ctx.state !== 'suspended' || typeof ctx.resume !== 'function') return Promise.resolve(ctx);
    if (this.manualResumePromise) return this.manualResumePromise;
    const epoch = this.manualEpoch;
    let pending;
    pending = Promise.resolve().then(() => ctx.resume()).then(() => epoch === this.manualEpoch ? ctx : null).catch(() => null).then(result => {
      if (this.manualResumePromise === pending) this.manualResumePromise = null;
      return result;
    });
    this.manualResumePromise = pending;
    return pending;
  };
  MusicLearningController.prototype.playKey = async function (midi) {
    const value = Math.round(number(midi, NaN));
    if (!Number.isFinite(value) || value < 0 || value > 127) return false;
    if (this.beforePlay && this.beforePlay() === false) {
      this.error = '音がオフだよ。上の🔊でオンにしてね';
      this.notify();
      this.paint();
      return false;
    }
    if (this.playing) this.pause();
    else {
      // 自動再生がresume待ちでplayingになる前の打鍵も、自動開始を無効化する。
      this.generation += 1;
    }
    const ctx = this.audio();
    if (!ctx) { this.error = 'この端末では音を鳴らせないよ'; this.notify(); this.paint(); return false; }
    const epoch = this.manualEpoch;
    const ready = await this.resumeForManual(ctx);
    if (!ready || epoch !== this.manualEpoch) {
      if (epoch === this.manualEpoch && !ready) { this.error = '音を準備できなかったよ。もう一度おしてね'; this.notify(); this.paint(); }
      return false;
    }
    this.error = '';
    const previous = this.manualVoices.get(value);
    if (previous) this.releaseManualVoice(previous);
    while (this.manualVoices.size >= MANUAL_MAX_VOICES) {
      const oldest = this.manualVoices.values().next().value;
      this.releaseManualVoice(oldest);
    }
    const when = ctx.currentTime;
    let oscillator;
    let gain;
    try {
      oscillator = ctx.createOscillator();
      gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency(value), when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.16, when + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + MANUAL_DURATION);
      oscillator.connect(gain); gain.connect(this.outputNode || ctx.destination);
      const entry = { midi: value, oscillator, gain, released: false, timer: null };
      const release = () => this.releaseManualVoice(entry, false);
      oscillator.addEventListener && oscillator.addEventListener('ended', release);
      oscillator.start(when);
      oscillator.stop(when + MANUAL_DURATION + 0.02);
      entry.timer = setTimeout(release, (MANUAL_DURATION + 0.15) * 1000);
      if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
      this.manualVoices.set(value, entry);
      this.notify();
      this.paint();
      return true;
    } catch (_) {
      try { if (oscillator) oscillator.disconnect(); } catch (_) {}
      try { if (gain) gain.disconnect(); } catch (_) {}
      this.error = '音を準備できなかったよ。もう一度おしてね';
      this.notify();
      this.paint();
      return false;
    }
  };
  MusicLearningController.prototype.fail = function (message) {
    this.error = message || '音を準備できなかったよ。もう一度おしてね';
    this.playing = false;
    this.position = 0;
    this.generation += 1;
    if (this.timer) { if (typeof window !== 'undefined') window.clearInterval(this.timer); this.timer = null; }
    this.cancelScheduled();
    this.clearManualVoices();
    this.notify();
    this.render();
  };
  MusicLearningController.prototype.schedule = function () {
    if (!this.playing || !this.ctx || !this.score) return;
    const current = this.getPosition();
    const repeatPhrase = this.repeat ? phraseAt(this.score, this.phraseIndex) : null;
    const boundary = repeatPhrase ? repeatPhrase.end : this.score.duration;
    const until = Math.min(boundary, current + LOOK_AHEAD * this.speed);
    const gen = this.generation;
    let failed = false;
    this.score.notes.forEach(note => {
      if (note.start + note.duration <= current || note.start >= until || note.start >= boundary) return;
      const key = `${gen}:${note.start}:${note.midi}`;
      if (this.scheduled.has(key)) return;
      const noteStart = Math.max(note.start, current);
      const when = this.ctx.currentTime + Math.max(0, (noteStart - current) / this.speed);
      const duration = Math.max(MIN_NOTE, (Math.min(note.start + note.duration, boundary) - noteStart) / this.speed);
      let oscillator;
      let gain;
      try {
        oscillator = this.ctx.createOscillator();
        gain = this.ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency(note.midi), when);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(0.16, when + Math.min(0.04, duration / 3));
        gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
        oscillator.connect(gain); gain.connect(this.outputNode || this.ctx.destination);
        oscillator.start(when); oscillator.stop(when + duration + 0.02);
        oscillator.addEventListener && oscillator.addEventListener('ended', () => { this.scheduled.delete(key); try { oscillator.disconnect(); } catch (_) {} try { gain.disconnect(); } catch (_) {} });
        this.scheduled.set(key, { oscillator, gain });
      } catch (_) {
        failed = true;
        try { if (oscillator) oscillator.disconnect(); } catch (_) {}
        try { if (gain) gain.disconnect(); } catch (_) {}
      }
    });
    if (failed) { this.fail(); return false; }
    return true;
  };
  MusicLearningController.prototype.tick = function () {
    if (!this.playing || !this.score) return;
    const pos = this.getPosition();
    const phrase = phraseAt(this.score, this.phraseIndex);
    if (!this.repeat) {
      const nextPhrase = this.score.phrases.findIndex(item => pos >= item.start && pos < item.end);
      if (nextPhrase >= 0 && nextPhrase !== this.phraseIndex) this.phraseIndex = nextPhrase;
    }
    const end = this.repeat && phrase ? phrase.end : this.score.duration;
    if (pos >= end - 0.015) {
      if (this.repeat && phrase) { this.position = phrase.start; this.startedAt = this.ctx.currentTime - this.position / this.speed; this.generation += 1; this.cancelScheduled(); }
      else { this.finish(); return; }
    }
    if (this.schedule() === false) return;
    this.render();
  };
  MusicLearningController.prototype.start = async function () {
    if (!this.score || !this.score.notes.length) { this.emit(); return false; }
    // ▶ は新しい世代の開始操作なので、音オフ判定でも古い手弾き待ちを残さない。
    this.clearManualVoices();
    if (this.beforePlay && this.beforePlay() === false) {
      this.error = '音がオフだよ。上の🔊でオンにしてね';
      this.emit();
      return false;
    }
    const ctx = this.audio();
    if (!ctx) { this.fail('この端末では音を鳴らせないよ。文字で見ることはできるよ'); return false; }
    const requestGeneration = ++this.generation;
    try { if (ctx.state === 'suspended' && ctx.resume) await ctx.resume(); } catch (_) {
      // 古い start の resume が遅れて失敗しても、後から始めた再生を止めない。
      if (requestGeneration !== this.generation) return false;
      this.fail('音を準備できなかったよ。もう一度おしてね');
      return false;
    }
    if (requestGeneration !== this.generation) return false;
    if (this.score.duration > 0 && this.position >= this.score.duration - 0.001) {
      this.position = 0;
      this.phraseIndex = 0;
    }
    this.error = '';
    this.playing = true;
    this.generation += 1;
    this.startedAt = ctx.currentTime - this.position / this.speed;
    this.cancelScheduled();
    if (this.schedule() === false) return false;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.notify();
    this.render();
    return true;
  };
  MusicLearningController.prototype.toggle = function () { return this.playing ? (this.pause(), false) : this.start(); };
  MusicLearningController.prototype.pause = function () {
    if (!this.playing) return;
    this.position = this.getPosition();
    this.playing = false;
    this.generation += 1;
    if (this.timer) { window.clearInterval(this.timer); this.timer = null; }
    this.cancelScheduled();
    this.clearManualVoices();
    this.notify();
    this.render();
  };
  MusicLearningController.prototype.finish = function () {
    this.position = this.score ? this.score.duration : 0;
    this.playing = false;
    this.generation += 1;
    if (this.timer) { window.clearInterval(this.timer); this.timer = null; }
    this.cancelScheduled();
    this.clearManualVoices();
    this.notify();
    this.render();
  };
  MusicLearningController.prototype.stop = function () {
    this.position = 0;
    this.phraseIndex = 0;
    this.error = '';
    this.playing = false;
    this.generation += 1;
    if (this.timer) { if (typeof window !== 'undefined') window.clearInterval(this.timer); this.timer = null; }
    this.cancelScheduled();
    this.clearManualVoices();
    this.notify();
    this.render();
    resetLearningScroll(this.root);
  };
  MusicLearningController.prototype.setSpeed = function (speed) {
    const value = typeof speed === 'string' ? SPEEDS[speed] : number(speed, 0.75);
    const next = Object.values(SPEEDS).reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, 0.75);
    if (this.playing) { this.position = this.getPosition(); this.startedAt = this.ctx.currentTime - this.position / next; this.generation += 1; this.cancelScheduled(); }
    this.speed = next;
    this.emit();
  };
  MusicLearningController.prototype.setPhrase = function (index) {
    const phrase = phraseAt(this.score, index);
    if (!phrase) return;
    if (this.playing) this.stop();
    this.phraseIndex = Math.max(0, Math.min(this.score.phrases.length - 1, Math.floor(number(index))));
    this.position = phrase.start;
    this.emit();
  };
  MusicLearningController.prototype.toggleRepeat = function () {
    this.repeat = !this.repeat;
    if (this.playing) {
      this.position = this.getPosition();
      this.startedAt = this.ctx.currentTime - this.position / this.speed;
      this.generation += 1;
      this.cancelScheduled();
      this.schedule();
    }
    this.emit();
  };
  MusicLearningController.prototype.toggleNotes = function () { this.showNotes = !this.showNotes; this.emit(); };
  MusicLearningController.prototype.toggleKeyboard = function () {
    this.showKeyboard = !this.showKeyboard;
    if (!this.showKeyboard) this.clearManualVoices();
    this.emit();
  };
  MusicLearningController.prototype.currentNote = function () { return getCurrentNote(this.score, this.getPosition()); };
  MusicLearningController.prototype.mount = function (rootNode) { this.root = rootNode; this.render(); };
  MusicLearningController.prototype.render = function () {
    if (!this.root || typeof document === 'undefined') return;
    const score = this.score;
    const pos = this.getPosition();
    const current = this.playing ? getCurrentNote(score, pos) : null;
    const signature = [this.trackId, this.edition, this.phraseIndex, this.showNotes, this.showKeyboard, this.repeat, this.speed, score && score.id || ''].join('|');
    if (this.renderSignature === signature && this.root.querySelector('.music-learning-play')) { this.paint(); return; }
    this.renderSignature = signature;
    const phrase = phraseAt(score, this.phraseIndex);
    const phraseNotes = score && phrase ? score.notes.filter(note => note.start >= phrase.start && note.start < phrase.end) : [];
    const options = this.data && getScoreMap(this.data) || {};
    const ids = (this.trackIds.length ? this.trackIds : Object.keys(options)).filter(id => getScore(this.data, id));
    this.root.innerHTML = `<div class="music-learning-picker"><label for="music-learning-track">曲をえらぶ</label><select id="music-learning-track"><option value="">${ids.length ? '曲をえらんでね' : '準備中'}</option>${ids.map(id => { const item = Tablet.arrange(getScoreMap(this.data)[id], this.edition) || getScore(this.data, id); return `<option value="${escapeHtml(id)}">${escapeHtml(item.title || id)}</option>`; }).join('')}</select></div>`;
    const select = this.root.querySelector('#music-learning-track');
    if (select) { select.value = this.trackId; select.addEventListener('change', () => this.select(select.value)); }
    this.root.querySelector('.music-learning-picker').insertAdjacentHTML('beforeend', '<select class="music-edition" aria-label="おぼえる演奏版"><option value="tablet">タブレット版</option><option value="original">原曲版</option></select>');
    const edition = this.root.querySelector('.music-edition'); edition.value = this.edition; edition.addEventListener('change', () => this.setEdition(edition.value));
    if (!score) { this.root.insertAdjacentHTML('beforeend', '<p class="music-learning-empty" role="status">曲をえらんでね</p>'); return; }
    // 技術的な出典はデータに保持するが、子ども向け画面には学習の目的だけを表示する。
    const source = `<small>${this.edition === 'tablet' ? (score.arranged ? 'タブレット版の編曲をおぼえよう' : 'タブレット版・メロディーをおぼえよう') : '原曲版・メロディーをおぼえよう'}</small>`;
    this.root.insertAdjacentHTML('beforeend', `<div class="music-learning-heading"><strong>${escapeHtml(learningTitle(score))}</strong>${source}</div><div class="music-learning-views"><button type="button" class="music-learning-view-toggle" data-view="notes" aria-pressed="${this.showNotes}">おんぷ</button><button type="button" class="music-learning-view-toggle" data-view="keyboard" aria-pressed="${this.showKeyboard}">けんばん</button></div><div class="music-learning-score" ${this.showNotes ? '' : 'hidden'}><p class="music-learning-guide">音のならび・線が長いほど長く鳴るよ</p><div class="music-staff" aria-label="音のならび"><span class="music-clef" aria-hidden="true">𝄞</span><div class="music-note-row">${phraseNotes.map(note => `<span class="music-note-item${current === note ? ' is-current' : ''}" data-midi="${note.midi}" data-start="${note.start}" data-accidental="${note.accidental || ''}" style="--note-step:${staffStep(note)}"><span class="music-note-ledger" aria-hidden="true">${'<i></i>'.repeat(ledgerLineCount(note))}</span><span class="music-note-dot">●</span><span class="music-note-name">${escapeHtml(displayNoteName(note))}</span><span class="music-note-bar" style="--note-length:${Math.max(1, Math.round(note.duration * 22))}px"></span></span>`).join('') || '<span class="music-rest">おやすみ</span>'}</div></div></div><p class="music-learning-keyboard-guide" ${this.showKeyboard ? '' : 'hidden'}>けんばんを さわって ひいてみよう</p><div class="music-learning-keyboard-wrap" ${this.showKeyboard ? '' : 'hidden'}>${keyboardHtml(score, current)}</div><div class="music-learning-controls"><button type="button" class="music-learning-play" aria-label="${this.playing ? '一時停止' : '再生'}">${this.playing ? 'Ⅱ' : '▶'}</button><button type="button" class="music-learning-stop" aria-label="先頭へ戻して停止">■</button><button type="button" class="music-learning-repeat" aria-pressed="${this.repeat}">ここをくりかえす</button><div class="music-learning-speed" role="group" aria-label="速さ">${Object.keys(SPEEDS).map(key => `<button type="button" data-speed="${key}" aria-pressed="${this.speed === SPEEDS[key]}">${SPEED_LABELS[key]}</button>`).join('')}</div><div class="music-learning-phrases" role="group" aria-label="フレーズ"><button type="button" data-phrase="${Math.max(0, this.phraseIndex - 1)}" aria-label="まえのフレーズ"${this.phraseIndex <= 0 ? ' disabled' : ''}>‹</button><span class="music-learning-phrase-count">${this.phraseIndex + 1} / ${score.phrases.length}</span><button type="button" data-phrase="${Math.min(score.phrases.length - 1, this.phraseIndex + 1)}" aria-label="つぎのフレーズ"${this.phraseIndex >= score.phrases.length - 1 ? ' disabled' : ''}>›</button></div></div><p class="music-learning-position" aria-live="polite">${this.playing ? '♪' : '■'} ${Math.floor(pos)} / ${Math.ceil(score.duration)}秒</p>`);
    const staff = this.root.querySelector('.music-staff');
    if (staff) staff.outerHTML = staffSvgHtml(phraseNotes, current);
    this.root.insertAdjacentHTML('beforeend', `<p class="music-learning-error" role="status" aria-live="polite">${escapeHtml(this.error)}</p>`);
    const error = this.root.querySelector('.music-learning-error');
    if (error) error.textContent = this.error;
    this.bindControls();
    this.paint();
  };
  MusicLearningController.prototype.paint = function () {
    if (!this.root || !this.score) return;
    const current = this.playing ? getCurrentNote(this.score, this.getPosition()) : null;
    const currentKey = current ? `${current.start}:${current.midi}` : '';
    this.root.querySelectorAll('.music-svg-note').forEach(node => node.classList.toggle('is-current', Boolean(current && Number(node.dataset.midi) === current.midi && Number(node.dataset.start) === current.start)));
    this.root.querySelectorAll('.music-key').forEach(node => {
      const midi = Number(node.dataset.midi);
      node.classList.toggle('is-current', Boolean(current && midi === current.midi));
      node.classList.toggle('is-manual', this.manualVoices.has(midi));
    });
    const play = this.root.querySelector('.music-learning-play');
    if (play) { play.textContent = this.playing ? 'Ⅱ' : '▶'; play.setAttribute('aria-label', this.playing ? '一時停止' : '再生'); }
    const position = this.root.querySelector('.music-learning-position');
    if (position) position.textContent = `${this.playing ? '♪' : '■'} ${Math.floor(this.getPosition())} / ${Math.ceil(this.score.duration)}秒`;
    const error = this.root.querySelector('.music-learning-error');
    if (error) error.textContent = this.error;
    if (current && currentKey !== this.lastCurrentKey) {
      const key = this.root.querySelector(`.music-key[data-midi="${current.midi}"]`);
      followHorizontal(key);
      const note = this.root.querySelector(`.music-svg-note[data-midi="${current.midi}"][data-start="${current.start}"]`);
      followHorizontal(note);
    }
    this.lastCurrentKey = currentKey;
  };
  function followHorizontal(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') return;
    const container = node.closest && node.closest('.music-staff,.music-learning-keyboard-wrap');
    if (!container || typeof container.getBoundingClientRect !== 'function') return;
    const box = container.getBoundingClientRect();
    const item = node.getBoundingClientRect();
    if (item.left < box.left) container.scrollLeft -= box.left - item.left;
    else if (item.right > box.right) container.scrollLeft += item.right - box.right;
  }
  function resetLearningScroll(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('.music-staff,.music-learning-keyboard-wrap').forEach(node => { node.scrollLeft = 0; });
  }
  function staffSvgHtml(notes, current) {
    const width = Math.max(360, 76 + notes.length * 48);
    // E4を下第1線、F5を上第5線に置く。曲ごとの上下音域から余白を取り、G#7も切らない。
    const layout = staffLayout(notes);
    const { staffBottom, height, labelY, barY } = layout;
    const lines = [staffBottom - 48, staffBottom - 36, staffBottom - 24, staffBottom - 12, staffBottom].map(y => `<line x1="46" y1="${y}" x2="${width - 8}" y2="${y}" />`).join('');
    const marks = notes.map((note, index) => {
      const x = 70 + index * 48;
      const y = layout.noteY(note);
      const active = current && current.midi === note.midi && current.start === note.start;
      const ledgers = [];
      const step = staffStep(note);
      if (step < 0) for (let s = -2; s >= step; s -= 2) ledgers.push(`<line x1="${x - 14}" y1="${staffBottom - s * 6}" x2="${x + 14}" y2="${staffBottom - s * 6}" class="music-ledger" />`);
      if (step > 8) for (let s = 10; s <= step; s += 2) ledgers.push(`<line x1="${x - 14}" y1="${staffBottom - s * 6}" x2="${x + 14}" y2="${staffBottom - s * 6}" class="music-ledger" />`);
      const label = displayNoteName(note);
      const labelMatch = label.match(/^(.*?)(-?\d+)$/);
      const labelHtml = labelMatch ? `${escapeHtml(labelMatch[1])}<tspan class="music-svg-name-octave">${escapeHtml(labelMatch[2])}</tspan>` : escapeHtml(label);
      const accidental = note.accidental === 'flat' || note.accidental === '♭' ? '♭' : note.accidental === 'sharp' || note.accidental === '♯' ? '♯' : '';
      const stemDown = step >= 6;
      const stemX = stemDown ? x - 8 : x + 8;
      const stemY = stemDown ? y + 30 : y - 30;
      return `${ledgers.join('')}<g class="music-svg-note${active ? ' is-current' : ''}" data-midi="${note.midi}" data-start="${note.start}" data-accidental="${note.accidental || ''}"><text x="${x - 18}" y="${y + 5}" class="music-accidental">${accidental}</text><ellipse cx="${x}" cy="${y}" rx="9" ry="6" /><line x1="${stemX}" y1="${y}" x2="${stemX}" y2="${stemY}" class="music-stem" /><text x="${x}" y="${labelY}" text-anchor="middle" class="music-svg-name">${labelHtml}</text><rect x="${x - 12}" y="${barY}" width="${Math.max(8, Math.round(note.duration * 22))}" height="4" rx="2" class="music-length-bar" /></g>`;
    }).join('');
    return `<div class="music-staff" aria-label="音のならび"><svg class="music-staff-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="五線譜と音名"><text x="10" y="${staffBottom - 10}" class="music-svg-clef">𝄞</text>${lines}${marks}</svg></div>`;
  }
  function staffLayout(notes) {
    const steps = notes.length ? notes.map(staffStep) : [0];
    const minStep = Math.min(...steps);
    const maxStep = Math.max(...steps);
    const staffBottom = Math.max(106, 24 + maxStep * 6);
    const stemBottom = Math.max(...steps.map(step => {
      const y = staffBottom - step * 6;
      return step >= 6 ? y + 30 : y;
    }));
    const height = Math.max(190, staffBottom + 58, stemBottom + 58, staffBottom - minStep * 6 + 58);
    return { staffBottom, height, labelY: height - 28, barY: height - 16, noteY: note => staffBottom - staffStep(note) * 6 };
  }
  MusicLearningController.prototype.bindControls = function () {
    const root = this.root;
    root.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { if (button.dataset.view === 'notes') this.toggleNotes(); else this.toggleKeyboard(); }));
    const play = root.querySelector('.music-learning-play'); if (play) play.addEventListener('click', () => this.toggle());
    const stop = root.querySelector('.music-learning-stop'); if (stop) stop.addEventListener('click', () => this.stop());
    const repeat = root.querySelector('.music-learning-repeat'); if (repeat) repeat.addEventListener('click', () => this.toggleRepeat());
    root.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click', () => this.setSpeed(button.dataset.speed)));
    root.querySelectorAll('[data-phrase]').forEach(button => button.addEventListener('click', () => this.setPhrase(Number(button.dataset.phrase))));
    root.querySelectorAll('.music-key').forEach(button => button.addEventListener('click', () => this.playKey(Number(button.dataset.midi))));
  };
  function keyboardHtml(score, current) {
    const layout = keyboardLayout(score);
    if (!layout.whiteCount) return '';
    const keys = [];
    layout.keys.forEach(keyInfo => {
      const { midi, black, boundary } = keyInfo;
      const active = current && current.midi === midi;
      const label = `${keyboardLabel(midi, current)}${Math.floor(midi / 12) - 1}`;
      const unit = 100 / layout.whiteCount;
      const left = black ? (boundary - 0.33) * unit : boundary * unit;
      const width = black ? 0.66 * unit : unit;
      const cKey = !black && midi % 12 === 0;
      keys.push(`<button type="button" class="music-key ${black ? 'is-black' : 'is-white'}${cKey ? ' is-c' : ''}${active ? ' is-current' : ''}" style="left:${left}%;width:${width}%" data-midi="${midi}" aria-label="${escapeHtml(label)}のけんばん"><span>${escapeHtml(keyboardLabel(midi, current))}</span>${cKey ? `<small>${Math.floor(midi / 12) - 1}</small>` : ''}</button>`);
    });
    return `<div class="music-keyboard" style="--keyboard-min-width:${layout.whiteCount * 44}px" aria-label="ピアノ鍵盤">${keys.join('')}</div>`;
  }
  function keyboardLabel(midi, current) {
    const pc = ((midi % 12) + 12) % 12;
    const sharp = pitchName[pc];
    if (![1, 3, 6, 8, 10].includes(pc)) return sharp;
    if (current && current.midi === midi) return displayNoteName(current).replace(/-?\d+$/, '');
    return sharp;
  }
  function keyboardLayout(score) {
    if (!score || !Array.isArray(score.notes) || !score.notes.length) return { min: 0, max: 0, whiteCount: 0, keys: [] };
    const minNote = Math.min(...score.notes.map(note => Math.round(number(note.midi, 60))));
    const maxNote = Math.max(...score.notes.map(note => Math.round(number(note.midi, 60))));
    const min = score.keyboardRange ? score.keyboardRange[0] : Math.max(0, Math.floor(minNote / 12) * 12);
    const max = score.keyboardRange ? score.keyboardRange[1] : Math.min(127, Math.ceil(maxNote / 12) * 12);
    const isBlack = midi => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
    const whiteCount = Array.from({ length: max - min + 1 }, (_, index) => min + index).filter(midi => !isBlack(midi)).length;
    let whiteIndex = 0;
    const keys = [];
    for (let midi = min; midi <= max; midi += 1) {
      if (isBlack(midi)) keys.push({ midi, black: true, boundary: whiteIndex });
      else { keys.push({ midi, black: false, boundary: whiteIndex }); whiteIndex += 1; }
    }
    return { min, max, whiteCount, keys };
  }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }
  return { SPEEDS, SPEED_LABELS, normalizeScore, getScore, learningTitle, getCurrentNote, midiName, displayNoteName, keyboardLabel, keyboardLayout, notePosition, notePositionFor, staffStep, ledgerLineCount, staffLayout, frequency, MusicLearningController };
}));
