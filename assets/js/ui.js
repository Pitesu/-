/* ============================================================
   ui.js — UI 装配层
   视图路由 / 列表渲染 / 播放器界面 / 录音交互 / 导入 / 弹层
   ============================================================ */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const TABS = {
    discover: { title: '发现',   sub: '免费好音乐，安心下载', view: '#v-discover' },
    online:   { title: '在线下载', sub: '仅限自由许可音源', view: '#v-online' },
    record:   { title: '录音',   sub: '录完自动配图入库', view: '#v-record' },
    library:  { title: '曲库',   sub: '全部音频在本地', view: '#v-library' },
    me:       { title: '我的',   sub: '设置与数据', view: '#v-me' }
  };

  let tab = 'discover';
  let tracks = [];
  let onlineItems = [];
  let libQuery = '';

  /* ================= Toast ================= */
  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .35s, transform .35s';
      el.style.opacity = '0'; el.style.transform = 'translateY(-10px)';
      setTimeout(() => el.remove(), 360);
    }, 2600);
  }

  /* ================= 视图切换 ================= */
  function go(name) {
    if (!TABS[name]) name = 'discover';
    tab = name;
    $$('.view').forEach(v => v.classList.remove('active'));
    $(TABS[name].view).classList.add('active');
    $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $('#pageTitle').textContent = TABS[name].title;
    $('#pageSub').textContent = TABS[name].sub;
    $('.views').scrollTop = 0;
    if (name === 'record') ensureRec();
    if (name === 'library') renderStats();
  }

  /* ================= 曲库渲染 ================= */
  function fmtTime(s) {
    if (!s || !isFinite(s)) return '--:--';
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }
  function fmtSize(b) {
    if (!b) return '';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + 'KB';
    return (b / 1024 / 1024).toFixed(1) + 'MB';
  }
  const KIND = {
    record: { cls: 'rec', txt: '录音' },
    online: { cls: 'net', txt: '下载' },
    local:  { cls: 'loc', txt: '本地' },
    demo:   { cls: 'loc', txt: '示范' }
  };

  async function rowHTML(t, i) {
    const cov = await DB.getCoverURL(t.id);
    const k = KIND[t.kind] || KIND.local;
    const playing = Player.current() && Player.current().id === t.id;
    return `
      <div class="track ${playing ? 'playing' : ''}" data-id="${t.id}" style="animation-delay:${Math.min(i * 26, 400)}ms">
        <img class="cover" src="${cov || ''}" alt="">
        <div class="meta">
          <div class="t1">${esc(t.title)}</div>
          <div class="t2">
            <span class="tag ${k.cls}">${k.txt}</span>
            <span>${esc(t.artist || '')}</span>
            ${t.size ? `<span>· ${fmtSize(t.size)}</span>` : ''}
          </div>
        </div>
        ${playing && !Player.audio.paused ? '<div class="eq"><i></i><i></i><i></i></div>' : ''}
        <span class="dur">${fmtTime(t.duration)}</span>
      </div>`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  async function renderLib() {
    const box = $('#listLib');
    const q = libQuery.trim().toLowerCase();
    const list = q
      ? tracks.filter(t => (t.title + ' ' + (t.artist || '')).toLowerCase().includes(q))
      : tracks;

    if (!list.length) {
      box.innerHTML = `<div class="empty"><div class="big">🎵</div>${
        q ? '没有匹配的曲目' : '曲库还是空的<br>去「录音」录一段，或「下载」自由音乐'}</div>`;
      return;
    }
    box.innerHTML = (await Promise.all(list.map(rowHTML))).join('');
  }

  async function renderRecent() {
    const box = $('#listRecent');
    const list = tracks.slice(0, 5);
    if (!list.length) {
      box.innerHTML = `<div class="empty"><div class="big">🎼</div>还没有曲目<br>试试下方快捷入口</div>`;
      return;
    }
    box.innerHTML = (await Promise.all(list.map(rowHTML))).join('');
  }

  async function renderStats() {
    const s = await DB.stats();
    $('#statAll').textContent = s.total;
    $('#statRec').textContent = s.rec;
    $('#statOn').textContent = s.online + s.local;
  }

  async function refreshAll() {
    tracks = await DB.allTracks();
    await renderRecent();
    await renderLib();
    await renderStats();
  }

  /* ================= 点击播放 ================= */
  function playFrom(list, id) {
    const i = list.findIndex(t => t.id === id);
    if (i < 0) return;
    Player.setQueue(list, i);
    openPlayer();
  }

  function handleTrackClick(e) {
    const el = e.target.closest('.track');
    if (!el) return;
    const id = el.dataset.id;
    // 首页"最近"可能是子集
    const recent = tracks.slice(0, 5);
    const recentIdx = recent.findIndex(t => t.id === id);
    const libIdx = tracks.findIndex(t => t.id === id);
    const useLib = libIdx >= 0 && recentIdx < 0;
    playFrom(useLib ? tracks : (recentIdx >= 0 ? recent : tracks), id);
  }

  /* ================= 全屏播放器 ================= */
  const PL = {
    open: false,
    bars: []
  };
  function buildSpectrum(n = 28) {
    const el = $('#spectrum');
    el.innerHTML = '';
    PL.bars = [];
    for (let i = 0; i < n; i++) {
      const b = document.createElement('i');
      el.appendChild(b); PL.bars.push(b);
    }
  }

  function openPlayer() {
    if (!Player.current()) return;
    $('#player').classList.add('open');
    PL.open = true;
  }
  function closePlayer() {
    $('#player').classList.remove('open');
    PL.open = false;
  }

  function syncPlayerUI() {
    const t = Player.current();
    if (!t) { $('#mini').classList.remove('show'); return; }
    $('#mini').classList.add('show');
    $('#plTitle').textContent = t.title || '未命名';
    $('#plArtist').textContent = t.artist || '未知艺术家';
    $('#miniTitle').textContent = t.title || '未命名';
    $('#miniSub').textContent = `${t.licenseShort || KIND[t.kind]?.txt || ''} · ${t.ext ? t.ext.toUpperCase() : ''}`;
    $('#plDur').textContent = fmtTime(Player.audio.duration);

    DB.getCoverURL(t.id).then(u => {
      if (u) {
        $('#plCover').src = u; $('#miniCover').src = u; $('#plBg').style.backgroundImage = `url("${u}")`;
      }
    });
    $('#plLoop').classList.toggle('on', Player.mode !== 2);
    $('#plShuffle').classList.toggle('on', Player.mode === 2);
  }

  function tickUI() {
    const a = Player.audio;
    const r = a.duration && isFinite(a.duration) ? a.currentTime / a.duration : 0;
    $('#seekFill').style.width = (r * 100) + '%';
    $('#seekKnob').style.left = (r * 100) + '%';
    $('#plCur').textContent = fmtTime(a.currentTime);
    $('#miniPb').style.width = (r * 100) + '%';

    // 频谱
    const fd = Player.spectrum();
    if (fd && PL.bars.length) {
      const n = PL.bars.length;
      for (let i = 0; i < n; i++) {
        const v = fd[Math.floor(i * fd.length / n * 0.6)] / 255;
        PL.bars[i].style.height = Math.max(3, Math.pow(v, 1.4) * 38) + 'px';
      }
    }
  }

  function setPlayIcon(playing) {
    const p = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>';
    const s = '<path d="M8 5v14l11-7z"/>';
    $('#plPlayIcon').innerHTML = playing ? p : s;
    $('#miniIcon').innerHTML = playing ? p : s;
    $('#plDisc').classList.toggle('spin', playing);
  }

  /* ================= 录音页 ================= */
  let recInit = false;
  async function ensureRec() {
    if (recInit) return;
    recInit = true;
    const f = Recorder.pickFormat();
    $('#fmtName').textContent = f.name;
    const ok = await Recorder.init();
    if (!ok) {
      $('#recHint').textContent = '麦克风不可用，请在手机浏览器或允许麦克风权限后重试';
    }
  }

  function bindRecorder() {
    const core = $('#recCore');
    const stopBtn = $('#recStop');
    const pauseBtn = $('#recPause');
    const icon = $('#recIcon');

    Recorder.onTick((ms) => {
      const s = Math.floor(ms / 1000);
      const d = Math.floor((ms % 1000) / 100);
      $('#recTime').innerHTML = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}<span class="ms">.${d}</span>`;
    });

    Recorder.onDone(async (info) => {
      if (info.deviceSwitched) { toast('已切换：' + info.label); return; }
      if (info.started) {
        icon.innerHTML = '<rect x="7" y="7" width="10" height="10" rx="2"/>';
        core.classList.add('recording');
        $('#ring2').style.display = 'block';
        $('#ring3').style.display = 'block';
        stopBtn.disabled = false; pauseBtn.disabled = false;
        $('#recHint').textContent = `录制中 · ${info.fmt.name}`;
        return;
      }
      if (info.paused !== undefined) {
        $('#recHint').textContent = info.paused ? '已暂停' : '录制中';
        return;
      }
      if (info.saved) {
        core.classList.remove('recording');
        icon.innerHTML = '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v4M8 22h8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>';
        $('#ring2').style.display = 'none';
        $('#ring3').style.display = 'none';
        stopBtn.disabled = true; pauseBtn.disabled = true;
        $('#recTime').innerHTML = '00:00<span class="ms">.0</span>';
        $('#recHint').textContent = '已保存并加入曲库';
        toast('录音已保存，自动配图完成');

        await refreshAll();
        openEditSheet(info.saved);
      }
    });

    Recorder.onFail((m) => {
      toast(m, 'err');
      $('#recHint').textContent = '点按麦克风开始录音';
      core.classList.remove('recording');
      stopBtn.disabled = true; pauseBtn.disabled = true;
    });

    core.addEventListener('click', async () => {
      if (Recorder.recording) return;
      if (!Recorder.hasStream) { await Recorder.init(); }
      Recorder.start();
    });

    stopBtn.addEventListener('click', () => Recorder.stop());
    pauseBtn.addEventListener('click', () => Recorder.pause());
    $('#recMicSel').addEventListener('click', () => Recorder.cycleDevice());
  }

  /* ================= 录音后编辑弹层 ================= */
  function openEditSheet(track) {
    const body = `
      <h3>给录音起个名字</h3>
      <p class="desc">已自动生成波形封面。可以改标题、换张封面，或者直接播放。</p>
      <div class="field">
        <label>标题</label>
        <input type="text" id="edTitle" value="${esc(track.title)}" maxlength="60">
      </div>
      <div class="field">
        <label>艺术家 / 来源</label>
        <input type="text" id="edArtist" value="${esc(track.artist)}" maxlength="60">
      </div>
      <div style="display:flex;gap:9px;margin-bottom:16px">
        <button class="btn ghost" id="edCover" style="flex:1">换封面</button>
        <button class="btn ghost" id="edPlay" style="flex:1">试听</button>
      </div>
      <button class="btn wide" id="edSave">保存</button>
      <div style="display:flex;gap:9px;margin-top:9px">
        <button class="btn ghost wide" id="edCancel">关闭</button>
      </div>`;
    openSheet(body);

    const $t = $('#edTitle'), $a = $('#edArtist');
    setTimeout(() => $t.focus(), 380);

    $('#edSave').onclick = async () => {
      await DB.updateTrack(track.id, { title: $t.value.trim() || '未命名录音', artist: $a.value.trim() || '我的录音' });
      // 若标题变了，重生成封面文字
      const t = await DB.getTrack(track.id);
      const blob = await Cover.generate(t.peaks || [], t.id + t.title, t.title, t.artist);
      await DB.putCover(track.id, blob);
      closeSheet();
      await refreshAll();
      Player.setQueue(tracks, Math.max(0, tracks.findIndex(x => x.id === track.id)));
      openPlayer();
    };
    $('#edCancel').onclick = closeSheet;
    $('#edPlay').onclick = () => {
      closeSheet();
      Player.setQueue(tracks, Math.max(0, tracks.findIndex(x => x.id === track.id)));
      openPlayer();
    };
    $('#edCover').onclick = () => pickCoverFor(track.id);
  }

  /* ================= 在线列表 ================= */
  async function doSearch() {
    const q = $('#qOnline').value.trim();
    const box = $('#onlineList');
    $('#btnSearchOnline').disabled = true;
    box.innerHTML = '<div class="empty"><div class="spinner" style="margin:0 auto 14px"></div>正在检索自由许可音频…</div>';

    const results = await Online.search(q, (src, n, err) => {
      if (err) console.warn(src, err);
    });

    onlineItems = results;
    $('#btnSearchOnline').disabled = false;

    if (!results.length) {
      box.innerHTML = `<div class="empty"><div class="big">📡</div>
        没有找到结果，或网络不可用<br>
        <span style="font-size:11.5px">可尝试：换个关键词 / 检查网络 / 用「导入文件」添加本地音频</span></div>`;
      return;
    }

    $('#onlineLabel').textContent = q ? `“${q}” 的结果` : '热门推荐';
    box.innerHTML = '';
    for (let i = 0; i < results.length; i++) {
      const it = results[i];
      const el = document.createElement('div');
      el.className = 'online-item';
      el.style.animationDelay = Math.min(i * 30, 500) + 'ms';
      el.innerHTML = `
        <img class="cover" src="${it.thumb || ''}" alt="" loading="lazy"
             onerror="this.style.display='none'">
        <div class="meta">
          <div class="t1">${esc(it.title)}</div>
          <div class="t2">
            <span class="lic ${/公有|public/i.test(it.licenseShort) ? 'od' : ''}">${esc(it.licenseShort)}</span>
            <span>${esc(it.author)}</span><span>· ${esc(it.source)}</span>
          </div>
        </div>
        <button class="iconbtn" data-dl="${it.id}" style="width:36px;height:36px" title="下载">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v13"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/></svg>
        </button>`;
      el.querySelector('img').onerror = function () { this.style.visibility = 'hidden'; };
      el.querySelector('[data-dl]').onclick = (ev) => { ev.stopPropagation(); downloadItem(it, el.querySelector('[data-dl]')); };
      el.onclick = () => window.open(it.pageUrl, '_blank', 'noopener');
      box.appendChild(el);
    }
  }

  async function downloadItem(it, btn) {
    const old = btn.innerHTML;
    btn.innerHTML = '<div class="spinner" style="width:15px;height:15px"></div>';
    btn.style.pointerEvents = 'none';
    try {
      const t = await Online.download(it, (m) => toast(m));
      toast('已下载并加入曲库');
      await refreshAll();
      Player.addToQueue(t);
      openPlayer();
    } catch (e) {
      toast(e.message || '下载失败', 'err');
    } finally {
      btn.innerHTML = old;
      btn.style.pointerEvents = '';
    }
  }

  /* ================= 导入本地文件 ================= */
  async function importFiles(files) {
    const list = Array.from(files).filter(f =>
      f.type.startsWith('audio/') || /\.(m4a|mp3|aac|wav|ogg|flac|webm|opus|mp4)$/i.test(f.name));
    if (!list.length) { toast('没有可识别的音频文件', 'err'); return; }

    let ok = 0;
    for (const f of list) {
      try {
        toast(`导入 ${f.name.length > 16 ? f.name.slice(0, 16) + '…' : f.name}`);
        let coverBlob = await Cover.extract(f);
        if (!coverBlob) {
          // 无内嵌封面：先用时长+标题生成
          const d = await Demo.durationOf(f);
          coverBlob = await Cover.generate([], f.name, f.name.replace(/\.[^.]+$/, ''), '本地导入');
        }
        const id = 'loc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        await DB.putAudio(id, f);
        await DB.putCover(id, coverBlob);
        await DB.addTrack({
          id,
          title: f.name.replace(/\.[^.]+$/, ''),
          artist: '本地导入',
          kind: 'local',
          mime: f.type || 'audio/mpeg',
          ext: (f.name.match(/\.([a-z0-9]+)$/i) || [, 'mp3'])[1].toLowerCase(),
          duration: await Demo.durationOf(f),
          size: f.size,
          createdAt: Date.now(),
          license: '自有文件 · 版权自负',
          licenseShort: '本地'
        });
        ok++;
      } catch (e) {
        console.error(e);
        toast('导入失败：' + f.name, 'err');
      }
    }
    await refreshAll();
    toast(`成功导入 ${ok} 个文件`);
  }

  /* ================= 换封面 ================= */
  function pickCoverFor(trackId) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      try {
        const blob = await Cover.fromImageFile(f);
        await DB.putCover(trackId, blob);
        toast('封面已更新');
        await refreshAll();
        const cur = Player.current();
        if (cur && cur.id === trackId) syncPlayerUI();
      } catch (e) { toast('封面处理失败', 'err'); }
    };
    inp.click();
  }

  /* ================= 通用弹层 ================= */
  function openSheet(html) {
    $('#sheetBody').innerHTML = html;
    $('#sheet').classList.add('show');
    $('#mask').classList.add('show');
  }
  function closeSheet() {
    $('#sheet').classList.remove('show');
    $('#mask').classList.remove('show');
  }

  /* ================= 事件绑定 ================= */
  function bind() {
    $('#tabbar').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (b) go(b.dataset.tab);
    });

    $$('[data-go]').forEach(el => el.addEventListener('click', () => go(el.dataset.go)));
    $('#btnGoOnline').addEventListener('click', () => go('online'));
    $('#btnGoRec').addEventListener('click', () => go('record'));

    // 主题
    $('#btnTheme').addEventListener('click', async () => {
      const cur = document.documentElement.dataset.theme;
      const nx = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = nx;
      document.querySelector('meta[name=theme-color]').content = nx === 'dark' ? '#07070c' : '#f6f5fb';
      await DB.setMeta('theme', nx);
      toast(nx === 'dark' ? '深色模式' : '浅色模式');
    });

    // 搜索按钮：跳到对应页
    $('#btnSearchToggle').addEventListener('click', () => {
      if (tab === 'library') { $('#qLib').focus(); return; }
      if (tab === 'online') { $('#qOnline').focus(); return; }
      go('library');
      setTimeout(() => $('#qLib').focus(), 340);
    });

    // 列表点击
    document.addEventListener('click', handleTrackClick);

    // 在线
    $('#btnSearchOnline').addEventListener('click', doSearch);
    $('#qOnline').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

    // 曲库搜索
    $('#qLib').addEventListener('input', (e) => { libQuery = e.target.value; renderLib(); });
    $('#btnShuffleAll').addEventListener('click', () => {
      if (!tracks.length) { toast('曲库是空的'); return; }
      const sh = tracks.slice().sort(() => Math.random() - 0.5);
      Player.setMode(2); Player.setQueue(sh, 0); openPlayer();
    });

    // 导入
    const pick = () => $('#filePick').click();
    $('#btnImport').addEventListener('click', pick);
    $('#btnImport2').addEventListener('click', pick);
    $('#filePick').addEventListener('change', async (e) => {
      await importFiles(e.target.files);
      e.target.value = '';
    });

    // 播放器
    $('#mini').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openPlayer();
    });
    $('#miniBtn').addEventListener('click', (e) => { e.stopPropagation(); Player.toggle(); });
    $('#miniNext').addEventListener('click', (e) => { e.stopPropagation(); Player.next(); });
    $('#plDown').addEventListener('click', closePlayer);
    $('#plPlay').addEventListener('click', () => Player.toggle());
    $('#plNext').addEventListener('click', () => Player.next());
    $('#plPrev').addEventListener('click', () => Player.prev());
    $('#plLoop').addEventListener('click', () => {
      const m = Player.cycleMode();
      toast(m);
      $('#loopLabel').textContent = m;
      syncPlayerUI();
    });
    $('#plShuffle').addEventListener('click', () => {
      const m = Player.cycleMode();
      toast(m);
      $('#loopLabel').textContent = m;
      syncPlayerUI();
    });
    $('#plMore').addEventListener('click', () => {
      const t = Player.current();
      if (!t) return;
      openSheet(`
        <h3>${esc(t.title)}</h3>
        <p class="desc">${esc(t.artist)} · ${esc(t.mime)} · ${fmtSize(t.size)}</p>
        <div class="card" style="padding:14px 16px;margin-bottom:14px">
          <div style="font-size:12px;color:var(--text-3);line-height:1.9">
            <b style="color:var(--text)">来源</b> ${esc(t.source || t.kind)}<br>
            <b style="color:var(--text)">许可</b> ${esc(t.license || '自有内容')}<br>
            <b style="color:var(--text)">类型</b> ${esc(t.ext || '').toUpperCase()} · ${fmtTime(t.duration)}
          </div>
        </div>
        <button class="btn wide" id="mCover">更换封面</button>
        <div style="display:flex;gap:9px;margin-top:9px">
          <button class="btn ghost" id="mDelete" style="flex:1;color:#ff7a7a">删除</button>
          <button class="btn ghost" id="mClose" style="flex:1">关闭</button>
        </div>`);
      $('#mClose').onclick = closeSheet;
      $('#mCover').onclick = () => { closeSheet(); pickCoverFor(t.id); };
      $('#mDelete').onclick = async () => {
        if (!confirm('确定从曲库删除这首？此操作不可撤销。')) return;
        if (Player.current() && Player.current().id === t.id) { Player.stop(); closePlayer(); }
        await DB.removeTrack(t.id);
        await DB.dropCoverURL(t.id);
        closeSheet();
        await refreshAll();
        toast('已删除');
      };
    });

    // 进度条拖拽
    const sb = $('#seekbar');
    let dragging = false;
    const ratioAt = (e) => {
      const r = sb.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      return Math.max(0, Math.min(1, x / r.width));
    };
    const start = (e) => { dragging = true; Player.seek(ratioAt(e)); };
    const move = (e) => { if (dragging) { e.preventDefault(); Player.seek(ratioAt(e)); } };
    const end = () => { dragging = false; };
    sb.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);

    // 弹层
    $('#mask').addEventListener('click', closeSheet);

    // 安装到桌面（「我的」页二次入口）
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (!standalone) {
      const $bi = $('#btnInstall');
      $bi.style.display = 'flex';
      $bi.onclick = () => showInstallHelp();
    }
    window.addEventListener('aurora:installable', () => {
      const $bi = $('#btnInstall');
      if ($bi && !standalone) $bi.style.display = 'flex';
    });

    // 我的
    const vol = $('#volRange');
    vol.addEventListener('input', async () => {
      const v = vol.value / 100;
      Player.setVolume(v);
      await DB.setMeta('vol', v);
    });
    $('#btnLoopMode').addEventListener('click', () => {
      const m = Player.cycleMode();
      $('#loopLabel').textContent = m;
      toast(m);
    });
    $('#btnScanDur').addEventListener('click', async () => {
      toast('正在重算时长…');
      let n = 0;
      for (const t of tracks) {
        try {
          const b = await DB.getAudio(t.id);
          if (!b) continue;
          const d = await Demo.durationOf(b);
          if (d && Math.abs(d - (t.duration || 0)) > 0.5) await DB.updateTrack(t.id, { duration: d });
          if (!t.peaks || !t.peaks.length) {
            const p = await Demo.peaksFromBlob(b, 96);
            if (p.length) await DB.updateTrack(t.id, { peaks: p });
          }
          n++;
        } catch (_) {}
      }
      await refreshAll();
      toast(`已重算 ${n} 首`);
    });
    $('#btnAbout').addEventListener('click', () => openSheet(`
      <h3>版权说明</h3>
      <p class="desc">
        本应用严格区分「可下载」与「需自备」两类内容：<br><br>
        <b>在线下载区</b>只接入公有领域（Public Domain）与 CC 自由许可（CC0 / CC-BY）音频库，
        检索时会过滤掉非商业、禁止演绎等限制条款，并显示许可证与作者署名。<br><br>
        <b>受版权保护的歌曲</b>不在下载区提供，应用也不内置任何商业曲目。如需收听，
        请通过「我的录音」用设备现场录制，或用「导入文件」添加你自己持有的音频文件。<br><br>
        <b>内置示范曲</b>由本机 Web Audio 实时合成，不含任何第三方素材。
      </p>
      <button class="btn wide" id="aClose">知道了</button>`));
    $('#btnClear').addEventListener('click', async () => {
      if (!confirm('将清空曲库中全部音频与封面，且不可恢复。确定继续？')) return;
      Player.stop(); closePlayer();
      await DB.clearAll();
      await refreshAll();
      toast('曲库已清空');
    });

    // 播放器事件
    Player.on('change', () => { syncPlayerUI(); renderLib(); renderRecent(); });
    Player.on('state', (ev, msg) => {
      setPlayIcon(ev === 'play');
      if (ev === 'error') toast(msg || '播放异常', 'err');
    });
    Player.on('tick', tickUI);
    setInterval(tickUI, 250);

    // 键盘（桌面）
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault();
        if (PL.open) Player.toggle(); else if (Player.current()) openPlayer();
      }
      if (e.key === 'Escape') { closeSheet(); if (PL.open) closePlayer(); }
    });
  }

  /* ================= 启动 ================= */
  // ============ 安装帮助（分平台） ============
  function showInstallHelp() {
    const F = window.__AURORA_FLAGS || {};
    if (F.isIOS || F.isWeChat) {
      openSheet(`
        <h3>添加到主屏幕（iPhone）</h3>
        <p class="desc">
          ① 用 <b>Safari</b> 打开本页（微信里先点右上角 ⋯ →「在浏览器打开」）<br>
          ② 点底部中间的 <b>「分享」</b> 箭头<br>
          ③ 向上滑，点 <b>「添加到主屏幕」</b><br>
          ④ 点右上角 <b>「添加」</b>，桌面即出现「极光音乐」图标。
        </p>
        <button class="btn wide" id="igOk">知道了</button>`);
      const ok = document.getElementById('igOk'); if (ok) ok.onclick = closeSheet;
    } else {
      openSheet(`
        <h3>安装到桌面（Android）</h3>
        <p class="desc">点浏览器右上角 <b>⋮</b> 菜单 → <b>「安装应用」</b> 或 <b>「添加到主屏幕」</b>。安装后图标出现在桌面，点开即全屏运行，断网也能用。</p>
        <button class="btn wide" id="igOk2">知道了</button>`);
      const ok = document.getElementById('igOk2'); if (ok) ok.onclick = closeSheet;
    }
  }

  // ============ 安装引导（手机首次访问优先展示） ============
  function setupInstallGate() {
    const F = window.__AURORA_FLAGS || {};
    const gate = document.getElementById('installGate');
    const app = document.getElementById('app');
    if (!gate) return;

    // 桌面 / 已安装 / 用户曾跳过 → 直接进应用
    if (!F.isMobile || F.standalone || F.forceApp) {
      gate.style.display = 'none';
      return;
    }

    const stepsEl = document.getElementById('igSteps');
    const btn = document.getElementById('igInstallBtn');
    const skip = document.getElementById('igSkip');

    // 浏览器是否支持「点按钮直接弹系统安装框」：iOS / 微信永远不支持；
    // Android Chrome 若用户此前忽略过安装提示，会在一段冷却期内不再派发该事件
    function canPrompt() {
      return !!window.__deferredPrompt && !F.isIOS && !F.isWeChat;
    }

    function stepHTML() {
      if (F.isWeChat) {
        return `
          <div class="ig-step"><span class="ig-n">1</span>微信无法安装，请先点右上角 <b>⋯</b></div>
          <div class="ig-step"><span class="ig-n">2</span>选 <b>「在浏览器打开」</b>（Safari / Chrome）</div>
          <div class="ig-step"><span class="ig-n">3</span>打开后按下方提示把应用装到桌面</div>`;
      }
      if (F.isIOS) {
        return `
          <div class="ig-step"><span class="ig-n">1</span>用 <b>Safari</b> 打开本页（微信里先「在浏览器打开」）</div>
          <div class="ig-step"><span class="ig-n">2</span>点底部中间的 <b>「分享」</b> 箭头 ⤴</div>
          <div class="ig-step"><span class="ig-n">3</span>向上滑，点 <b>「添加到主屏幕」</b> ➕</div>
          <div class="ig-step"><span class="ig-n">4</span>点右上角 <b>「添加」</b>，完成！</div>`;
      }
      if (canPrompt()) {
        return `
          <div class="ig-step"><span class="ig-n">1</span>点击下方 <b>「安装到桌面」</b> 按钮</div>
          <div class="ig-step"><span class="ig-n">2</span>在弹出的系统框中点 <b>「安装」</b></div>
          <div class="ig-step"><span class="ig-n">3</span>桌面出现「极光音乐」图标，点开即全屏运行</div>`;
      }
      // 不支持自动弹框：改走浏览器菜单手动安装（步骤就地展示，避免被遮住）
      return `
        <div class="ig-step"><span class="ig-n">!</span>本浏览器当前未提供「一键安装」——多半是你此前在弹窗里点过「不安装」，Chrome 进入约 90 天冷却期</div>
        <div class="ig-step"><span class="ig-n">1</span>点浏览器右上角 <b>⋮</b> 菜单</div>
        <div class="ig-step"><span class="ig-n">2</span>选 <b>「安装应用」</b> 或 <b>「添加到主屏幕」</b></div>
        <div class="ig-step"><span class="ig-n">3</span>桌面出现「极光音乐」图标，点开即全屏运行</div>`;
    }

    function refresh() {
      stepsEl.innerHTML = stepHTML();
      btn.textContent = canPrompt() ? '安装到桌面' : '查看安装方法';
      btn.disabled = false;
    }

    function goApp() {
      localStorage.setItem('aurora_skip_gate', '1');
      gate.style.display = 'none';
      app.style.display = '';
    }

    btn.onclick = () => {
      if (canPrompt()) {
        const p = window.__deferredPrompt;
        btn.textContent = '正在唤起安装…';
        btn.disabled = true;
        try {
          p.prompt();
          const done = (choice) => {
            window.__deferredPrompt = null;
            if (!(choice && choice.outcome === 'accepted')) refresh();
          };
          if (p.userChoice && typeof p.userChoice.then === 'function') {
            p.userChoice.then(done).catch(() => refresh());
          } else {
            refresh();
          }
        } catch (_) {
          refresh();
        }
      } else {
        // 不支持自动安装：在卡片内就地展开完整步骤（绝不弹被遮盖的弹层）
        btn.disabled = false;
        stepsEl.innerHTML = stepHTML();
        btn.textContent = '知道了，进入应用';
        btn.onclick = goApp;
        if (skip) skip.style.display = 'none';
      }
    };

    skip.onclick = goApp;

    refresh();
    gate.style.display = 'flex';
    app.style.display = 'none';

    // 若页面加载后浏览器才派发可安装事件，及时把按钮升级为「直接安装」
    window.addEventListener('aurora:installable', () => {
      if (!F.isIOS && !F.isWeChat) refresh();
    });
    window.addEventListener('appinstalled', () => {
      localStorage.setItem('aurora_skip_gate', '1');
      gate.style.display = 'none';
      app.style.display = '';
    });
  }

  async function boot() {
    buildSpectrum();
    bind();
    setupInstallGate();
    bindRecorder();
    Recorder.reset();

    // 支持 manifest 快捷方式：index.html#record / #library
    const h = (location.hash || '').replace('#', '');
    if (h && TABS[h]) setTimeout(() => go(h), 60);

    // 恢复设置
    const theme = await DB.getMeta('theme');
    if (theme) document.documentElement.dataset.theme = theme;
    const vol = await DB.getMeta('vol');
    if (vol != null) { $('#volRange').value = Math.round(vol * 100); Player.setVolume(vol); }

    await refreshAll();

    // 首次打开：注入内置示范曲，保证开箱可听
    if (!tracks.length) {
      toast('正在生成内置示范曲…');
      try {
        await Demo.seed((i, n, name) => toast(`生成示范曲 ${i}/${n}：${name}`));
        await refreshAll();
        toast('示范曲已就绪');
      } catch (e) { console.error(e); }
    }

    // iOS 需要用户手势解锁音频
    const unlock = () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) new AC().resume();
      } catch (_) {}
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();