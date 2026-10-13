/* ============================================================
   db.js — IndexedDB 数据层
   曲目 / 音频 Blob / 封面 Blob 全部本地存储，不上传任何服务器
   ============================================================ */
const DB = (() => {
  const NAME = 'aurora_music_db';
  const VER = 1;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(NAME, VER);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tracks')) {
          const s = db.createObjectStore('tracks', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
          s.createIndex('kind', 'kind');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs'); // key: trackId
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      };
      req.onsuccess = () => { _db = req.result; res(_db); };
      req.onerror = () => rej(req.error);
    });
  }

  function tx(store, mode) {
    return open().then(db => db.transaction(store, mode).objectStore(store));
  }

  function wrap(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  /* ---------- 曲目 ---------- */

  async function allTracks() {
    const st = await tx('tracks', 'readonly');
    const list = await wrap(st.getAll());
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function addTrack(t) {
    const st = await tx('tracks', 'readwrite');
    await wrap(st.put(t));
    return t;
  }

  async function updateTrack(id, patch) {
    const st = await tx('tracks', 'readwrite');
    const cur = await wrap(st.get(id));
    if (!cur) return null;
    Object.assign(cur, patch);
    await wrap(st.put(cur));
    return cur;
  }

  async function getTrack(id) {
    const st = await tx('tracks', 'readonly');
    return wrap(st.get(id));
  }

  async function removeTrack(id) {
    const t1 = tx('tracks', 'readwrite');
    const t2 = tx('blobs', 'readwrite');
    const [s1, s2] = await Promise.all([t1, t2]);
    await wrap(s1.delete(id));
    await wrap(s2.delete(id));
  }

  /* ---------- 音频 Blob ---------- */

  async function putAudio(id, blob) {
    const st = await tx('blobs', 'readwrite');
    await wrap(st.put(blob, id));
  }

  async function getAudio(id) {
    const st = await tx('blobs', 'readonly');
    return wrap(st.get(id));
  }

  /* ---------- 封面（objectURL 缓存，避免重复创建） ---------- */

  const urlCache = new Map();

  async function getCoverURL(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    const st = await tx('blobs', 'readonly');
    const rec = await wrap(st.get('cover:' + id));
    if (!rec) return null;
    const url = URL.createObjectURL(rec);
    urlCache.set(id, url);
    return url;
  }

  async function putCover(id, blob) {
    const st = await tx('blobs', 'readwrite');
    await wrap(st.put(blob, 'cover:' + id));
    if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); }
    urlCache.set(id, URL.createObjectURL(blob));
    return urlCache.get(id);
  }

  async function dropCoverURL(id) {
    if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
  }

  /* ---------- 通用 meta ---------- */

  async function setMeta(k, v) {
    const st = await tx('meta', 'readwrite');
    return wrap(st.put(v, k));
  }
  async function getMeta(k) {
    const st = await tx('meta', 'readonly');
    return wrap(st.get(k));
  }

  /* ---------- 统计 / 清空 ---------- */

  async function stats() {
    const list = await allTracks();
    return {
      total: list.length,
      rec: list.filter(t => t.kind === 'record').length,
      online: list.filter(t => t.kind === 'online').length,
      local: list.filter(t => t.kind === 'local').length
    };
  }

  async function clearAll() {
    const list = await allTracks();
    for (const t of list) { await removeTrack(t.id); await dropCoverURL(t.id); }
    urlCache.forEach(u => URL.revokeObjectURL(u));
    urlCache.clear();
  }

  /* ---------- 估算占用 ---------- */

  async function usage() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try { return await navigator.storage.estimate(); } catch { return null; }
  }

  return {
    allTracks, addTrack, updateTrack, getTrack, removeTrack,
    putAudio, getAudio, putCover, getCoverURL, dropCoverURL,
    setMeta, getMeta, stats, clearAll, usage
  };
})();