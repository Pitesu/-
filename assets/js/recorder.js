/* ============================================================
   recorder.js — 录音模块
   格式策略：与主流手机录音保持一致
     · iOS Safari / 部分安卓 → audio/mp4 (AAC, .m4a)  ← 手机录音默认格式
     · 桌面 Chrome → audio/webm (Opus)
   录制停止后：写入 IndexedDB → 生成波形封面 → 自动加入曲库
   ============================================================ */
const Recorder = (() => {

  // 按「手机优先」顺序探测
  const CANDIDATES = [
    { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a', name: 'M4A (AAC)' },
    { mime: 'audio/mp4',                    ext: 'm4a', name: 'M4A (AAC)' },
    { mime: 'audio/aac',                    ext: 'aac', name: 'AAC' },
    { mime: 'audio/webm;codecs=opus',       ext: 'webm', name: 'WebM (Opus)' },
    { mime: 'audio/webm',                   ext: 'webm', name: 'WebM' },
    { mime: 'audio/ogg;codecs=opus',        ext: 'ogg',  name: 'OGG (Opus)' },
    { mime: '',                             ext: 'webm', name: '浏览器默认' }
  ];

  function pickFormat() {
    for (const c of CANDIDATES) {
      if (!c.mime) return c;
      try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(c.mime)) return c; } catch (_) {}
    }
    return CANDIDATES[CANDIDATES.length - 1];
  }

  let stream = null, mr = null, chunks = [];
  let recCtx = null, analyser = null, rafId = 0;
  let t0 = 0, acc = 0, paused = false, recording = false;
  let devices = [], devIdx = 0;
  let onTick = () => {}, onLevel = () => {}, onDone = () => {}, onFail = () => {};

  const ev = () => document.getElementById('recWave');
  const waveBars = [];
  function buildWave(n = 40) {
    const el = ev();
    if (!el) return;
    el.innerHTML = '';
    waveBars.length = 0;
    for (let i = 0; i < n; i++) {
      const b = document.createElement('i');
      b.style.height = '3px';
      el.appendChild(b);
      waveBars.push(b);
    }
  }

  /** 初始化：请求默认麦克风权限 + 枚举设备 */
  async function init() {
    buildWave();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onFail('当前环境不支持录音（需 HTTPS 或 localhost）');
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      onFail('麦克风不可用：' + (e.name === 'NotAllowedError' ? '权限被拒绝' : e.message));
      return false;
    }
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (_) {}
    startMeter(stream);
    return true;
  }

  /** 切换输入设备 */
  async function cycleDevice() {
    const mics = devices.filter(d => d.kind === 'audioinput');
    if (mics.length < 2) { onFail('未检测到多个麦克风'); return; }
    devIdx = (devIdx + 1) % mics.length;
    cancelMeter();
    if (stream) stream.getTracks().forEach(t => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: mics[devIdx].deviceId }, echoCancellation: true, noiseSuppression: true }
      });
      startMeter(stream);
      onDone({ deviceSwitched: true, label: mics[devIdx].label || `麦克风 ${devIdx + 1}` });
    } catch (e) { onFail('切换失败：' + e.message); await init(); }
  }

  /* ---------- 电平 / 波形 ---------- */
  function startMeter(s) {
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      recCtx = new AC();
      const src = recCtx.createMediaStreamSource(s);
      analyser = recCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const n = waveBars.length;
        for (let i = 0; i < n; i++) {
          const v = data[Math.floor(i * data.length / n * 0.55)] / 255;
          waveBars[i].style.height = Math.max(3, Math.pow(v, 1.35) * 74) + 'px';
          waveBars[i].style.opacity = 0.35 + v * 0.65;
        }
        onLevel(Math.max(...data) / 255);
        rafId = requestAnimationFrame(loop);
      };
      cancelMeter();
      loop();
    } catch (_) {}
  }
  function cancelMeter() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  /* ---------- 录制控制 ---------- */

  async function start() {
    if (recording) return;
    if (!stream) { if (!await init()) return; }

    const fmt = pickFormat();
    try {
      mr = new MediaRecorder(stream, fmt.mime ? { mimeType: fmt.mime, audioBitsPerSecond: 128000 } : undefined);
    } catch (e) {
      onFail('无法启动录音：' + e.message);
      return;
    }
    chunks = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = finish;
    mr.start(250);
    recording = true; paused = false;
    acc = 0; t0 = performance.now();
    tick();
    onDone({ started: true, fmt });
  }

  function pause() {
    if (!recording || !mr) return;
    if (paused) { mr.resume(); paused = false; t0 = performance.now(); onDone({ paused: false }); }
    else { mr.pause(); paused = true; acc += performance.now() - t0; onDone({ paused: true }); }
  }

  function stop() {
    if (!recording || !mr) return;
    recording = false;
    if (paused) { acc += performance.now() - t0; paused = false; }
    try { mr.stop(); } catch (_) {}
    cancelMeter();
    resetWave();
  }

  function elapsed() { return recording ? acc + (paused ? 0 : performance.now() - t0) : acc; }

  function tick() {
    if (!recording) return;
    onTick(elapsed());
    requestAnimationFrame(tick);
  }

  function resetWave() {
    waveBars.forEach(b => { b.style.height = '3px'; b.style.opacity = 0.4; });
  }

  /* ---------- 完成：编码 + 入库 + 配图 ---------- */
  async function finish() {
    const durMs = acc;
    const blob = new Blob(chunks, { type: (mr && mr.mimeType) || 'audio/mp4' });
    const fmt = pickFormat();
    mr = null;

    if (!blob.size) { onFail('录音为空，未保存'); return; }

    try {
      const ab = await blob.arrayBuffer();
      const peaks = await peaks(ab, 96);
      const dur = await durOf(blob);
      const now = Date.now();
      const id = 'rec-' + now + '-' + Math.random().toString(36).slice(2, 7);
      const label = new Date();
      const auto = '录音 ' + label.getFullYear() + String(label.getMonth() + 1).padStart(2, '0') +
                   String(label.getDate()).padStart(2, '0') + ' ' +
                   String(label.getHours()).padStart(2, '0') + ':' +
                   String(label.getMinutes()).padStart(2, '0');

      await DB.putAudio(id, blob);
      const cover = await Cover.generate(peaks, id, '我的录音', label.toLocaleString('zh-CN'));
      await DB.putCover(id, cover);

      const track = {
        id,
        title: auto,
        artist: '我的录音',
        kind: 'record',
        mime: blob.type || fmt.mime,
        ext: fmt.ext,
        duration: dur || durMs / 1000,
        size: blob.size,
        createdAt: now,
        peaks,
        license: '自有内容 · 版权自负',
        licenseShort: '录音'
      };
      await DB.addTrack(track);
      onDone({ saved: track, peaks });
    } catch (e) {
      console.error(e);
      onFail('保存失败：' + e.message);
    }
  }

  async function peaks(ab, n) {
    try {
      const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ctx = new AC(1, 1, 44100);
      const buf = await ctx.decodeAudioData(ab.slice(0));
      const d = buf.getChannelData(0);
      const out = [];
      const step = Math.floor(d.length / n) || 1;
      for (let i = 0; i < n; i++) {
        let mx = 0;
        for (let j = 0; j < step; j += 10) {
          const s = i * step + j;
          if (s >= d.length) break;
          const v = Math.abs(d[s]);
          if (v > mx) mx = v;
        }
        out.push(mx);
      }
      const max = Math.max(0.01, ...out);
      return out.map(v => Math.min(1, v / max));
    } catch (_) {
      // 无法解码（如某些编码）时用时长生成等效波形
      return Array.from({ length: n }, (_, i) => 0.3 + 0.35 * Math.abs(Math.sin(i * 0.4)));
    }
  }

  function durOf(blob) {
    return new Promise(res => {
      const a = new Audio();
      const u = URL.createObjectURL(blob);
      a.onloadedmetadata = () => { res(a.duration || 0); URL.revokeObjectURL(u); };
      a.onerror = () => { res(0); URL.revokeObjectURL(u); };
      a.src = u;
    });
  }

  function release() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    cancelMeter();
    if (recCtx) { try { recCtx.close(); } catch (_) {} recCtx = null; }
  }

  return {
    init, start, pause, stop, release, cycleDevice, resetWave,
    get recording() { return recording; },
    get paused() { return paused; },
    get hasStream() { return !!stream; },
    pickFormat, reset: buildWave,
    onTick: (f) => onTick = f,
    onLevel: (f) => onLevel = f,
    onDone: (f) => onDone = f,
    onFail: (f) => onFail = f
  };
})();