(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./music-rhythm.js'), require('./music-effects.js'));
  else root.LittleCompanionMusicVideo = factory(root.LittleCompanionMusicRhythm, root.LittleCompanionMusicEffects);
}(typeof self !== 'undefined' ? self : this, function (Rhythm, Effects) {
  'use strict';
  const DB_NAME = 'little-companion-music-video-v1';
  const MAX_BYTES = 64 * 1024 * 1024;
  const MAX_MS = 480000;
  const SETTING = 'little-companion-auto-video';
  const MIME_TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const TONES = { piano:'ピアノ', musicbox:'オルゴール', wood:'木琴' };
  const NAMES = ['ド','ド♯','レ','レ♯','ミ','ファ','ファ♯','ソ','ソ♯','ラ','ラ♯','シ'];
  function validClip(c) {
    return Boolean(c && typeof c.id === 'string' && c.id.length < 160 && typeof c.title === 'string' && c.title.length <= 100 &&
      Number.isInteger(c.points) && c.points > 0 && c.points <= 100 && Number.isFinite(c.createdAt) &&
      c.blob instanceof Blob && c.blob.size > 0 && c.blob.size <= MAX_BYTES && /^video\/(mp4|webm)(;|$)/.test(c.blob.type) &&
      Number.isFinite(c.durationMs) && c.durationMs > 0 && c.durationMs <= MAX_MS + 2000);
  }
  function rank(clips) { return clips.filter(validClip).sort((a,b) => b.points - a.points || b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0,2); }
  function pickMime(MR) { return MR && typeof MR.isTypeSupported === 'function' ? MIME_TYPES.find(type => MR.isTypeSupported(type)) || '' : ''; }
  // Streaming WebM has no duration. Add it to an unindexed, unknown-size Segment.
  // Indexed or unfamiliar files are preserved; MP4 is already finalized by the browser.
  async function withWebmDuration(blob,durationMs) {
    if (!blob.type.startsWith('video/webm')) return blob;
    const bytes = new Uint8Array(await blob.slice(0,65536).arrayBuffer());
    const header = at => {
      const start = at; let idLength = 1, mask = 128;
      while (idLength <= 4 && !(bytes[at] & mask)) { idLength++; mask >>= 1; }
      if (idLength > 4 || at + idLength >= bytes.length) return null;
      let id = 0; for (let n=0;n<idLength;n++) id = id*256 + bytes[at++];
      let sizeLength = 1; mask = 128;
      while (sizeLength <= 8 && !(bytes[at] & mask)) { sizeLength++; mask >>= 1; }
      if (sizeLength > 8 || at + sizeLength > bytes.length) return null;
      let size = bytes[at++] & (mask-1), unknown = size === mask-1;
      for (let n=1;n<sizeLength;n++) { const b = bytes[at++]; size = size*256+b; unknown = unknown && b===255; }
      if (!unknown && !Number.isSafeInteger(size)) return null;
      return {start,id,idLength,sizeLength,data:at,size:unknown ? Infinity : size,end:unknown ? Infinity : at+size};
    };
    let segment, info;
    for (let at=0;at<bytes.length;) { const e=header(at); if (!e) return blob; if (e.id===0x18538067) { segment=e; break; } at=e.end; }
    if (!segment || segment.size!==Infinity) return blob;
    for (let at=segment.data;at<bytes.length;) {
      const e=header(at); if (!e) return blob;
      if (e.id===0x114d9b74 || e.id===0x1c53bb6b) return blob;
      if (e.id===0x1549a966) info=e;
      if (e.id===0x1f43b675) break;
      at=e.end;
    }
    if (!info || info.end>bytes.length) return blob;
    let scale=1000000;
    for (let at=info.data;at<info.end;) {
      const e=header(at); if (!e || e.end>info.end) return blob;
      if (e.id===0x4489) return blob;
      if (e.id===0x2ad7b1) { scale=0; for(let n=e.data;n<e.end;n++) scale=scale*256+bytes[n]; }
      at=e.end;
    }
    if (!(scale>0)) return blob;
    const duration=new Uint8Array(11); duration.set([0x44,0x89,0x88]); new DataView(duration.buffer).setFloat64(3,durationMs*1000000/scale);
    const size=info.size+duration.length; let length=info.sizeLength;
    while(size>=2**(7*length)-1) length++;
    if(length>4) return blob;
    const encoded=new Uint8Array(length); let remainder=size;
    for(let i=length-1;i>=0;i--) { encoded[i]=remainder%256; remainder=Math.floor(remainder/256); }
    encoded[0]|=1<<(8-length);
    return new Blob([bytes.slice(0,info.start+info.idLength),encoded,bytes.slice(info.data,info.end),duration,blob.slice(info.end)],{type:blob.type});
  }
  function inspectVideo(blob) {
    return new Promise(resolve => {
      const video = document.createElement('video'), url = URL.createObjectURL(blob);
      let done = false;
      const finish = ok => { if (done) return; done = true; clearTimeout(timer); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); resolve(ok); };
      const timer = setTimeout(() => finish(false),8000);
      video.muted = true; video.preload = 'auto'; video.playsInline = true;
      video.onloadeddata = () => finish(video.videoWidth > 0 && video.videoHeight > 0);
      video.onerror = () => finish(false); video.src = url; video.load();
    });
  }
  function VideoStore(idb) { this.idb = idb || (typeof indexedDB !== 'undefined' ? indexedDB : null); }
  VideoStore.prototype.open = function () {
    return new Promise((resolve,reject) => {
      if (!this.idb) { reject(new Error('storage-unavailable')); return; }
      let blocked = false;
      const req = this.idb.open(DB_NAME,1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('clips',{keyPath:'id'}); db.createObjectStore('meta',{keyPath:'key'});
      };
      req.onsuccess = () => { if (blocked) { req.result.close(); return; } resolve(req.result); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => { blocked = true; reject(new Error('storage-blocked')); };
    });
  };
  VideoStore.prototype.read = async function () {
    const db = await this.open();
    try {
      return await new Promise((resolve,reject) => {
        const tx = db.transaction(['clips','meta'],'readonly'); let clips = [], epoch = 0;
        const rows = tx.objectStore('clips').getAll(); rows.onsuccess = () => { clips = rank(rows.result); };
        const meta = tx.objectStore('meta').get('epoch'); meta.onsuccess = () => { epoch = meta.result?.value || 0; };
        tx.oncomplete = () => resolve({clips,epoch}); tx.onabort = tx.onerror = () => reject(tx.error || new Error('storage-failed'));
      });
    } finally { db.close(); }
  };
  // Reading, ranking, replacement and the deletion generation share one transaction.
  VideoStore.prototype.offer = async function (clip, epoch) {
    if (!validClip(clip)) return {kept:false,reason:'invalid'};
    const db = await this.open();
    try {
      return await new Promise((resolve,reject) => {
        const tx = db.transaction(['clips','meta'],'readwrite'), store = tx.objectStore('clips');
        let all, current, result = {kept:false,reason:'stale'};
        const decide = () => {
          if (all === undefined || current === undefined || current !== epoch) return;
          const winners = rank([...all.filter(c => c.id !== clip.id),clip]);
          result = {kept:winners.some(c => c.id === clip.id),reason:'rank'};
          if (!result.kept) return;
          const keep = new Set(winners.map(c => c.id));
          all.forEach(c => { if (!keep.has(c.id)) store.delete(c.id); });
          store.put(clip);
        };
        const rows = store.getAll(); rows.onsuccess = () => { all = rows.result; decide(); };
        const meta = tx.objectStore('meta').get('epoch'); meta.onsuccess = () => { current = meta.result?.value || 0; decide(); };
        tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(tx.error || new Error('storage-failed'));
      });
    } finally { db.close(); }
  };
  VideoStore.prototype.remove = async function (id = null) {
    const db = await this.open();
    try {
      await new Promise((resolve,reject) => {
        const tx = db.transaction(['clips','meta'],'readwrite');
        const meta = tx.objectStore('meta'), request = meta.get('epoch');
        request.onsuccess = () => {
          meta.put({key:'epoch',value:(request.result?.value || 0) + 1});
          if (id === null) tx.objectStore('clips').clear(); else tx.objectStore('clips').delete(id);
        };
        tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('storage-failed'));
      });
    } finally { db.close(); }
  };

  function drawFrame(canvas, controller, finalState) {
    const state = finalState || controller.getState(), ctx = canvas.getContext('2d');
    if (!ctx || !state.score) return;
    const layout = Rhythm.keyboardLayout(state.score), left = 24, width = 912, hitY = 354, laneHeight = 226, keyY = 368, keyHeight = 112;
    ctx.fillStyle = '#f7f3fc'; ctx.fillRect(0,0,960,540);
    const text = (value,x,y,size,color = '#4b3b62',align = 'left') => {
      ctx.font = `600 ${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.fillStyle = color; ctx.fillText(String(value),x,y);
    };
    text('ぽこ・ふわ　おんがく',24,32,17,'#87729e');
    text(state.score.title || state.trackId,24,70,27);
    text(`${TONES[state.instrument] || TONES.piano} ・ ${state.speed === .5 ? 'ゆっくり' : state.speed === .75 ? 'すこしゆっくり' : 'ふつう'} ・ ${controller.edition === 'original' ? '原曲版' : 'タブレット版'}`,24,102,15);
    text(`${state.points} 点`,936,62,29,'#72519d','right');
    const fx = Effects.view(state.effectEvents, controller.audioTime(), state.effectsQuiet);
    text(`${fx.milestone ? '★ ' : ''}${state.combo} COMBO`,936,99,18*fx.scale,'#72519d','right');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(left,124,width,hitY - 120);
    ctx.save(); ctx.beginPath(); ctx.rect(left,124,width,hitY - 120); ctx.clip();
    (state.visibleNotes || []).forEach(note => {
      const pos = Rhythm.keyPosition(layout,note.midi), x = left + pos.left / 100 * width, w = pos.width / 100 * width;
      const h = Math.max(10,note.duration / state.speed / 3 * laneHeight), y = hitY - note.untilMs / 3000 * laneHeight - h;
      ctx.fillStyle = '#efb2cd'; ctx.fillRect(x + 2,y,w - 4,h);
      ctx.strokeStyle = '#cb638d'; ctx.lineWidth = 2; ctx.strokeRect(x + 2,y,w - 4,h);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x + w/2,y + h,3,0,Math.PI*2); ctx.fill();
    });
    ctx.restore(); ctx.fillStyle = '#d477a1'; ctx.fillRect(left,hitY,width,3);
    const cues = new Set((state.activeNotes || []).map(n => n.midi));
    const now = controller.audioTime();
    const drawKey = key => {
      const pos = Rhythm.keyPosition(layout,key.midi), x = left + pos.left / 100 * width, w = pos.width / 100 * width;
      const voice = controller.voices.get(key.midi), pressed = voice && now < Math.min(voice.noteOffAt,voice.naturalEndAt);
      const lit = cues.has(key.midi), h = key.black ? 72 : keyHeight;
      ctx.fillStyle = pressed ? '#c9b4f0' : lit ? '#f4a9c9' : key.black ? '#47365c' : '#fff';
      ctx.fillRect(x,keyY,w,h); ctx.strokeStyle = lit ? '#cc5e92' : '#9d90b0'; ctx.lineWidth = lit ? 3 : 1; ctx.strokeRect(x + .5,keyY + .5,w - 1,h - 1);
      const label = NAMES[key.midi % 12] + (Math.floor(key.midi/12) - 1);
      text(label,x + w/2,keyY + h - 10,layout.whiteCount > 20 ? 10 : 12,key.black ? '#fff' : '#534461','center');
      if (key.midi === Math.ceil(layout.min/12)*12) {
        ctx.fillStyle = '#f6d46d'; ctx.beginPath(); ctx.arc(x+w/2,keyY+86,9,0,Math.PI*2); ctx.fill(); text('★',x+w/2,keyY+91,14,'#6e4c20','center');
      }
    };
    layout.keys.filter(k => !k.black).forEach(drawKey); layout.keys.filter(k => k.black).forEach(drawKey);
    fx.rings.forEach(ring => {
      const pos = Rhythm.keyPosition(layout,ring.midi), w=pos.width/100*width;
      ctx.save();ctx.globalAlpha=.45*(1-ring.progress);ctx.strokeStyle='#a27ac5';ctx.lineWidth=2;ctx.beginPath();ctx.arc(left+(pos.left+pos.width/2)/100*width,keyY+19,Math.min(14,w*.42)*(.65+.35*ring.progress),0,Math.PI*2);ctx.stroke();ctx.restore();
    });
    if (state.hitFeedback) {
      const pos = Rhythm.keyPosition(layout,state.hitFeedback.midi);
      const x = Math.max(85,Math.min(875,left+(pos.left+pos.width/2)/100*width));
      text(state.hitFeedback.grade === 'perfect' ? 'GREAT' : 'GOOD',x,340,23,'#7a4caa','center');
    }
    text(state.phase === 'countdown' ? `じゅんび… ${Math.ceil(state.countdownMs/1000)}` : '光ったら おしてね',480,518,18,'#87729e','center');
    if (state.phase === 'finished') {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(210,154,540,172);
      Effects.drawPet(ctx,226,204,48,false,fx.bow); Effects.drawPet(ctx,686,204,48,true,fx.bow);
      text('今回のスコア',480,190,18,'#87729e','center');
      text(`${state.points} 点 / 100`,480,244,44,'#72519d','center');
      text(`GREAT ${state.perfect}　GOOD ${state.nice}　最大 ${state.maxCombo} COMBO`,480,287,17,'#534461','center');
      ctx.fillStyle = '#f7f3fc'; ctx.fillRect(0,493,960,47); text(Effects.resultMessage(state.hits),480,521,22,'#72519d','center');
    }
  }

  function VideoRecorder(options = {}) {
    this.store = options.store || new VideoStore(); this.audioBus = options.audioBus;
    this.MR = options.MediaRecorder || (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null);
    this.makeCanvas = options.makeCanvas || (() => document.createElement('canvas'));
    this.makeStream = options.makeStream || (tracks => new MediaStream(tracks));
    this.draw = options.draw || drawFrame;
    this.inspect = options.inspect || inspectVideo;
    this.onChange = options.onChange || (() => {});
    this.setTimeout = options.setTimeout || ((fn,ms) => setTimeout(fn,ms)); this.clearTimeout = options.clearTimeout || (id => clearTimeout(id));
    this.setInterval = options.setInterval || ((fn,ms) => setInterval(fn,ms)); this.clearInterval = options.clearInterval || (id => clearInterval(id));
    this.now = options.now || (() => Date.now());
    this.active = null; this.sessions = new Set(); this.serial = 0; this.enabled = true;
  }
  VideoRecorder.prototype.message = function (text,recording = false) { this.onChange({text,recording}); };
  VideoRecorder.prototype.start = function (controller) {
    if (this.active?.complete) this.stopSession(this.active); else this.cancel();
    if (!this.enabled) return;
    let session;
    try {
      const mimeType = pickMime(this.MR), canvas = this.makeCanvas(), route = this.audioBus?.ensure();
      if (!mimeType || !canvas.captureStream || !route?.destination?.stream || !route.destination.stream.getAudioTracks().length) throw new Error('unsupported');
      const state = controller.getState();
      if (state.score.duration / state.speed * 1000 + 5000 > MAX_MS) { this.message('この曲の長さでは録画できません。ゲームは遊べるよ'); return; }
      canvas.width = 960; canvas.height = 540; this.draw(canvas,controller);
      session = {controller,canvas,startedAt:this.now(),id:`${this.now()}-${++this.serial}-${Math.random().toString(36).slice(2)}`,chunks:[],bytes:0,tracks:[],cancelled:false,complete:false,done:false};
      this.sessions.add(session); this.active = session;
      const video = canvas.captureStream(24); session.tracks.push(...video.getVideoTracks());
      // Keep silent countdown samples flowing so the encoder shares the video timeline.
      session.clock = route.context.createConstantSource();
      session.clock.offset.value = 0; session.clock.connect(route.destination); session.clock.start();
      session.tracks.push(...route.destination.stream.getAudioTracks().map(track => track.clone()));
      session.epoch = this.store.read().then(result => result.epoch).catch(() => { this.fail(session,'動画を残せません。端末の空き容量や保存設定を確認してね'); return null; });
      session.recorder = new this.MR(this.makeStream(session.tracks), {mimeType,videoBitsPerSecond:800000,audioBitsPerSecond:96000});
      session.recorder.ondataavailable = event => {
        if (session.cancelled || !event.data?.size) return;
        session.bytes += event.data.size;
        if (session.bytes > MAX_BYTES) { this.fail(session,'動画が大きくなったため録画を止めました。ゲームは続けられるよ'); return; }
        session.chunks.push(event.data);
      };
      session.recorder.onerror = () => this.fail(session,'録画できませんでした。ゲームは続けられるよ');
      session.recorder.onstop = () => { session.task = this.finalize(session); };
      session.recorder.start(1000);
      session.paintTimer = this.setInterval(() => {
        if (session.cancelled || session.stopping) return;
        try { this.draw(canvas,controller,session.finalState); } catch (_) { this.fail(session,'録画できませんでした。ゲームは続けられるよ'); }
      },1000/24);
      session.limitTimer = this.setTimeout(() => this.fail(session,'録画の時間を超えました。ゲームは続けられるよ'),MAX_MS);
      this.message('● 自動録画中 — 高得点の2件を残すよ',true);
    } catch (_) {
      if (session) this.fail(session,'この端末では自動録画できません。ゲームは遊べるよ');
      else this.message('この端末では自動録画できません。ゲームは遊べるよ');
    }
  };
  VideoRecorder.prototype.finish = function (state) {
    const s = this.active; if (!s || s.cancelled || s.complete) return;
    if (state.points <= 0) { this.cancel(); this.message('点数がついた演奏を、上位2件まで残すよ'); return; }
    s.complete = true; s.finalState = state;
    s.metadata = {id:s.id,title:String(state.score.title || state.trackId).slice(0,100),trackId:state.trackId,points:state.points,createdAt:s.startedAt,instrument:state.instrument,speed:state.speed,edition:s.controller.edition,maxCombo:state.maxCombo};
    this.draw(s.canvas,s.controller,state);
    s.tailTimer = this.setTimeout(() => this.stopSession(s),1000);
    this.message('動画をまとめています…');
  };
  VideoRecorder.prototype.fail = function (s,text) { s.cancelled = true; s.chunks = []; this.stopSession(s); this.message(text); };
  VideoRecorder.prototype.cleanup = function (s,retain = false) {
    this.clearInterval(s.paintTimer); this.clearTimeout(s.limitTimer); this.clearTimeout(s.tailTimer); this.clearTimeout(s.watchdog);
    s.tracks.forEach(track => { try { track.stop(); } catch (_) {} });
    if (s.clock) { try { s.clock.stop(); s.clock.disconnect(); } catch (_) {} }
    if (!retain) this.sessions.delete(s); if (this.active === s) this.active = null;
  };
  VideoRecorder.prototype.stopSession = function (s) {
    if (!s || s.done || s.stopping) return;
    s.stopping = true; s.durationMs = Math.max(1,this.now()-s.startedAt);
    this.clearInterval(s.paintTimer); this.clearTimeout(s.limitTimer); this.clearTimeout(s.tailTimer);
    s.watchdog = this.setTimeout(() => {
      s.cancelled = true; s.done = true; s.chunks = []; this.cleanup(s); this.message('録画を保存できませんでした');
    },5000);
    try { if (s.recorder && s.recorder.state !== 'inactive') s.recorder.stop(); else s.task = this.finalize(s); }
    catch (_) { s.cancelled = true; s.task = this.finalize(s); }
  };
  VideoRecorder.prototype.finalize = async function (s) {
    if (s.done) return; s.done = true; this.cleanup(s,true);
    try {
      if (s.cancelled || !s.complete) { s.chunks = []; return; }
      const epoch = await s.epoch;
      if (s.cancelled || epoch === null) return;
      const blob = await withWebmDuration(new Blob(s.chunks,{type:s.recorder.mimeType || s.chunks[0]?.type}),s.durationMs); s.chunks = [];
      const clip = {...s.metadata,blob,durationMs:s.durationMs};
      if (!validClip(clip)) throw new Error('invalid');
      if (!await this.inspect(blob)) throw new Error('unplayable');
      if (s.cancelled) return;
      const result = await this.store.offer(clip,epoch);
      if (!this.active) this.message(result.kept ? 'ベスト動画に残したよ！ あとから見て保存できるよ' : result.reason === 'stale' ? '動画の更新を取り消しました' : '今回は前のベスト動画を残したよ');
    } catch (_) { if (!this.active) this.message('動画を保存できませんでした。前の動画は残っているよ'); }
    finally { s.chunks = []; this.sessions.delete(s); }
  };
  VideoRecorder.prototype.cancel = function () {
    const s = this.active; if (!s) return;
    if (s.complete) { this.stopSession(s); return; }
    s.cancelled = true; s.chunks = []; this.stopSession(s); this.message('途中で止めた演奏は残りません');
  };
  VideoRecorder.prototype.clear = async function (id = null) {
    for (const s of [...this.sessions]) { s.cancelled = true; s.chunks = []; this.stopSession(s); }
    await this.store.remove(id);
  };

  function mount(options) {
    const doc = options.document || document, toggle = doc.getElementById('music-auto-video'), status = doc.getElementById('music-video-status');
    const dialog = doc.getElementById('music-videos-dialog'), list = doc.getElementById('music-videos-list');
    const recorder = new VideoRecorder({...options,onChange:({text,recording}) => { status.textContent = text; status.dataset.recording = String(recording); }});
    try { recorder.enabled = localStorage.getItem(SETTING) !== 'off'; } catch (_) {}
    toggle.checked = recorder.enabled;
    if (!recorder.enabled) recorder.message('自動録画はオフ。前の動画は残っているよ');
    toggle.addEventListener('change',() => {
      recorder.enabled = toggle.checked;
      try { localStorage.setItem(SETTING,recorder.enabled ? 'on' : 'off'); } catch (_) {}
      if (!recorder.enabled) recorder.cancel();
      recorder.message(recorder.enabled ? '高得点の2件を自動更新。声やカメラは録りません' : '自動録画はオフ。前の動画は残っているよ');
    });
    const urls = new Set(); let viewToken = 0;
    function releaseVideos() { list.querySelectorAll('video').forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); }); urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); }
    function element(tag,text,className) { const node = doc.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
    async function refresh() {
      const token = ++viewToken; releaseVideos(); list.replaceChildren(element('p','動画を読み込んでいます…'));
      try {
        const {clips} = await recorder.store.read(); if (token !== viewToken || !dialog.open) return;
        list.replaceChildren();
        if (!clips.length) list.append(element('p','まだ動画がありません。最後まで弾くと、高得点の2件をここに残すよ。','music-video-empty'));
        clips.forEach((clip,index) => {
          const card = element('article',null,'music-video-card'), heading = element('h3',`${index+1}位　${clip.title}　${clip.points}点`);
          const meta = element('p',`${TONES[clip.instrument] || 'ピアノ'} · ${clip.speed === .5 ? 'ゆっくり' : clip.speed === .75 ? 'すこしゆっくり' : 'ふつう'} · ${clip.edition === 'original' ? '原曲版' : 'タブレット版'} · ${new Date(clip.createdAt).toLocaleString('ja-JP')}`,'music-video-meta');
          const url = URL.createObjectURL(clip.blob); urls.add(url);
          const video = element('video'); video.controls = true; video.playsInline = true; video.preload = 'metadata'; video.src = url; video.setAttribute('aria-label',`${clip.title} ${clip.points}点の演奏動画`);
          const notice = element('p','','music-video-notice'); notice.setAttribute('role','status');
          video.addEventListener('play',() => list.querySelectorAll('video').forEach(v => { if (v !== video) v.pause(); }));
          video.addEventListener('error',() => { notice.textContent = 'この端末では再生できません。動画を保存して対応するプレーヤーで開いてね'; });
          const actions = element('div',null,'music-video-actions'), save = element('a','↓ 動画を保存','small-button');
          save.href = url; save.download = `演奏-${clip.title.replace(/[\\/:*?"<>|]/g,'')}-${clip.points}点-${new Date(clip.createdAt).toISOString().replace(/[:.]/g,'-')}.${clip.blob.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
          save.addEventListener('click',() => { notice.textContent = '端末のダウンロード先を確認してね。保存した動画は自動更新で消えません'; });
          const remove = element('button','削除','small-button'); remove.type = 'button';
          const confirm = element('div',null,'music-video-confirm'); confirm.hidden = true;
          const yes = element('button','この動画を削除','danger-button'), no = element('button','やめる','small-button'); yes.type = no.type = 'button';
          confirm.append(element('p','この端末のベスト動画から削除しますか？'),yes,no);
          remove.addEventListener('click',() => { confirm.hidden = false; }); no.addEventListener('click',() => { confirm.hidden = true; });
          yes.addEventListener('click',async () => { yes.disabled = true; try { await recorder.clear(clip.id); await refresh(); } catch (_) { notice.textContent = '削除できませんでした。もう一度ためしてね'; yes.disabled = false; } });
          actions.append(save,remove); card.append(heading,meta,video,actions,notice,confirm); list.append(card);
        });
      } catch (_) { if (token === viewToken) list.replaceChildren(element('p','動画を読み込めません。端末の保存設定を確認してね')); }
    }
    doc.getElementById('music-videos-open').addEventListener('click',() => { options.beforeView(); dialog.showModal(); refresh(); });
    dialog.addEventListener('close',() => { viewToken++; releaseVideos(); list.replaceChildren(); });
    doc.addEventListener('visibilitychange',() => { if (doc.hidden) { recorder.cancel(); list.querySelectorAll('video').forEach(v => v.pause()); } });
    return recorder;
  }
  return {DB_NAME,MAX_BYTES,MAX_MS,MIME_TYPES,validClip,rank,pickMime,withWebmDuration,VideoStore,VideoRecorder,drawFrame,mount};
}));
