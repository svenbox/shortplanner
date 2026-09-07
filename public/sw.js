/* Shortplanner service worker.
   Mål: sidan (och senast hämtade call sheet / stripboard / dagsmanus) ska
   gå att läsa utan täckning. Ingen offline-redigering -- skrivningar kräver
   nät.

   Cachestrategi:
   - /api/version    -> alltid nätet (det är färskhetssignalen)
   - övriga /api/    -> nät-först, faller tillbaka till senast cachade svar
   - HTML-navigering -> nät-först, faller tillbaka till cachat skal
   - /css/, /js/ ... -> cache-först + bakgrundsrevalidering (no-store) så
                        nästa laddning är färsk

   Nödbroms: om /api/version svarar {disabled:true} avregistrerar sig
   workern själv och rensar sina cachar (sätt SW_DISABLED=1 i serverns miljö). */
"use strict";

const SHELL = [
  "/", "/index.html", "/view.html", "/css/app.css",
  "/js/app.js", "/js/view.js", "/js/stripboard-core.js", "/js/stripboard.js", "/js/callsheet.js",
  "/js/script.js", "/js/dpr.js", "/js/shootday.js",
  "/js/vendor/qrcode-generator.js", "/js/vendor/pdf.min.js",
  "/manifest.json", "/icon.svg"
];
const DATA_CACHE = "sp-data-v1";

let cachedBuildId = null;
async function currentBuildId() {
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    if (d && d.disabled) return "__disabled__";
    return (d && d.version) || null;
  } catch (e) { return null; }
}
async function getBuildId() {
  if (!cachedBuildId) cachedBuildId = await currentBuildId();
  return cachedBuildId;
}
function shellCacheName(id) { return "sp-shell-" + (id || "boot"); }

async function precacheShell(id, forceFresh) {
  const c = await caches.open(shellCacheName(id));
  await c.addAll(forceFresh ? SHELL.map(u => new Request(u, { cache: "no-store" })) : SHELL);
}
async function dropOtherCaches(keepNames) {
  const keep = new Set(keepNames);
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith("sp-") && !keep.has(k)).map(k => caches.delete(k)));
}
async function selfDestruct() {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith("sp-")).map(k => caches.delete(k)));
  await self.registration.unregister();
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const id = await currentBuildId();
    if (id === "__disabled__") return;
    cachedBuildId = id;
    try { await precacheShell(id, false); } catch (_) { /* offline vid install -> ta det vid fetch */ }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const id = await currentBuildId();
    if (id === "__disabled__") { await selfDestruct(); return; }
    cachedBuildId = id;
    await dropOtherCaches([shellCacheName(id), DATA_CACHE]);
    await self.clients.claim();
  })());
});

/* Klienten skickar "refreshShell" när den upptäckt att serverns build-id
   ändrats -> vi hämtar in det nya skalet i bakgrunden och säger till. */
self.addEventListener("message", (e) => {
  if (e.data !== "refreshShell") return;
  e.waitUntil((async () => {
    cachedBuildId = null;
    const id = await currentBuildId();
    if (!id || id === "__disabled__") { if (id === "__disabled__") await selfDestruct(); return; }
    cachedBuildId = id;
    const name = shellCacheName(id);
    const already = await caches.has(name);
    if (!already) { try { await precacheShell(id, true); } catch (_) { /* offline: tas vid fetch */ } }
    /* ALLTID städa bort gamla skalcachar -- annars ligger de kvar och
       "ny version"-bannern återkommer vid varje omladdning. */
    await dropOtherCaches([name, DATA_CACHE]);
    (await self.clients.matchAll()).forEach(c => c.postMessage({ type: "shell-updated" }));
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/api/version") return; // alltid nätet

  if (url.pathname.startsWith("/api/")) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { (await caches.open(DATA_CACHE)).put(req, res.clone()); }
        return res;
      } catch (_) {
        const cached = await caches.match(req);
        return cached || new Response(JSON.stringify({ error: "offline" }),
          { status: 503, headers: { "Content-Type": "application/json" } });
      }
    })());
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch (_) {
        return (await caches.match(req, { ignoreSearch: true })) ||
               (await caches.match(url.pathname.indexOf("/share/") === 0 ? "/view.html" : "/index.html")) ||
               Response.error();
      }
    })());
    return;
  }

  if (url.pathname.indexOf("/css/") === 0 || url.pathname.indexOf("/js/") === 0 ||
      url.pathname === "/manifest.json" || url.pathname === "/icon.svg") {
    e.respondWith((async () => {
      /* Läs/skriv BARA i den aktuella build-id:ns skalcache -- aldrig via
         caches.match() över alla cachar, för då kan en kvarbliven gammal
         skalcache serva stale kod i all evighet. ignoreSearch: staging
         lägger ?v=<ts> på asset-URL:erna, prod inte. */
      const cache = await caches.open(shellCacheName(await getBuildId()));
      const cached = await cache.match(req, { ignoreSearch: true });
      const net = fetch(new Request(req, { cache: "no-store" })).then(async res => {
        if (res.ok) {
          await cache.put(req, res.clone());
          const served = res.headers.get("X-App-Version");
          if (served && cachedBuildId && served !== cachedBuildId) {
            /* Servern har deployats om sedan SW:n startade -- byt build-id så
               nästa hämtning går mot rätt cache; städningen sker via
               checkShellFreshness -> "refreshShell". */
            cachedBuildId = served;
          }
        }
        return res;
      }).catch(() => null);
      return cached || (await net) || Response.error();
    })());
    return;
  }
});
