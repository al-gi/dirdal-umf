/* Tenestearbeidar for Dirdal UMF.
   Mellomlagrar berre skallet (HTML, CSS, JS, ikon, manifest) så sida kjem fort opp
   og har eit enkelt reservenett-svar. Aldri innlogging, database, API eller
   adresser med token – dei skal alltid gå rett til nettverket, utan mellomlager.
   Auk CACHE saman med ?v= i index.html når skallet endrar seg. */
'use strict';

const CACHE = 'dumf-shell-20261110a';
const SCOPE = self.registration.scope;
const VERSION_QUERY = 'v=20261110a';

const SHELL = [
  new URL('./', SCOPE).href,
  new URL('index.html', SCOPE).href,
  new URL('styles.css?' + VERSION_QUERY, SCOPE).href,
  new URL('app.js?' + VERSION_QUERY, SCOPE).href,
  new URL('bible.js?' + VERSION_QUERY, SCOPE).href,
  new URL('verses.js?' + VERSION_QUERY, SCOPE).href,
  new URL('places.js?' + VERSION_QUERY, SCOPE).href,
  new URL('config.js?' + VERSION_QUERY, SCOPE).href,
  new URL('pwa.js?' + VERSION_QUERY, SCOPE).href,
  new URL('push.js?' + VERSION_QUERY, SCOPE).href,
  new URL('manifest.webmanifest', SCOPE).href,
  new URL('icons/icon-192.png', SCOPE).href,
  new URL('icons/icon-512.png', SCOPE).href,
  new URL('icons/icon-maskable-192.png', SCOPE).href,
  new URL('icons/icon-maskable-512.png', SCOPE).href,
  new URL('icons/apple-touch-icon.png', SCOPE).href,
];

const SHELL_KEYS = new Set(SHELL.map((href) => {
  const url = new URL(href);
  return url.pathname + url.search;
}));

const AUTH_QUERY = ['code', 'token', 'access_token', 'refresh_token', 'provider_token', 'error', 'error_code', 'error_description'];

function hasAuthQuery(url) {
  for (let i = 0; i < AUTH_QUERY.length; i++) {
    if (url.searchParams.has(AUTH_QUERY[i])) return true;
  }
  return url.searchParams.get('type') === 'recovery';
}

function shellFallback() {
  return caches.open(CACHE).then((cache) => cache.match(new URL('./', SCOPE))
    .then((hit) => hit || cache.match(new URL('index.html', SCOPE)))
    .then((hit) => hit || offlineResponse()));
}

function offlineResponse() {
  const html = '<!doctype html><html lang="nn"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<meta name="theme-color" content="#1e6b4f"><title>Dirdal UMF</title>'
    + '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f5f2;color:#15201a;font-family:system-ui,sans-serif">'
    + '<main style="max-width:28rem;padding:2rem 1.25rem">'
    + '<h1 style="font-size:1.35rem;margin:0 0 .6rem">Ingen nett</h1>'
    + '<p style="margin:0 0 1rem;line-height:1.5">Dirdal Unge Mannsforening er ikkje tilgjengeleg utan nett akkurat no. Koople til nett og prøv igjen.</p>'
    + '<button type="button" onclick="location.reload()" style="background:#1e6b4f;color:#fff;border:0;border-radius:12px;padding:.7rem 1rem;font:inherit;font-weight:700">Prøv igjen</button>'
    + '</main></body></html>';
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function networkFetch(req) {
  // Ny Request, ikkje navigate-modus: cache:'no-store' er då lov i Safari òg,
  // og GitHub Pages sitt HTTP-lager kan ikkje servere gammal index.html.
  return fetch(new Request(req.url, { cache: 'no-store', credentials: 'same-origin', redirect: 'follow' }));
}

function storeShell(res) {
  if (!res || !res.ok || res.type !== 'basic' || res.redirected) return Promise.resolve();
  return caches.open(CACHE).then((cache) => Promise.all([
    cache.put(new URL('./', SCOPE), res.clone()),
    cache.put(new URL('index.html', SCOPE), res.clone()),
  ]));
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // CDN (skrifter, Leaflet, Supabase-biblioteket), kartfliser og API er annan origin.
  // Ikkje rør dei, så nettlesaren hentar dei som før.
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range')) return;

  const authNav = hasAuthQuery(url);
  const navigate = req.mode === 'navigate' || req.destination === 'document';

  // Passord-lenkjer og andre auth-adresser: aldri skriv dei i mellomlageret.
  if (authNav) {
    if (!navigate) return;
    event.respondWith(networkFetch(req).catch(() => shellFallback()));
    return;
  }

  if (navigate) {
    event.respondWith((async () => {
      try {
        const res = await networkFetch(req);
        try { await storeShell(res.clone()); } catch (err) { /* skalet er alt i lageret frå install */ }
        return res;
      } catch (err) {
        return shellFallback();
      }
    })());
    return;
  }

  // Berre kjende skallfiler, med spørjestreng (?v=) som del av nøkkelen.
  // Ein ny ?v= er derfor eit nytt treff og blir henta frå nettet, ikkje frå gammalt lager.
  const key = url.pathname + url.search;
  if (!SHELL_KEYS.has(key)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await networkFetch(req);
    if (res.ok && res.type === 'basic' && !res.redirected) await cache.put(req, res.clone());
    return res;
  })());
});

// Push er ikkje ein del av mellomlageret. Teksten kjem frå serveren og blir avgrensa her.
const PUSH_HASH = { '#oversikt': 1, '#lesing': 1, '#wiki': 1, '#forum': 1, '#medlemer': 1 };
function pushNote(data) {
  const title = data && typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 60) : 'Dirdal UMF';
  const body = data && typeof data.body === 'string' && data.body.trim() ? data.body.trim().slice(0, 140) : 'Det er nytt på sida.';
  const hash = data && PUSH_HASH[data.hash] ? data.hash : '#oversikt';
  const tag = data && typeof data.tag === 'string' ? data.tag.replace(/[^\w:.-]/g, '').slice(0, 64) : 'dumf';
  return { title: title, body: body, hash: hash, tag: tag || 'dumf' };
}
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (err) { data = {}; }
  const note = pushNote(data);
  event.waitUntil(self.registration.showNotification(note.title, {
    body: note.body,
    tag: note.tag,
    renotify: false,
    lang: 'nn',
    icon: new URL('icons/icon-192.png', SCOPE).href,
    badge: new URL('icons/icon-192.png', SCOPE).href,
    data: { url: new URL('./' + note.hash, SCOPE).href },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url || new URL('./', SCOPE).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (let i = 0; i < list.length; i++) {
      const client = list[i];
      if (client.url.indexOf(self.registration.scope) === 0 && 'focus' in client) {
        if ('navigate' in client) client.navigate(target);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
