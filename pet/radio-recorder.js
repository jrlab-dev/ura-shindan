/* ラジカセくん録音v1（設計書 ラジカセくん録音v1）。子どもの声の録音を1つだけ、同じ公開URLのIndexedDBだけに保存する
   （写真立て・声の記憶と同じ考え方。外部送信なし・録音の中身は判定しない）。
   マイクの録音・加工再生は voice-memory.js の recordRadio／playRadioClip が担う（マイクの持ち主を1つに保つため）。
   ここが持つのは「1本だけの保存」と、保存してよい録音かの純粋な判定。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionRadioRecorder = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DB_NAME = 'little-companion-radio-v1';
  const DB_VERSION = 1;
  const STORE_NAME = 'clip';
  const CLIP_ID = 'radio';            /* 1つだけ。録り直したらこの1行を入れ替える */
  const MAX_DURATION_MS = 30000;      /* 30秒で自動的に止まる（voice-memory.js のRADIO_*と同じ値） */
  const DURATION_TOLERANCE_MS = 800;  /* 自動停止タイマーのぶれぶん */
  const MIN_KEEP_MS = 1000;           /* 1秒未満で止めた録音は残さない（前の録音を残す） */
  const MAX_BYTES = 3072 * 1024;
  const MIC_HINT = 'マイクが つかえないみたい';
  const KEYS = ['blob', 'bytes', 'durationMs', 'id', 'mimeType', 'recordedAt'];

  const supportedMime = mime => /^audio\/(?:webm|ogg|mp4|mpeg)(?:;|$)/i.test(String(mime || ''));
  const isBlob = value => typeof Blob !== 'undefined' && value instanceof Blob;

  /* 純粋な判定：この録音で前の録音を入れ替えてよいか（上書き判定）。保存もこの判定を通す */
  const radioVerdict = ({ durationMs, bytes, mimeType } = {}) => {
    const duration = Number(durationMs) || 0;
    const size = Number(bytes) || 0;
    if (!supportedMime(mimeType)) return { ok:false, reason:'unsupported-mime' };
    if (size <= 0 || size > MAX_BYTES) return { ok:false, reason:'invalid-size' };
    if (duration < MIN_KEEP_MS) return { ok:false, reason:'too-short' };
    if (duration > MAX_DURATION_MS + DURATION_TOLERANCE_MS) return { ok:false, reason:'too-long' };
    return { ok:true };
  };

  /* 録音中の残り秒数の表示（例「のこり 25」）。始めた直後は30、30秒で0 */
  const remainingSeconds = elapsedMs => Math.max(0, Math.ceil((MAX_DURATION_MS - Math.max(0, Number(elapsedMs) || 0)) / 1000));

  function RadioRecorder(options = {}) {
    this.indexedDB = options.indexedDB !== undefined ? options.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null);
    this.now = options.now || (() => Date.now());
    this.dbPromise = null;
    this.pendingSave = null;
  }

  RadioRecorder.prototype._open = function () {
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

  RadioRecorder.prototype._run = async function (mode, action, onTransaction) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      let tx;
      let request = null;
      let settled = false;
      const fail = error => { if (settled) return; settled = true; reject(error); };
      const complete = () => { if (settled) return; settled = true; resolve(request ? request.result : undefined); };
      try { tx = db.transaction(STORE_NAME, mode); } catch (error) { reject(error); return; }
      if (typeof onTransaction === 'function') { try { onTransaction(tx); } catch (_) {} }
      tx.oncomplete = complete;
      tx.onabort = () => fail(tx.error || new Error('transaction-aborted'));
      tx.onerror = () => fail(tx.error || new Error('transaction-failed'));
      try { request = action(tx.objectStore(STORE_NAME)); } catch (error) { fail(error); return; }
      /* request.onerrorだけで先にrejectせず、transactionの完了を待つ。abort時は
         request.onerrorとtx.onabortの両方が来ても、外側のPromiseを1度だけrejectする。 */
      if (request) request.onerror = () => fail(request.error || new Error('store-failed'));
    });
  };

  /* 壊れた保存（昔の録音が長すぎた・形式が変わった）は「無い」として扱う。例外も「無い」に丸める */
  RadioRecorder.prototype.load = async function () {
    try {
      const row = await this._run('readonly', store => store.get(CLIP_ID));
      if (!row || row.id !== CLIP_ID || !isBlob(row.blob)) return null;
      const clip = { id:CLIP_ID, blob:row.blob, mimeType:String(row.mimeType || row.blob.type || ''), durationMs:Number(row.durationMs) || 0, bytes:row.blob.size, recordedAt:String(row.recordedAt || '') };
      return radioVerdict(clip).ok ? clip : null;
    } catch (_) { return null; }
  };

  /* 1本だけの保存（上書き）。保存してよいかは radioVerdict で決める */
  RadioRecorder.prototype.save = async function ({ blob, mimeType, durationMs, bytes } = {}) {
    if (!isBlob(blob)) return { ok:false, reason:'invalid-blob' };
    const clip = { id:CLIP_ID, blob, mimeType:String(mimeType || blob.type || ''), durationMs:Math.round(Number(durationMs) || 0), bytes:blob.size, recordedAt:new Date(this.now()).toISOString() };
    const verdict = radioVerdict(clip);
    if (!verdict.ok) return { ok:false, reason:verdict.reason };
    const pending = { tx:null, cancelled:false };
    this.pendingSave = pending;
    try {
      await this._run('readwrite', store => { if (pending.cancelled) throw new Error('save-cancelled'); return store.put(clip); }, tx => { pending.tx = tx; });
      if (pending.cancelled) return { ok:false, reason:'save-cancelled' };
      return { ok:true, clip };
    } catch (_) { return { ok:false, reason:pending.cancelled ? 'save-cancelled' : 'save-failed' }; }
    finally { if (this.pendingSave === pending) this.pendingSave = null; }
  };

  RadioRecorder.prototype.cancelPendingSave = function () {
    const pending = this.pendingSave;
    if (!pending) return false;
    pending.cancelled = true;
    try { if (pending.tx && typeof pending.tx.abort === 'function') pending.tx.abort(); } catch (_) {}
    return true;
  };

  RadioRecorder.prototype.clear = async function () {
    try { await this._run('readwrite', store => store.delete(CLIP_ID)); return { ok:true }; }
    catch (_) { return { ok:false, reason:'delete-failed' }; }
  };

  return { DB_NAME, DB_VERSION, STORE_NAME, CLIP_ID, MAX_DURATION_MS, MIN_KEEP_MS, MAX_BYTES, MIC_HINT, KEYS, radioVerdict, remainingSeconds, RadioRecorder };
}));
