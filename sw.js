const CACHE = "house-app-v1.17.1";
const ASSETS = [
  "./",
  "./index.html",
  "./offline.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./schema/import_v1.schema.json",
  "./methods/generic/method.json",
  "./js/schema.js",
  "./js/pii.js",
  "./js/defaults.js",
  "./js/csv.js",
  "./js/b13.js",
  "./js/validate.js",
  "./js/scoring.js",
  "./js/affordability.js",
  "./js/scanner.js",
  "./js/slots.js",
  "./js/counting.js",
  "./js/checkpoints.js",
  "./js/module333.js",
  "./js/xlsx.js",
  "./js/backup.js",
  "./js/method-pack.js",
  "./js/speech.js",
  "./js/chinese-num.js",
  "./js/dom.js",
  "./js/thresholds.js",
  "./js/controller.js",
  "./js/lists.js",
  "./js/merge.js",
  "./js/fields.js",
  "./js/persisted.js",
  "./js/egress.js",
  "./js/invariants.js",
  "./js/finance-trust.js",
  "./js/items-for-viewing.js",
  "./js/rank-eligible.js",
  "./js/zip.js",
  "./js/ui-logic.js",
  "./js/notes-import.js",
  "./js/notes-export.js",
  "./js/import-file.js",
  "./js/ui-flow.js",
  "./js/coach.js",
  "./js/price-log.js",
  "./js/sites.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("house-app-") && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    let cached = null;
    try {
      cached = await caches.match(e.request, { cacheName: CACHE });
    } catch {
      cached = null;
    }
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      if (res && res.status === 200 && !e.request.headers.get("range")) {
        try {
          const copy = res.clone();
          const cache = await caches.open(CACHE);
          await cache.put(e.request, copy);
        } catch {
          /* 快取失敗仍回傳已取得的回應 */
        }
      }
      return res;
    } catch {
      if (e.request.mode === "navigate") {
        try {
          const cache = await caches.open(CACHE);
          const offline = await cache.match("./offline.html");
          if (offline) return offline;
        } catch {
          /* 快取無法開啟時退回下方 503 回應 */
        }
      }
      return new Response("離線", { status: 503, statusText: "Service Unavailable", headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
