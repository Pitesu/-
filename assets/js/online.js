/* ============================================================
   online.js — 在线自由音源检索与下载
   仅接入公有领域 / CC 自由许可音频库，并展示许可与作者
   源 1: Wikimedia Commons（API 开放 CORS）
   源 2: Internet Archive（advancedsearch + metadata）
   两者都不可用时优雅降级，提示使用本地导入 / 录音
   ============================================================ */
const Online = (() => {

  // 命中即拒绝：非商业/禁改/保留权利/版权声明等限制条款
  const LIC_BAD = /non-?commercial|\bnc\b|\bnd\b|fair ?use|all rights reserved|copyright|©|\(c\)/i;
  const SRC = {
    commons: 'Wikimedia Commons',
    archive: 'Internet Archive'
  };

  function withTimeout(promise, ms, tag) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(tag + ' 请求超时')), ms))
    ]);
  }

  /* ---------- 源 1：Wikimedia Commons ---------- */

  async function searchCommons(q, limit = 24) {
    const api = 'https://commons.wikimedia.org/w/api.php';
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrnamespace: '6',            // File
      gsrlimit: String(limit * 2),
      gsrsearch: q ? `${q} filetype:audio` : 'filetype:audio',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata|mediatype',
      iiurlwidth: '480'
    });
    const r = await withTimeout(fetch(`${api}?${params}`), 12000, 'Commons');
    if (!r.ok) throw new Error('Commons HTTP ' + r.status);
    const j = await r.json();
    const pages = (j.query && j.query.pages) ? Object.values(j.query.pages) : [];

    const out = [];
    for (const p of pages) {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii || !ii.mime || !ii.mime.startsWith('audio/')) continue;
      const em = ii.extmetadata || {};
      const licName = str(em.LicenseShortName && em.LicenseShortName.value);
      const licUrl = str(em.LicenseUrl && em.LicenseUrl.value);
      const author = stripHtml(str(em.Artist && em.Artist.value));
      const usage = str(em.UsageTerms && em.UsageTerms.value);

      // 严格过滤：非自由许可一律不提供下载
      const all = (licName + ' ' + usage + ' ' + licUrl);
      if (LIC_BAD.test(all)) continue;
      if (!/public domain|cc0|cc by|cc-by|attribution|公有领域/i.test(all) && licName) {
        // 许可不明也跳过，避免误传有版权内容
        continue;
      }
      if (ii.size && ii.size > 30 * 1024 * 1024) continue; // 过大音频跳过

      out.push({
        id: 'wc-' + p.pageid,
        title: cleanTitle(p.title),
        author: author || '未知作者',
        license: licName || 'Public Domain',
        licenseShort: /public domain|公有领域|pd/i.test(all) ? '公有领域' : 'CC 自由',
        licenseUrl: licUrl,
        source: SRC.commons,
        pageUrl: ii.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title)),
        url: ii.url,
        thumb: ii.thumburl || ii.url,
        mime: ii.mime,
        size: ii.size || 0,
        duration: 0
      });
    }
    return out.slice(0, limit);
  }

  /* ---------- 源 2：Internet Archive ---------- */

  async function searchArchive(q, limit = 24) {
    const query = [
      'mediatype:(audio)',
      q ? `AND (title:(${q}) OR subject:(${q}))` : 'AND collection:(etree)',
      'AND (licenseurl:(*publicdomain*) OR licenseurl:(*creativecommons*))'
    ].join(' ');
    // fl[] 需要重复参数，用手工拼接，避免对象字面量重复键互相覆盖
    const qs = [
      'q=' + encodeURIComponent(query),
      'fl%5B%5D=identifier',
      'fl%5B%5D=title',
      'fl%5B%5D=creator',
      'fl%5B%5D=licenseurl',
      'rows=' + limit,
      'page=1',
      'output=json'
    ].join('&');
    const url = 'https://archive.org/advancedsearch.php?' + qs;
    const r = await withTimeout(fetch(url, { mode: 'cors' }), 12000, 'Archive');
    if (!r.ok) throw new Error('Archive HTTP ' + r.status);
    const j = await r.json();
    const docs = (j.response && j.response.docs) || [];

    const out = [];
    for (const d of docs) {
      const licUrl = d.licenseurl || '';
      const licName = licUrl.includes('publicdomain') ? 'Public Domain' : (licUrl.includes('creativecommons') ? 'CC' : '自由许可');
      out.push({
        id: 'ia-' + d.identifier,
        title: cleanTitle(d.title || d.identifier),
        author: Array.isArray(d.creator) ? d.creator[0] : (d.creator || '未知作者'),
        license: licName,
        licenseShort: licUrl.includes('publicdomain') ? '公有领域' : 'CC 自由',
        licenseUrl: Array.isArray(licUrl) ? licUrl[0] : licUrl,
        source: SRC.archive,
        pageUrl: 'https://archive.org/details/' + d.identifier,
        identifier: d.identifier,
        url: null,          // 延迟解析真实文件
        thumb: null,
        mime: '',
        size: 0,
        duration: 0
      });
    }
    return out.slice(0, limit);
  }

  /** 解析 Archive 条目的可下载音频文件 */
  async function resolveArchive(item) {
    const r = await withTimeout(fetch('https://archive.org/metadata/' + item.identifier), 12000, 'Archive');
    const j = await r.json();
    const files = (j.files || []).filter(f => {
      const n = (f.name || '').toLowerCase();
      if (LIC_BAD.test(f.format || '')) return false;
      return /\.(mp3|ogg|flac|wav|m4a)$/.test(n) &&
             !/_files|_meta|_thumb|\.cue$|_spectrogram/.test(n) &&
             (f.size ? f.size < 30 * 1024 * 1024 : true);
    });
    // 优先 mp3 > ogg > flac > wav
    const rank = { 'VBR MP3': 0, 'MP3': 0, 'Ogg Vorbis': 1, 'FLAC': 2, 'WAV': 3 };
    files.sort((a, b) => (rank[a.format] ?? 9) - (rank[b.format] ?? 9));
    if (!files.length) return null;
    const f = files[0];
    return Object.assign(item, {
      url: 'https://archive.org/download/' + encodeURIComponent(item.identifier) + '/' + encodeURIComponent(f.name),
      mime: /\.(mp3)$/.test(f.name) ? 'audio/mpeg' : /\.(ogg)$/.test(f.name) ? 'audio/ogg' : /\.(flac)$/.test(f.name) ? 'audio/flac' : 'audio/wav',
      size: f.size ? Number(f.size) : 0,
      duration: f.length ? parseFloat(f.length) : 0
    });
  }

  /* ---------- 组合检索（多源降级） ---------- */

  async function search(q, onSource) {
    const sources = [];
    const tasks = [];

    tasks.push(
      searchCommons(q).then(r => { sources.push(...r); onSource && onSource(SRC.commons, r.length); })
        .catch(e => { console.warn('Commons 失败', e.message); onSource && onSource(SRC.commons, 0, e.message); })
    );
    tasks.push(
      searchArchive(q).then(r => { sources.push(...r); onSource && onSource(SRC.archive, r.length); })
        .catch(e => { console.warn('Archive 失败', e.message); onSource && onSource(SRC.archive, 0, e.message); })
    );

    await Promise.all(tasks);
    // 去重
    const seen = new Set();
    return sources.filter(s => {
      const k = s.title.toLowerCase().trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /* ---------- 下载入库 ---------- */

  async function download(item, onProgress) {
    let url = item.url;
    let mime = item.mime;

    if (item.source === SRC.archive && !url) {
      if (onProgress) onProgress('解析文件地址…');
      const r = await resolveArchive(item);
      if (!r) throw new Error('该条目没有可下载的自由音频文件');
      url = r.url; mime = r.mime;
      if (r.duration) item.duration = r.duration;
    }
    if (!url) throw new Error('无下载地址');

    if (onProgress) onProgress('下载中…');
    const res = await withTimeout(fetch(url), 90000, '下载');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!blob.size) throw new Error('下载内容为空');
    if (blob.size > 60 * 1024 * 1024) throw new Error('文件过大（>60MB），已跳过');

    // CORS 受限时给出可操作提示
    if (blob.type === 'text/html') {
      throw new Error('该源不允许浏览器直连下载，请点击条目跳转原始页面手动保存');
    }

    if (onProgress) onProgress('解析时长…');
    let peaks = [];
    try { peaks = await Demo.peaksFromBlob(blob, 96); } catch (_) {}
    const dur = item.duration || await Demo.durationOf(blob);

    // 优先用条目封面，否则程序生成
    let coverBlob = null;
    if (item.thumb && item.thumb.startsWith('http')) {
      try {
        const cr = await withTimeout(fetch(item.thumb), 8000, '封面');
        if (cr.ok) { const b = await cr.blob(); if (b.type.startsWith('image/')) coverBlob = b; }
      } catch (_) {}
    }
    if (!coverBlob) {
      coverBlob = await Cover.generate(peaks, item.id, item.title, item.author);
    }

    if (onProgress) onProgress('写入曲库…');
    const id = 'on-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    await DB.putAudio(id, blob);
    await DB.putCover(id, coverBlob);
    const track = {
      id,
      title: item.title,
      artist: item.author,
      kind: 'online',
      mime: blob.type || mime || 'audio/mpeg',
      ext: (blob.type || mime || '').includes('mpeg') ? 'mp3'
          : (blob.type || mime || '').includes('ogg') ? 'ogg'
          : (blob.type || mime || '').includes('flac') ? 'flac'
          : (blob.type || mime || '').includes('wav') ? 'wav' : 'mp3',
      duration: dur,
      size: blob.size,
      createdAt: Date.now(),
      peaks,
      license: item.license,
      licenseShort: item.licenseShort,
      licenseUrl: item.licenseUrl || '',
      source: item.source,
      pageUrl: item.pageUrl
    };
    await DB.addTrack(track);
    return track;
  }

  /* ---------- 工具 ---------- */

  function str(v) { return typeof v === 'string' ? v : ''; }

  function stripHtml(s) { return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }

  function cleanTitle(t) {
    let s = String(t || '').replace(/^File:\s*/i, '');
    s = s.replace(/\.(mp3|ogg|flac|wav|m4a|opus|oga)$/i, '');
    s = s.replace(/[_]+/g, ' ').trim();
    return s.length > 64 ? s.slice(0, 64) + '…' : (s || '未命名');
  }

  return { search, download, SRC };
})();