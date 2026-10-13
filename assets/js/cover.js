/* ============================================================
   cover.js — 封面引擎
   1) 程序化生成：波形 + 渐变配色（录音后自动配图）
   2) 提取内嵌封面：M4A(moov/udta/meta/ilst/covr) / MP3(ID3 APIC)
   3) 用户手动选图并自动裁剪为方形
   ============================================================ */
const Cover = (() => {

  const PALETTES = [
    ['#7c5cff', '#23d5c0'],
    ['#ff5f9e', '#ffb648'],
    ['#23d5c0', '#4f7cff'],
    ['#ff7a45', '#ff5f9e'],
    ['#8b5cf6', '#f0abfc'],
    ['#06b6d4', '#818cf8'],
    ['#f43f5e', '#7c5cff'],
    ['#10b981', '#84cc16']
  ];

  function hashCode(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  /** 从波形数组生成 PNG Blob。无波形时用标题哈希生成抽象封面。 */
  async function generate(peaks, seedStr, title, artist) {
    const S = 900;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    const h = hashCode(seedStr || title || 'aurora');
    const pal = PALETTES[h % PALETTES.length];

    // 背景渐变
    const ang = (h % 360) * Math.PI / 180;
    const cx = S / 2 + Math.cos(ang) * S * 0.42;
    const cy = S / 2 + Math.sin(ang) * S * 0.42;
    const grd = g.createLinearGradient(0, 0, cx, cy);
    grd.addColorStop(0, pal[0]);
    grd.addColorStop(1, pal[1]);
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);

    // 深色叠加，压暗便于白字可读
    g.fillStyle = 'rgba(10,8,24,0.42)';
    g.fillRect(0, 0, S, S);

    // 光斑
    const blob = g.createRadialGradient(S * 0.26, S * 0.22, 10, S * 0.26, S * 0.22, S * 0.72);
    blob.addColorStop(0, 'rgba(255,255,255,0.30)');
    blob.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = blob;
    g.fillRect(0, 0, S, S);

    // 居中圆形波形（录音的标志性视觉）
    const R = S * 0.27;
    const ccx = S / 2, ccy = S * 0.44;
    const N = peaks && peaks.length ? peaks.length : 128;
    const step = peaks && peaks.length ? (Math.PI * 2) / peaks.length : (Math.PI * 2) / N;

    g.lineCap = 'round';
    for (let i = 0; i < N; i++) {
      let v = peaks && peaks.length ? peaks[i] : 0.32 + 0.28 * Math.abs(Math.sin(i * 0.37 + h));
      v = Math.max(0.06, Math.min(1, v));
      const a = i * step - Math.PI / 2;
      const r0 = R, r1 = R + v * S * 0.17;
      g.beginPath();
      g.moveTo(ccx + Math.cos(a) * r0, ccy + Math.sin(a) * r0);
      g.lineTo(ccx + Math.cos(a) * r1, ccy + Math.sin(a) * r1);
      g.lineWidth = 3.4;
      const lg = g.createLinearGradient(ccx - R, ccy - R, ccx + R, ccy + R);
      lg.addColorStop(0, 'rgba(255,255,255,0.95)');
      lg.addColorStop(1, 'rgba(255,255,255,0.55)');
      g.strokeStyle = lg;
      g.stroke();
    }

    // 中心孔
    g.beginPath();
    g.arc(ccx, ccy, R * 0.22, 0, Math.PI * 2);
    g.fillStyle = 'rgba(10,8,24,0.55)';
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.stroke();

    // 标题文本
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 14;

    const name = (title || '未命名录音').slice(0, 16);
    g.font = '700 58px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText(fitText(g, name, S * 0.84), S / 2, S * 0.855, S * 0.84);

    g.shadowBlur = 8;
    g.font = '500 30px -apple-system, "PingFang SC", sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.72)';
    g.fillText(fitText(g, (artist || '我的录音').slice(0, 24), S * 0.76), S / 2, S * 0.915, S * 0.76);

    // 录音标识
    g.shadowBlur = 0;
    g.font = '800 20px -apple-system, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.textAlign = 'left';
    g.fillText('● REC', 54, 74);

    return await toBlob(cv);
  }

  function fitText(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  function toBlob(canvas) {
    return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
  }

  /* ---------- 内嵌封面提取 ---------- */

  /** M4A / MP4: 找 moov > udta > meta > ilst > covr */
  async function extractM4A(file) {
    const buf = await file.arrayBuffer();
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);

    function findBox(start, end, name) {
      let p = start;
      while (p + 8 <= end) {
        let size = dv.getUint32(p);
        const type = str(bytes, p + 4, 4);
        let head = 8;
        if (size === 1) {
          if (p + 16 > end) return null;
          size = Number(dv.getBigUint64(p + 8));
          head = 16;
        } else if (size === 0) {
          size = end - p;
        }
        if (size < head) return null;
        if (type === name) return { start: p + head, end: Math.min(p + size, end) };
        p += size;
      }
      return null;
    }
    function findList(start, end, name) {
      // meta 是 full box(有 4 字节 version/flags)
      let p = start;
      while (p + 8 <= end) {
        let size = dv.getUint32(p);
        const type = str(bytes, p + 4, 4);
        let head = 8;
        if (size === 1) { size = Number(dv.getBigUint64(p + 8)); head = 16; }
        else if (size === 0) size = end - p;
        if (size < head) return null;
        if (type === name) return { start: p + head, end: Math.min(p + size, end) };
        p += size;
      }
      return null;
    }

    const moov = findBox(0, bytes.length, 'moov');
    if (!moov) return null;
    const udta = findBox(moov.start, moov.end, 'udta');
    if (!udta) return null;
    const meta = findList(udta.start + 4, udta.end, 'meta');
    if (!meta) return null;
    const ilst = findList(meta.start, meta.end, 'ilst');
    if (!ilst) return null;
    const covr = findBox(ilst.start, ilst.end, 'covr');
    if (!covr) return null;

    // data box: type(4) locale(4) payload
    let p = covr.start;
    if (p + 8 > covr.end) return null;
    let dsize = dv.getUint32(p);
    if (dsize === 1) dsize = Number(dv.getBigUint64(p + 8));
    const dtype = str(bytes, p + 4, 4);
    if (dtype !== 'data') return null;
    const dstart = p + 16;
    return new Blob([bytes.slice(dstart, dstart + dsize)], { type: 'image/jpeg' });
  }

  /** MP3: ID3v2 APIC */
  async function extractMP3(file) {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (str(head, 0, 3) !== 'ID3') return null;
    const ver = head[3];
    const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    if (size <= 0 || size > 8 * 1024 * 1024) return null;

    const buf = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
    const dv = new DataView(buf.buffer);
    let p = 0;
    while (p + 10 <= buf.length) {
      const id = str(buf, p, 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      let fsize;
      if (ver === 4) {
        fsize = ((buf[p + 4] & 0x7f) << 21) | ((buf[p + 5] & 0x7f) << 14) | ((buf[p + 6] & 0x7f) << 7) | (buf[p + 7] & 0x7f);
      } else {
        fsize = dv.getUint32(p + 4);
      }
      if (fsize <= 0 || p + 10 + fsize > buf.length) break;
      if (id === 'APIC') {
        let q = p + 10;
        const enc = buf[q++];
        q++; // mime
        while (q < buf.length && buf[q] !== 0) q++; // mime string
        q++;
        if (enc === 1 || enc === 2) q++; // 描述(仅编码1/2有终止符，简化处理)
        else { /* enc 0/3: 描述是 null 终止 */ }
        while (q < buf.length && buf[q] !== 0) q++;
        q++;
        return new Blob([buf.slice(q, p + 10 + fsize)], { type: 'image/jpeg' });
      }
      p += 10 + fsize;
    }
    return null;
  }

  function str(u8, p, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(u8[p + i]);
    return s;
  }

  /** 统一入口：尝试提取，失败返回 null */
  async function extract(file) {
    const name = (file.name || '').toLowerCase();
    try {
      if (/\.(m4a|mp4|aac|m4b)$/.test(name) || file.type.includes('mp4')) {
        const b = await extractM4A(file);
        if (b) return b;
      }
      if (/\.mp3$/.test(name) || file.type.includes('mpeg')) {
        const b = await extractMP3(file);
        if (b) return b;
      }
    } catch (e) { console.warn('封面提取失败', e); }
    return null;
  }

  /** 用户选图 → 居中裁剪为正方形 */
  async function fromImageFile(file, size = 900) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i); i.onerror = rej; i.src = url;
      });
      const cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      const g = cv.getContext('2d');
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      g.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      return await toBlob(cv);
    } finally { URL.revokeObjectURL(url); }
  }

  return { generate, extract, fromImageFile };
})();