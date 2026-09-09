/* 写真立てv1（設計書 写真立てv1）。子どもが撮った写真を、同じ公開URLのIndexedDBだけに保存する（声の記憶と同じ考え方）。
   写真の中身は判定・解析しない（顔検出・タグ付け・分類なし・外部送信なし）。
   保存するのは { id, dataUrl, createdAt } の3つだけ。ほかの情報（場所・分類など）は足さない。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionPhotoFrame = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DB_NAME = 'little-companion-photos-v1';
  const DB_VERSION = 1;
  const STORE_NAME = 'photos';
  const MAX_PHOTOS = 6;  /* 6枚まで。自動で消さない（子どもの写真を勝手に捨てない） */
  const MAX_EDGE = 640;  /* 長辺640px・JPEGへ圧縮してから保存する */
  const JPEG_QUALITY = 0.82;
  const LIMIT_HINT = 'はがしてから、もう1まい とれるよ';
  const CAMERA_HINT = 'カメラは使えないよ';

  /* 撮影・保存の両方で長辺640を守るための計算（純粋関数） */
  const scaleSize = (width, height, maxEdge = MAX_EDGE) => {
    const limit = Math.max(1, Math.round(Number(maxEdge) || MAX_EDGE));
    const w = Math.max(1, Math.round(Number(width) || 0));
    const h = Math.max(1, Math.round(Number(height) || 0));
    if (w <= limit && h <= limit) return { width:w, height:h };
    return w >= h
      ? { width:limit, height:Math.max(1, Math.round(h * limit / w)) }
      : { width:Math.max(1, Math.round(w * limit / h)), height:limit };
  };

  /* 保存を受け付けるのは自分のcanvasが吐いたJPEGだけ（data:image/jpeg;base64,） */
  const isJpegDataUrl = value => typeof value === 'string'
    && value.length <= 512 * 1024
    && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value);

  function PhotoFrame(options = {}) {
    this.indexedDB = options.indexedDB !== undefined ? options.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null);
    this.mediaDevices = options.mediaDevices !== undefined ? options.mediaDevices : (typeof navigator !== 'undefined' && navigator.mediaDevices ? navigator.mediaDevices : null);
    this.document = options.document || (typeof document !== 'undefined' ? document : null);
    this.now = options.now || (() => Date.now());
    this.idFactory = options.idFactory || (now => `photo-${now}-${Math.random().toString(36).slice(2, 8)}`);
    this.quality = typeof options.quality === 'number' && options.quality > 0 && options.quality <= 1 ? options.quality : JPEG_QUALITY;
    this.stream = null;
    this.dbPromise = null;
  }

  PhotoFrame.prototype._open = function () {
    if (this.dbPromise) return this.dbPromise;
    if (!this.indexedDB || typeof this.indexedDB.open !== 'function') return Promise.reject(new Error('unavailable'));
    this.dbPromise = new Promise((resolve, reject) => {
      let request;
      try { request = this.indexedDB.open(DB_NAME, DB_VERSION); } catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db && !db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath:'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('open-failed'));
      request.onblocked = () => reject(new Error('open-blocked'));
    });
    return this.dbPromise;
  };

  PhotoFrame.prototype._run = async function (mode, action) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(STORE_NAME, mode); } catch (error) { reject(error); return; }
      let request;
      try { request = action(tx.objectStore(STORE_NAME)); } catch (error) { reject(error); return; }
      const done = request
        ? new Promise((res, rej) => { request.onsuccess = () => res(request.result); request.onerror = () => rej(request.error || new Error('store-failed')); })
        : Promise.resolve();
      tx.oncomplete = () => done.then(resolve, reject);
      tx.onabort = () => reject(tx.error || new Error('transaction-aborted'));
      tx.onerror = () => reject(tx.error || new Error('transaction-failed'));
    });
  };

  PhotoFrame.prototype.list = async function () {
    try {
      const rows = await this._run('readonly', store => store.getAll());
      return (Array.isArray(rows) ? rows : [])
        .filter(row => row && typeof row.id === 'string' && typeof row.dataUrl === 'string')
        .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
    } catch (_) { return []; }
  };

  PhotoFrame.prototype.get = async function (id) {
    if (typeof id !== 'string' || !id) return undefined;
    try { const row = await this._run('readonly', store => store.get(id)); return row && typeof row.dataUrl === 'string' ? row : undefined; }
    catch (_) { return undefined; }
  };

  PhotoFrame.prototype.count = async function () {
    return (await this.list()).length;
  };

  PhotoFrame.prototype.save = async function (dataUrl) {
    if (!isJpegDataUrl(dataUrl)) return { ok:false, reason:'invalid-photo' };
    try {
      const rows = await this._run('readonly', store => store.getAll());
      if ((Array.isArray(rows) ? rows.length : 0) >= MAX_PHOTOS) return { ok:false, reason:'limit' };
      /* 保存物はこの3つのキーだけ（合格条件6）。写真の中身・場所・分類などのキーは作らない */
      const photo = { id:this.idFactory(this.now()), dataUrl:String(dataUrl), createdAt:this.now() };
      await this._run('readwrite', store => store.put(photo));
      return { ok:true, photo };
    } catch (_) { return { ok:false, reason:'save-failed' }; }
  };

  PhotoFrame.prototype.remove = async function (id) {
    if (typeof id !== 'string' || !id) return { ok:false, reason:'invalid-id' };
    try { await this._run('readwrite', store => store.delete(id)); return { ok:true }; }
    catch (_) { return { ok:false, reason:'delete-failed' }; }
  };

  PhotoFrame.prototype.clearAll = async function () {
    try { await this._run('readwrite', store => store.clear()); return { ok:true }; }
    catch (_) { return { ok:false, reason:'clear-failed' }; }
  };

  /* カメラは撮る瞬間だけ。停止したら映像は保持しない（既存の約束） */
  PhotoFrame.prototype.startCamera = async function (video) {
    if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== 'function') return { ok:false, reason:'unavailable' };
    this.stopCamera();
    let stream;
    try { stream = await this.mediaDevices.getUserMedia({ video:{ facingMode:'user' }, audio:false }); }
    catch (_) { this.stream = null; return { ok:false, reason:'denied' }; }
    this.stream = stream;
    if (video) { try { video.srcObject = stream; } catch (_) {} }
    return { ok:true };
  };

  PhotoFrame.prototype.stopCamera = function () {
    if (this.stream && typeof this.stream.getTracks === 'function') {
      this.stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
    }
    this.stream = null;
  };

  /* その1枚だけを撮る（自動で連写しない）。長辺640・JPEGに圧縮して dataUrl で返す */
  PhotoFrame.prototype.capture = function (video) {
    const width = video && video.videoWidth;
    const height = video && video.videoHeight;
    if (!width || !height || !this.document) return { ok:false, reason:'capture-failed' };
    const size = scaleSize(width, height, MAX_EDGE);
    let canvas;
    try { canvas = this.document.createElement('canvas'); } catch (_) { return { ok:false, reason:'capture-failed' }; }
    canvas.width = size.width;
    canvas.height = size.height;
    let context;
    try { context = canvas.getContext('2d'); } catch (_) { return { ok:false, reason:'capture-failed' }; }
    if (!context) return { ok:false, reason:'capture-failed' };
    try { context.drawImage(video, 0, 0, size.width, size.height); } catch (_) { return { ok:false, reason:'capture-failed' }; }
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', this.quality);
      if (!isJpegDataUrl(dataUrl)) return { ok:false, reason:'capture-failed' };
      return { ok:true, dataUrl };
    } catch (_) { return { ok:false, reason:'capture-failed' }; }
  };

  return { DB_NAME, DB_VERSION, STORE_NAME, MAX_PHOTOS, MAX_EDGE, JPEG_QUALITY, LIMIT_HINT, CAMERA_HINT, scaleSize, PhotoFrame };
}));
