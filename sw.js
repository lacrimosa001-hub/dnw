/* ============================================================
 *  合成大W · Service Worker
 *
 *  目的：装到主屏幕之后能离线玩，且打开是秒开（不用等素材下载）。
 *
 *  策略：
 *    · 页面导航 —— 先走网络（保证能拿到新版），断网才回缓存
 *    · 静态资源 —— 先用缓存（秒开），同时后台悄悄更新
 *
 *  ⚠️ 改了任何静态资源之后，把 CACHE 的版本号加一，
 *     否则老用户会一直拿到旧缓存。
 * ============================================================ */
'use strict';

const CACHE = 'dnw-694daaa621';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.json',
  './assets/fruits/parts.js',
  './assets/fruits/01-cry.webp',
  './assets/fruits/02-panic.webp',
  './assets/fruits/03-deadpan.webp',
  './assets/fruits/04-content.webp',
  './assets/fruits/05-smug.webp',
  './assets/fruits/06-grin.webp',
  './assets/fruits/07-laugh.webp',
  './assets/fruits/08-rage.webp',
  './assets/merge.mp3',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 逐个 add 而不是 addAll：任何一个 404 都不会让整次安装失败
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(req, res) {
  if (!res || !res.ok) return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;   // 只缓存自己站内的
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  // 页面导航：网络优先
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { put(req, res.clone()); return res; })
        .catch(() => caches.match('./index.html').then((h) => h || Response.error()))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })
  );
});
