
const APP_VERSION   = 'v6';           // ← bump this to trigger update popup
const CACHE_SHELL   = `ssc-shell-${APP_VERSION}`;
const CACHE_CDN     = `ssc-cdn-${APP_VERSION}`;
const CACHE_PAGES   = `ssc-pages-${APP_VERSION}`;

// ── Assets to pre-cache on install ──────────────────
const SHELL_ASSETS = [
  '/ssc/',
  '/ssc/index.html',
  '/ssc/favicon.svg',
  '/ssc/manifest.json',
  '/ssc/icons/icon-192.png',
  '/ssc/icons/icon-512.png',
];

// ── CDN hosts → stale-while-revalidate ──────────────
const SWR_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'www.gstatic.com',
];

// ── Firebase / auth hosts → always network-only ─────
const NETWORK_ONLY_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebase.googleapis.com',
  'www.googleapis.com',
];

const OFFLINE_URL = '/ssc/offline.html';

// ────────────────────────────────────────────────────
//  INSTALL – pre-cache shell
// ────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log(`[SW ${APP_VERSION}] Installing…`);
  event.waitUntil(
    caches.open(CACHE_SHELL).then(cache =>
      cache.addAll(SHELL_ASSETS).catch(err => {
        console.warn('[SW] Shell pre-cache partial failure:', err);
      })
    )
  );
  // Don't skipWaiting immediately — wait for activate so we can
  // tell clients about the update after old caches are wiped.
  self.skipWaiting();
});

// ────────────────────────────────────────────────────
//  ACTIVATE – clean old caches, then notify all clients
// ────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log(`[SW ${APP_VERSION}] Activating…`);
  const CURRENT_CACHES = [CACHE_SHELL, CACHE_CDN, CACHE_PAGES];

  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => !CURRENT_CACHES.includes(key))
            .map(key => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
      .then(() => {
        // ── Broadcast update to every open tab ──────
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(clientList => {
            clientList.forEach(client => {
              client.postMessage({
                type: 'SW_UPDATED',
                version: APP_VERSION,
              });
            });
            console.log(`[SW] Notified ${clientList.length} client(s) of update ${APP_VERSION}`);
          });
      })
  );
});

// ────────────────────────────────────────────────────
//  FETCH – routing logic
// ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // 1️⃣  Firebase / auth → network only
  if (NETWORK_ONLY_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(fetch(request));
    return;
  }

  // 2️⃣  CDN / Fonts → stale-while-revalidate
  if (SWR_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(request, CACHE_CDN));
    return;
  }

  // 3️⃣  HTML navigation → network-first, offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // 4️⃣  Same-origin static assets → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_SHELL));
    return;
  }

  // 5️⃣  Everything else → network-first
  event.respondWith(networkFirst(request, CACHE_PAGES));
});

// ────────────────────────────────────────────────────
//  Strategy helpers
// ────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_PAGES);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const shellIndex = await caches.match('/ssc/');
    if (shellIndex) return shellIndex;
    return caches.match(OFFLINE_URL) ||
      new Response(offlineFallbackHTML(), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// ────────────────────────────────────────────────────
//  Offline fallback HTML  (beautiful, on-brand)
// ────────────────────────────────────────────────────
function offlineFallbackHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Offline – SSC Prep | ThunderStudy</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800;900&family=Outfit:wght@700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --acc:#5B4EE8;--acc2:#4338CA;--bg:#F0EEFF;
  --text:#1a1240;--text2:#4a4580;--text3:#6b65a0;
  --border:#D4CCFF;--card:#fff;--card2:#EBEEFF;
}
html,body{height:100%;}
body{
  min-height:100%;background:var(--bg);color:var(--text);
  font-family:'Plus Jakarta Sans',system-ui,sans-serif;
  display:flex;flex-direction:column;align-items:center;
  justify-content:center;padding:24px;overflow:hidden;
}

/* ── Blobs ── */
.blob{position:fixed;border-radius:50%;pointer-events:none;z-index:0;}
@keyframes blobFloat1{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(25px,-18px) scale(1.06);}}
@keyframes blobFloat2{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(-18px,22px) scale(1.07);}}

/* ── Card ── */
.card{
  position:relative;z-index:1;
  background:rgba(255,255,255,.92);
  border:1.5px solid rgba(212,204,255,.8);
  border-radius:28px;
  padding:40px 32px 36px;
  max-width:420px;width:100%;
  text-align:center;
  box-shadow:0 4px 6px rgba(91,78,232,.04),0 24px 60px rgba(91,78,232,.14),0 0 0 1px rgba(255,255,255,.7) inset;
  animation:cardIn .7s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes cardIn{from{opacity:0;transform:translateY(28px) scale(.95);}to{opacity:1;transform:none;}}

/* ── Icon ── */
.icon-wrap{
  width:88px;height:88px;border-radius:24px;margin:0 auto 24px;
  background:linear-gradient(135deg,#5B4EE8,#4338CA);
  display:flex;align-items:center;justify-content:center;
  font-size:38px;
  box-shadow:0 8px 28px rgba(91,78,232,.38),0 20px 50px rgba(91,78,232,.18);
  animation:iconIn .6s .2s cubic-bezier(.34,1.56,.64,1) both;
  position:relative;
}
@keyframes iconIn{from{transform:scale(0) rotate(-8deg);}to{transform:scale(1) rotate(0);}}
.icon-pulse{
  position:absolute;inset:-12px;border-radius:36px;
  border:2px solid rgba(91,78,232,.2);
  animation:pulse 2.2s ease-in-out 1s infinite;
}
.icon-pulse2{
  position:absolute;inset:-22px;border-radius:46px;
  border:2px solid rgba(91,78,232,.1);
  animation:pulse 2.2s ease-in-out 1.4s infinite;
}
@keyframes pulse{0%,100%{transform:scale(1);opacity:.7;}50%{transform:scale(1.06);opacity:0;}}

/* ── Brand ── */
.brand{
  font-family:'Outfit',sans-serif;font-size:13px;font-weight:800;
  letter-spacing:2.5px;text-transform:uppercase;
  color:var(--text3);margin-bottom:4px;
}
.title{
  font-family:'Outfit',sans-serif;font-size:26px;font-weight:900;
  letter-spacing:-.5px;color:var(--text);margin-bottom:8px;
  line-height:1.2;
}
.sub{
  font-size:13px;color:var(--text2);line-height:1.75;
  margin-bottom:28px;
}

/* ── Status chips ── */
.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:28px;}
.chip{
  display:inline-flex;align-items:center;gap:5px;
  padding:5px 12px;border-radius:20px;
  font-size:11px;font-weight:700;letter-spacing:.3px;
}
.chip-offline{background:rgba(220,38,38,.1);color:#dc2626;border:1px solid rgba(220,38,38,.2);}
.chip-cached{background:rgba(22,163,74,.1);color:#16a34a;border:1px solid rgba(22,163,74,.2);}

/* ── Dot blink ── */
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;}
.dot-red{background:#dc2626;animation:dotBlink 1.4s ease-in-out infinite;}
.dot-green{background:#16a34a;}
@keyframes dotBlink{0%,100%{opacity:1;}50%{opacity:.25;}}

/* ── Tips ── */
.tips{
  background:var(--card2);border:1.5px solid var(--border);
  border-radius:16px;padding:16px 18px;
  margin-bottom:28px;text-align:left;
}
.tips-title{font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;}
.tip{display:flex;align-items:flex-start;gap:8px;margin-bottom:7px;font-size:12px;color:var(--text2);line-height:1.55;}
.tip:last-child{margin-bottom:0;}
.tip-icon{font-size:14px;flex-shrink:0;margin-top:1px;}

/* ── Buttons ── */
.btn-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}
.btn{
  display:inline-flex;align-items:center;gap:6px;
  padding:11px 22px;border-radius:22px;
  font-size:13px;font-weight:800;cursor:pointer;border:none;
  font-family:'Plus Jakarta Sans',system-ui,sans-serif;
  transition:transform .18s,box-shadow .18s;
}
.btn:active{transform:scale(.96)!important;}
.btn-prim{
  background:linear-gradient(135deg,#5B4EE8,#4338CA);color:#fff;
  box-shadow:0 4px 16px rgba(91,78,232,.35);
}
.btn-prim:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(91,78,232,.45);}
.btn-ghost{
  background:var(--card);color:var(--text2);
  border:1.5px solid var(--border);
}
.btn-ghost:hover{background:var(--card2);transform:translateY(-1px);}

/* ── Retry spinner ── */
.btn-prim.loading{pointer-events:none;opacity:.78;}
.btn-prim.loading::after{
  content:'';width:13px;height:13px;
  border:2px solid rgba(255,255,255,.45);border-top-color:#fff;
  border-radius:50%;animation:spin .65s linear infinite;
  display:inline-block;
}
@keyframes spin{to{transform:rotate(360deg);}}

/* ── Footer ── */
.footer{
  position:relative;z-index:1;margin-top:22px;
  font-size:10px;color:var(--text3);font-weight:600;letter-spacing:.3px;
}
</style>
</head>
<body>

<!-- Ambient blobs -->
<div class="blob" style="width:600px;height:600px;background:radial-gradient(circle,rgba(91,78,232,.18),transparent 65%);top:-180px;left:-160px;animation:blobFloat1 9s ease-in-out infinite alternate;"></div>
<div class="blob" style="width:500px;height:500px;background:radial-gradient(circle,rgba(124,58,237,.12),transparent 65%);bottom:-140px;right:-100px;animation:blobFloat2 11s ease-in-out infinite alternate;"></div>
<div class="blob" style="width:300px;height:300px;background:radial-gradient(circle,rgba(236,72,153,.07),transparent 70%);top:20%;right:5%;animation:blobFloat1 7s ease-in-out infinite alternate-reverse;"></div>

<div class="card">

  <!-- Icon -->
  <div class="icon-wrap">
    ⚡
    <div class="icon-pulse"></div>
    <div class="icon-pulse2"></div>
  </div>

  <!-- Brand & title -->
  <div class="brand">ThunderStudy SSC</div>
  <div class="title">You're Offline</div>
  <div class="sub">
    No internet connection right now.<br>
    Some content is available from cache.
  </div>

  <!-- Status chips -->
  <div class="chips">
    <span class="chip chip-offline"><span class="dot dot-red"></span> No Internet</span>
    <span class="chip chip-cached"><span class="dot dot-green"></span> Cache Available</span>
  </div>

  <!-- Tips -->
  <div class="tips">
    <div class="tips-title">📋 What you can still do</div>
    <div class="tip"><span class="tip-icon">✅</span><span>View previously loaded mock tests and scores</span></div>
    <div class="tip"><span class="tip-icon">📊</span><span>Check your analytics, streaks &amp; progress</span></div>
    <div class="tip"><span class="tip-icon">📌</span><span>Read your pinned notes and saved content</span></div>
    <div class="tip"><span class="tip-icon">🔄</span><span>Connect to Wi-Fi or mobile data and retry</span></div>
  </div>

  <!-- Buttons -->
  <div class="btn-row">
    <button class="btn btn-prim" id="retry-btn" onclick="retryNow()">
      🔄 Retry
    </button>
    <button class="btn btn-ghost" onclick="goBack()">
      ← Go Back
    </button>
  </div>

</div>

<div class="footer">⚡ ThunderStudy · SSC Prep · Offline Mode</div>

<script>
function retryNow(){
  const btn = document.getElementById('retry-btn');
  btn.classList.add('loading');
  btn.textContent = '';
  setTimeout(()=>{ location.reload(); }, 500);
}
function goBack(){
  if(history.length > 1) history.back();
  else location.href = '/ssc/';
}

// Auto-retry when connection comes back
window.addEventListener('online', ()=>{
  document.querySelector('.chip-offline').innerHTML =
    '<span style="width:7px;height:7px;border-radius:50%;background:#16a34a;display:inline-block;"></span> Back Online!';
  document.querySelector('.chip-offline').className = 'chip chip-cached';
  setTimeout(()=>location.reload(), 800);
});
</script>
</body>
</html>`;
}

// ────────────────────────────────────────────────────
//  Message handler — SKIP_WAITING from update popup
// ────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING received — taking over');
    self.skipWaiting();
  }
});

// ────────────────────────────────────────────────────
//  Push notifications
// ────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'SSC Prep', {
      body: data.body || '',
      icon: '/ssc/icons/icon-192.png',
      badge: '/ssc/icons/icon-96.png',
      tag: data.tag || 'ssc-notif',
      data: { url: data.url || '/ssc/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/ssc/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('/ssc/') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(target);
    })
  );
});
