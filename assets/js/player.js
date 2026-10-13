/* ============================================================
   player.js — 播放引擎
   队列 / 播放模式 / 频谱分析 / MediaSession 锁屏控制
   ============================================================ */
const Player = (() => {
  const audio = document.getElementById('audio');
  let queue = [];        // track objects
  let idx = -1;
  let mode = 0;          // 0 列表循环 1 单曲 2 随机
  let shuffleOrder = [];
  const MODES = ['列表循环', '单曲循环', '随机播放'];

  let actx = null, analyser = null, srcNode = null, freqData = null;
  let blobURL = null;
  const listeners = { change: [], state: [], tick: [], queue: [] };

  const on = (e, fn) => listeners[e].push(fn);
  const emit = (e, ...a) => listeners[e].forEach(f => { try { f(...a); } catch (_) {} });

  /* ---------- WebAudio 频谱 ---------- */
  function ensureCtx() {
    if (actx) return actx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    analyser = actx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.78;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    srcNode = actx.createMediaElementSource(audio);
    srcNode.connect(analyser);
    analyser.connect(actx.destination);
    return actx;
  }

  function spectrum() {
    if (!analyser || audio.paused) return null;
    analyser.getByteFrequencyData(freqData);
    return freqData;
  }

  /* ---------- 队列 ---------- */

  function setQueue(list, startIdx = 0) {
    queue = list.slice();
    idx = startIdx;
    if (mode === 2) reshuffle();
    emit('queue');
    if (queue.length) playAt(idx);
    else stop();
  }

  function addToQueue(track) {
    queue.push(track);
    if (idx < 0) { idx = queue.length - 1; playAt(idx); }
    emit('queue');
  }

  function current() { return queue[idx] || null; }
  function list() { return queue; }

  function reshuffle() {
    const cur = queue[idx];
    const rest = queue.filter((_, i) => i !== idx);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    queue = cur ? [cur, ...rest] : rest;
    idx = cur ? 0 : -1;
  }

  async function playAt(i) {
    if (i < 0 || i >= queue.length) return;
    idx = i;
    const t = queue[i];
    const blob = await DB.getAudio(t.id);
    if (!blob) { emit('state', 'error', '音频丢失'); next(); return; }

    if (blobURL) URL.revokeObjectURL(blobURL);
    blobURL = URL.createObjectURL(blob);
    audio.src = blobURL;
    audio.playbackRate = 1;

    try { ensureCtx(); } catch (_) {}
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});

    updateMediaSession(t);
    emit('change', t);

    try {
      await audio.play();
      emit('state', 'play');
    } catch (e) {
      emit('state', 'error', '播放被阻止：' + (e.name || e.message));
    }
  }

  function toggle() {
    if (!current()) return;
    if (audio.paused) audio.play().then(() => emit('state', 'play')).catch(() => {});
    else { audio.pause(); emit('state', 'pause'); }
  }

  function next(auto = false) {
    if (!queue.length) return;
    if (mode === 1 && auto) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    if (mode === 2) {
      if (!shuffleOrder.length) reshuffle();
    }
    playAt((idx + 1) % queue.length);
  }

  function prev() {
    if (!queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    playAt((idx - 1 + queue.length) % queue.length);
  }

  function stop() {
    audio.pause();
    audio.removeAttribute('src');
    idx = -1;
    emit('change', null);
    emit('state', 'pause');
  }

  function seek(ratio) {
    if (!audio.duration || !isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration;
  }

  function setVolume(v) {
    audio.volume = Math.max(0, Math.min(1, v));
  }

  function cycleMode() {
    mode = (mode + 1) % 3;
    if (mode === 2) reshuffle();
    emit('state', 'mode', MODES[mode]);
    return MODES[mode];
  }

  function setMode(m) { mode = m; }

  /* ---------- 系统媒体控制（锁屏 / 耳机按键） ---------- */
  function updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;
    try {
      const cov = DB.getCoverURL(track.id);
      cov.then(url => {
        const art = url
          ? [{ src: url, sizes: '900x900', type: 'image/jpeg' }]
          : [{ src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="%237c5cff"/></svg>', sizes: '300x300' }];
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || '未知标题',
          artist: track.artist || '未知艺术家',
          album: '极光音乐',
          artwork: art
        });
      });
      navigator.mediaSession.setActionHandler('play', () => { audio.play().catch(() => {}); });
      navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', () => prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => next());
    } catch (_) {}
  }

  /* ---------- 事件绑定 ---------- */
  audio.addEventListener('timeupdate', () => emit('tick'));
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('loadedmetadata', () => emit('tick'));
  audio.addEventListener('error', () => {
    if (audio.src) emit('state', 'error', '音频解码失败');
  });

  // 首次交互解锁 AudioContext
  const unlock = () => {
    ensureCtx();
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    document.removeEventListener('pointerdown', unlock);
  };
  document.addEventListener('pointerdown', unlock);

  return {
    audio, on, emit, setQueue, addToQueue, current, list,
    toggle, next, prev, playAt, stop, seek, setVolume,
    cycleMode, setMode, spectrum, MODES,
    get mode() { return mode; }
  };
})();