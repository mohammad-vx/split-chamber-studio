// Serves the browser library (IndexedDB, written by host-web.js) to <img> and <video> under ./lib/<key>,
// with byte ranges so videos seek. Everything else goes to the network untouched.
const DB = 'split-chamber-studio', DB_VERSION = 1;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, DB_VERSION);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('files')) d.createObjectStore('files'); if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function getFile(key) {
  const d = await openDb();
  try {
    return await new Promise((resolve, reject) => { const r = d.transaction('files').objectStore('files').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  } finally { d.close(); }
}

async function serve(key, req) {
  const blob = await getFile(key);
  if (!blob) return new Response('Not found', { status: 404 });
  const size = blob.size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  const base = { 'Content-Type': blob.type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (!m || size === 0) return new Response(blob, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  let start = 0, end = size - 1;
  if (m[1] === '' && m[2] !== '') start = Math.max(0, size - Number(m[2]));
  else { start = Number(m[1] || 0); if (m[2] !== '') end = Math.min(size - 1, Number(m[2])); }
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), { status: 206, headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` } });
}

self.addEventListener('fetch', (e) => {
  const base = new URL('./lib/', self.registration.scope).href;
  if (!e.request.url.startsWith(base)) {
    // the app's own files: always revalidate (cheap 304s), so an update never mixes old and new modules
    if (e.request.method === 'GET' && e.request.url.startsWith(self.registration.scope) && !e.request.headers.get('range')) {
      const fresh = e.request.mode === 'navigate' ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(e.request, { cache: 'no-cache' });
      e.respondWith(fresh.catch(() => fetch(e.request)));
    }
    return;
  }
  const key = decodeURIComponent(e.request.url.slice(base.length).split('?')[0]);
  e.respondWith(serve(key, e.request).catch(() => new Response('Error', { status: 500 })));
});

// "batch finished" notification: bring the Studio tab forward (or open it)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = all.find((c) => c.url.startsWith(self.registration.scope));
    if (tab) return tab.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
