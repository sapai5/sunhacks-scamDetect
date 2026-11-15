// Service worker: makes the installed app open instantly and survive flaky venue Wi-Fi.
// Caches only GET requests for the app shell, built assets, icons and fonts.
// Never touches the Lambda calls (POST) or Transcribe (WebSocket): those always go to the network.
// Built by Vite as its own entry to dist/sw.js (vite.config.ts); typechecked with tsconfig.sw.json.
// A module (export {}) so this `self` shadows the global one; the built file has no imports or exports.
export {};
declare const self: ServiceWorkerGlobalScope;

const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// --- Call alerts (Web Push from the push Lambda; see lib/webPush.ts) -----------------------------
// Payload: { title, body, url, tag, kind }. One tag per call, so a newer alert replaces the older one.
interface AlertPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind?: string;
}

self.addEventListener('push', (e) => {
  let p: AlertPayload = { title: 'ScamDetermine', body: 'Open the app to see your call.', url: '/elder/live', tag: 'scamdetermine' };
  try {
    p = { ...p, ...(e.data?.json() as Partial<AlertPayload>) };
  } catch {
    /* not JSON: show the default */
  }
  const urgent = p.kind === 'red' || p.kind === 'takeover';
  e.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: p.url },
      // Stays until tapped while the call is risky; `renotify` buzzes again when a newer alert replaces one.
      requireInteraction: urgent,
      renotify: true,
    } as NotificationOptions & { renotify: boolean }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data as { url?: string } | null)?.url ?? '/elder/live', self.location.origin);
  e.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === url.origin);
      if (open) {
        // The app routes in place (App.tsx listens), so the running call isn't reloaded.
        open.postMessage({ type: 'open', path: url.pathname + url.search });
        await open.focus();
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page loads: network first (so deploys show up), cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(SHELL).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Hashed build assets are immutable: cache first.
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if ((sameOrigin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) || isFont) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok || res.type === 'opaque') {
              const copy = res.clone();
              void caches.open(RUNTIME).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
