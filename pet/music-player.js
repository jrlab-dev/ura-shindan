/* おんがく（♪）v1（設計書 おんがくv1）。上の帯の ♪ から絵のカードで曲を選んで流す。
   音楽は HTMLAudioElement 1つを使い回す（preload="none"・押したときに src を入れる・音量は控えめ）。
   ここが持つのは曲の一覧（TRACKS・1か所だけ）と、押したときの次の状態を決める純粋な計算（nextState）。
   DOM には触れない形にして、Node（tests/music-player.test.js）でも検査できるようにする
   （radio-recorder.js と同じ書き方）。再生の失敗は握りつぶさず、状態を止めに戻す。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionMusicPlayer = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 曲の一覧（原曲限定・設計書どおりの順・絵・名前）。足す・消すのはこの1行だけ */
  const TRACKS = [
    { id:'twinkle', file:'twinkle.mp3',          art:'⭐', name:'きらきらぼし' },
    { id:'ofuro',    file:'ofuro.mp3',           art:'🛁', name:'にんぎょうの ゆめ' },
    { id:'canon',    file:'canon.mp3',           art:'🎼', name:'かのん' },
    { id:'jesu',     file:'jesu.mp3',            art:'🎹', name:'しゅよ ひとの のぞみの よろこびよ' },
    { id:'haru',     file:'haru.mp3',             art:'🌸', name:'はる' },
    { id:'konpeito', file:'konpeito-original.mp3', art:'🍬', name:'こんぺいとうの おどり' },
    { id:'masu',     file:'masu.mp3',             art:'🐟', name:'ます' },
    { id:'donau',    file:'donau.mp3',            art:'🌊', name:'あおき ドナウ' }
  ];
  const VOLUME = 0.6;              /* 音量は控えめ（設計書） */
  const BASE = 'music/';           /* app/music/ への相対パス */

  const trackById = id => TRACKS.find(track => track.id === id) || null;
  const trackSource = id => { const track = trackById(id); return track ? BASE + track.file : ''; };

  /* 純粋な計算：カードを押したときの次の状態。
     - 音モードが「文字だけ」のときは鳴らさない（🔇の絵を見せるだけ）
     - 止まっている → その曲を流す ／ 流れている曲と同じ → 止める ／ 別の曲 → 切り替える */
  const nextState = ({ currentId = '', pressedId = '', soundOn = true } = {}) => {
    const track = trackById(pressedId);
    if (!track) return { playing:false, trackId:'', muteHint:false };
    if (!soundOn) return { playing:false, trackId:'', muteHint:true };
    if (pressedId === currentId) return { playing:false, trackId:'', muteHint:false };
    return { playing:true, trackId:pressedId, muteHint:false };
  };

  /* 再生の本体。HTMLAudioElement 1つを使い回す。いま流れている曲の id だけ持つ */
  function MusicPlayer(options = {}) {
    this.audio = null;
    this.trackId = '';
    this.token = 0;
    this.onCreate = typeof options.onCreate === 'function' ? options.onCreate : null;  /* audio を作った直後の差し込み口（検査用） */
    this.audioBus = options.audioBus || null;
    this.mediaSource = null;
    this.audioContext = null;
  }

  MusicPlayer.prototype.ensureAudio = function () {
    if (this.audio) return this.audio;
    const AudioClass = typeof Audio !== 'undefined' ? Audio : null;
    if (!AudioClass) return null;
    const audio = new AudioClass();
    audio.preload = 'none';
    audio.volume = VOLUME;
    this.audio = audio;
    if (this.audioBus && typeof this.audioBus.ensure === 'function') {
      const route = this.audioBus.ensure();
      if (route && route.context && route.output && typeof route.context.createMediaElementSource === 'function') {
        try {
          this.audioContext = route.context;
          this.mediaSource = route.context.createMediaElementSource(audio);
          this.mediaSource.connect(route.output);
        } catch (_) { this.audioContext = null; this.mediaSource = null; }
      }
    }
    if (this.onCreate) { try { this.onCreate(audio); } catch (_) {} }
    return audio;
  };

  /* カードを押す（app.js はこの結果を画面に映す）。play() の失敗は止めに戻して返す */
  MusicPlayer.prototype.press = async function (pressedId, soundOn = true) {
    const next = nextState({ currentId:this.trackId, pressedId, soundOn });
    if (!next.playing) { this.stop(); return next; }
    const audio = this.ensureAudio();
    if (!audio) return { playing:false, trackId:'', muteHint:false };
    /* 押すたびに番号を進める。前の曲の play() が後から失敗しても（切り替えで中断されたなど）、新しい曲を止めない */
    const token = ++this.token;
    try { audio.pause(); } catch (_) {}
    audio.src = trackSource(next.trackId);
    this.trackId = next.trackId;
    try {
      if (this.audioContext && this.audioContext.state === 'suspended' && this.audioContext.resume) await this.audioContext.resume();
      if (token !== this.token) return { playing:Boolean(this.trackId), trackId:this.trackId, muteHint:false };
      await audio.play();
      if (token !== this.token) return { playing:Boolean(this.trackId), trackId:this.trackId, muteHint:false };
      return next;
    } catch (_) {
      if (token !== this.token) return { playing:Boolean(this.trackId), trackId:this.trackId, muteHint:false };
      /* 自動再生拒否・読めない：カードの光を消して、止めた状態に戻す */
      this.stop();
      return { playing:false, trackId:'', muteHint:false };
    }
  };

  MusicPlayer.prototype.stop = function () {
    this.token += 1;
    if (!this.audio) { this.trackId = ''; return; }
    try { this.audio.pause(); } catch (_) {}
    this.audio.removeAttribute('src');
    try { this.audio.load(); } catch (_) {}
    this.trackId = '';
  };

  MusicPlayer.prototype.isPlaying = function () {
    return Boolean(this.trackId && this.audio && !this.audio.paused && !this.audio.ended);
  };

  return { TRACKS, VOLUME, BASE, trackById, trackSource, nextState, MusicPlayer };
}));
