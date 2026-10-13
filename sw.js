/* ============================================================
   sw.js — 离线缓存
   只缓存应用外壳（HTML/CSS/JS/图标）。
   音频与封面存在 IndexedDB，不经过这里。
   ============================================================ */
const VERSION = 'aurora-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/db.js',
  './assets/js/cover.js',
  './assets/js/demo.js',
  './assets/js/player.js',
  './assets/js/recorder.js',
  './assets/js/online.js',
  './assets/js/ui.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-64.png'
];

// 安装：预缓存外壳
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // 单个资源失败不应导致整个安装失败
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 请求策略：外壳走缓存优先，其余（在线音源 API）直连
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 跨域请求（音频下载、音源 API）不拦截，交给网络
  if (url.origin !== location.origin) return;

  // 导航请求：网络优先，失败回落到缓存的 index
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});