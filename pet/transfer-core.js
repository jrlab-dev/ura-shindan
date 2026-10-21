(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./voice-memory.js'), require('./radio-recorder.js'));
  else root.PokoFuwaTransfer = factory(root.LittleCompanionVoiceMemory, root.LittleCompanionRadioRecorder);
}(typeof self !== 'undefined' ? self : this, function(Voice, Radio) {
  'use strict';
  const STATE = 'little-companion-v1';
  const PENDING = 'little-companion-transfer-pending';
  const MAX_FILE = 64 * 1024 * 1024;
  const SCHEMA = [
    {name:'little-companion-voice-v1', version:3, stores:{clips:['profileId','wordId'], meta:'key'}},
    {name:'little-companion-photos-v1', version:1, stores:{photos:'id'}},
    {name:'little-companion-radio-v1', version:1, stores:{clip:'id'}}
  ];
  const RECOVERY = {name:'little-companion-transfer-v1', version:1, stores:{recovery:'id'}};
  function insist(value, reason = 'invalid-file') { if (!value) throw new Error(reason); }
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  async function digest(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
  }
  function open(spec, idb = indexedDB) {
    return new Promise((resolve, reject) => {
      const request = idb.open(spec.name, spec.version);
      let failed = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const [name, keyPath] of Object.entries(spec.stores)) {
          const store = db.objectStoreNames.contains(name) ? request.transaction.objectStore(name) : db.createObjectStore(name, {keyPath});
          if (JSON.stringify(store.keyPath) !== JSON.stringify(keyPath)) { request.transaction.abort(); return; }
          if (name === 'clips' && !store.indexNames.contains('profileId')) store.createIndex('profileId', 'profileId', {unique:false});
        }
      };
      request.onsuccess = () => { if (failed) { request.result.close(); return; } resolve(request.result); };
      request.onerror = () => reject(request.error || new Error('storage-failed'));
      request.onblocked = () => { failed = true; reject(new Error('close-other-tabs')); };
    });
  }
  async function readDB(spec, idb) {
    const db = await open(spec, idb);
    try {
      return await new Promise((resolve, reject) => {
        const names = Object.keys(spec.stores), result = {};
        const tx = db.transaction(names, 'readonly');
        for (const name of names) { const req = tx.objectStore(name).getAll(); req.onsuccess = () => { result[name] = req.result; }; }
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('storage-failed'));
      });
    } finally { db.close(); }
  }
  async function writeDB(spec, values, idb) {
    const db = await open(spec, idb);
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(Object.keys(spec.stores), 'readwrite');
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('storage-failed'));
        try { for (const name of Object.keys(spec.stores)) { const store = tx.objectStore(name); store.clear(); for (const row of values[name]) store.put(row); } }
        catch (error) { tx.abort(); reject(error); }
      });
    } finally { db.close(); }
  }
  async function snapshot(env = {}) {
    const storage = env.storage || localStorage, databases = [];
    for (const spec of SCHEMA) databases.push(await readDB(spec, env.idb));
    return {state:storage.getItem(STATE), databases};
  }
  async function encode(snapshot) {
    const result = {state:snapshot.state, databases:[]};
    for (const database of snapshot.databases) {
      const stores = {};
      for (const [name, rows] of Object.entries(database)) {
        stores[name] = [];
        for (const row of rows) {
          const copy = {...row};
          if (row.blob instanceof Blob) {
            const bytes = new Uint8Array(await row.blob.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            copy.blob = {type:row.blob.type, data:btoa(binary)};
          }
          stores[name].push(copy);
        }
      }
      result.databases.push(stores);
    }
    return result;
  }
  function decode(payload) {
    insist(object(payload) && (payload.state === null || typeof payload.state === 'string'));
    if (payload.state !== null) {
      insist(payload.state.length <= 2 * 1024 * 1024);
      const state = JSON.parse(payload.state);
      insist(object(state) && Number.isInteger(state.version) && state.version >= 1);
      insist(state.version <= 14, 'newer-version');
      insist(typeof state.petName === 'string');
    }
    insist(Array.isArray(payload.databases) && payload.databases.length === SCHEMA.length);
    const databases = payload.databases.map((stores, i) => {
      const spec = SCHEMA[i];
      insist(object(stores) && Object.keys(stores).sort().join() === Object.keys(spec.stores).sort().join());
      const decoded = {};
      for (const [name, keyPath] of Object.entries(spec.stores)) {
        const rows = stores[name];
        insist(Array.isArray(rows) && rows.length <= (name === 'clips' ? 100 : name === 'photos' ? 6 : 1));
        const keys = new Set(), perProfile = new Map();
        decoded[name] = rows.map(row => {
          insist(object(row));
          const key = (Array.isArray(keyPath) ? keyPath : [keyPath]).map(k => row[k]);
          insist(key.every(k => typeof k === 'string' && k.length > 0 && k.length <= 200));
          insist(!keys.has(JSON.stringify(key))); keys.add(JSON.stringify(key));
          const copy = {...row};
          if (name === 'clips' || name === 'clip') {
            insist(object(row.blob) && typeof row.blob.data === 'string' && typeof row.blob.type === 'string');
            insist(row.blob.data.length <= (name === 'clips' ? 256 * 1024 : 3072 * 1024) * 1.34 + 8);
            insist(/^[A-Za-z0-9+/]*={0,2}$/.test(row.blob.data) && row.blob.data.length % 4 === 0);
            const binary = atob(row.blob.data);
            copy.blob = new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], {type:row.blob.type});
            insist(row.bytes === copy.blob.size && copy.blob.type === row.mimeType);
            if (name === 'clips') {
              insist(Voice.validateClip(copy).ok);
              const count = (perProfile.get(row.profileId) || 0) + 1; insist(count <= 20); perProfile.set(row.profileId, count);
            } else insist(row.id === 'radio' && Radio.radioVerdict(copy).ok);
          } else if (name === 'photos') {
            insist(typeof row.dataUrl === 'string' && row.dataUrl.length <= 512 * 1024 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(row.dataUrl));
            insist(Number.isFinite(row.createdAt));
          } else insist(row.key === 'generation' && Number.isSafeInteger(row.value) && row.value >= 0);
          return copy;
        });
      }
      return decoded;
    });
    return {state:payload.state, databases};
  }
  async function makeFile(data) {
    const payload = await encode(data);
    decode(payload);
    const content = JSON.stringify({format:'pokofuwa-transfer', version:1, createdAt:new Date().toISOString(), payload, sha256:await digest(JSON.stringify(payload))});
    insist(new Blob([content]).size <= MAX_FILE, 'too-large');
    return content;
  }
  async function parseFile(text) {
    insist(typeof text === 'string' && new Blob([text]).size <= MAX_FILE, 'too-large');
    let file;
    try { file = JSON.parse(text); } catch (_) { throw new Error('invalid-file'); }
    insist(file && typeof file === 'object' && file.payload && typeof file.payload === 'object');
    insist(file.format === 'pokofuwa-transfer' && file.version === 1 && typeof file.createdAt === 'string' && Number.isFinite(Date.parse(file.createdAt)));
    insist(file.sha256 === await digest(JSON.stringify(file.payload)), 'damaged-file');
    return {data:decode(file.payload), createdAt:file.createdAt};
  }
  async function fingerprint(data) { return digest(JSON.stringify(await encode(data))); }
  function summary(data) {
    const state = data.state ? JSON.parse(data.state) : null;
    return {petName:state && state.petName || '', hasState:!!state, voices:data.databases[0].clips.length, photos:data.databases[1].photos.length, radio:data.databases[2].clip.length};
  }
  const hasData = data => { const s = summary(data); return s.hasState || s.voices > 0 || s.photos > 0 || s.radio > 0; };
  async function apply(data, env) {
    for (let i = 0; i < SCHEMA.length; i++) { if (env.beforeWrite) await env.beforeWrite(i); await writeDB(SCHEMA[i], data.databases[i], env.idb); }
    const storage = env.storage || localStorage;
    if (data.state === null) storage.removeItem(STATE); else storage.setItem(STATE, data.state);
    insist(await fingerprint(await snapshot(env)) === await fingerprint(data), 'verify-failed');
  }
  async function recover(env = {}) {
    const storage = env.storage || localStorage;
    if (!storage.getItem(PENDING)) return false;
    const stored = await readDB(RECOVERY, env.idb), entry = stored.recovery.find(row => row.id === 'before');
    insist(entry && entry.data, 'recovery-missing');
    await apply(entry.data, {...env, beforeWrite:null});
    storage.removeItem(PENDING);
    try { await writeDB(RECOVERY, {recovery:[]}, env.idb); } catch (_) {}
    return true;
  }
  async function restore(data, env = {}) {
    const storage = env.storage || localStorage;
    insist(!storage.getItem(PENDING), 'recovery-required');
    decode(await encode(data));
    const previous = await snapshot(env);
    if (env.expectedFingerprint) insist(await fingerprint(previous) === env.expectedFingerprint, 'data-changed');
    await writeDB(RECOVERY, {recovery:[{id:'before', data:previous}]}, env.idb);
    storage.setItem(PENDING, '1');
    try { await apply(data, env); }
    catch (error) {
      try { await recover(env); } catch (_) { throw new Error('recovery-required'); }
      throw error;
    }
    storage.removeItem(PENDING);
    // Import has already been verified; a cleanup failure must not undo success.
    try { await writeDB(RECOVERY, {recovery:[]}, env.idb); } catch (_) {}
    return summary(data);
  }
  async function exclusive(operation) {
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('pokofuwa-transfer', {ifAvailable:true}, lock => { insist(lock, 'close-other-tabs'); return operation(); });
    return operation();
  }
  return {STATE, PENDING, MAX_FILE, SCHEMA, RECOVERY, snapshot, makeFile, parseFile, encode, decode, digest, summary, hasData, fingerprint, restore, recover, exclusive};
}));
