/* =====================================================
   SSC Prep – ThunderStudy  |  Service Worker
   Scope: /ssc/
   Strategy:
     • Shell / static assets  → Cache-first
     • Google Fonts / CDN     → Stale-while-revalidate
     • Firebase API calls     → Network-only  (auth / Firestore)
     • Everything else        → Network-first, fallback to cache
   ===================================================== */

const APP_VERSION   = 'v1';
const CACHE_SHELL   = `ssc-shell-${APP_VERSION}`;
const CACHE_CDN     = `ssc-cdn-${APP_VERSION}`;
const CACHE_PAGES   = `ssc-pages-${APP_VERSION}`;

// ── Assets to pre-cache on install ──────────────────
const SHELL_ASSETS = [
  '/ssc/',
  '/ssc/index.html',
  '/ssc/favicon.svg',
  '/ssc/manifest.json',
  // icons
  '/ssc/icons/icon-192.png',
  '/ssc/icons/icon-512.png',
];

// ── CDN hosts handled with stale-while-revalidate ───
const SWR_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'www.gstatic.com',        // Firebase compat scripts
];

// ── Firebase / auth hosts – always network-only ─────
const NETWORK_ONLY_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebase.googleapis.com',
  'www.googleapis.com',
];

// ── Offline fallback page ────────────────────────────
const OFFLINE_URL = '/ssc/offline.html';

// ────────────────────────────────────────────────────
//  INSTALL – pre-cache shell
// ────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then(cache =>
      cache.addAll(SHELL_ASSETS).catch(err => {
        console.warn('[SW] Shell pre-cache partial failure:', err);
      })
    )
  );
  self.skipWaiting();
});

// ────────────────────────────────────────────────────
//  ACTIVATE – clean up old caches
// ────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  const CURRENT_CACHES = [CACHE_SHELL, CACHE_CDN, CACHE_PAGES];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => !CURRENT_CACHES.includes(key))
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ────────────────────────────────────────────────────
//  FETCH – routing logic
// ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // 1️⃣  Firebase / auth → always hit network
  if (NETWORK_ONLY_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(fetch(request));
    return;
  }

  // 2️⃣  CDN / Fonts → stale-while-revalidate
  if (SWR_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(request, CACHE_CDN));
    return;
  }

  // 3️⃣  Same-origin HTML navigation → network-first, offline fallback
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
    // Try shell index as fallback
    const shellIndex = await caches.match('/ssc/');
    if (shellIndex) return shellIndex;
    // Generic offline page
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
//  Inline offline fallback HTML
// ────────────────────────────────────────────────────
function offlineFallbackHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Offline – SSC Prep</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{
    min-height:100vh;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:16px;
    background:#F0EEFF;color:#1a1240;
    font-family:'Plus Jakarta Sans',system-ui,sans-serif;
    text-align:center;padding:24px;
  }
  .icon{
    width:80px;height:80px;border-radius:20px;
    background:linear-gradient(135deg,#5B4EE8,#4338CA);
    display:flex;align-items:center;justify-content:center;
    font-size:36px;margin-bottom:8px;
  }
  h1{font-size:1.5rem;font-weight:800;color:#5B4EE8;}
  p{font-size:.95rem;color:#4a4580;max-width:300px;line-height:1.6;}
  button{
    margin-top:8px;padding:12px 28px;
    background:#5B4EE8;color:#fff;border:none;border-radius:12px;
    font-size:1rem;font-weight:600;cursor:pointer;
  }
  button:active{opacity:.85;}
</style>
</head>
<body>
  <div class="icon">⚡</div>
  <h1>You're Offline</h1>
  <p>No internet connection detected. Please check your network and try again.</p>
  <button onclick="location.reload()">Retry</button>
</body>
</html>`;
}

// ────────────────────────────────────────────────────
//  Push notifications (future use)
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
