/*
 * Starlog service worker: opens instantly and works with no signal.
 * - The app itself (HTML, scripts, styles, icons) is kept on the device.
 * - Your sky, notes and tasks load fresh from the server when online, and from the
 *   last copy on this device when offline. Logging out clears that copy.
 */
const VERSION = "v1";
const SHELL = `starlog-shell-${VERSION}`;
const DATA = `starlog-data-${VERSION}`;
const scope = new URL(self.registration.scope).pathname;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("starlog-") && !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const putIn = (name, req, res) => {
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(name).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path.startsWith(`${scope}api/`)) {
    // Signing in or out goes straight to the server; signing out forgets the offline copy.
    if (/\/api\/(login|logout|callback)/.test(path)) {
      if (path.endsWith("/logout")) e.waitUntil(caches.delete(DATA));
      return;
    }
    e.respondWith(
      fetch(req)
        .then((res) => putIn(DATA, req, res))
        .catch(() => caches.match(req, { cacheName: DATA }).then((r) => r || Response.error())),
    );
    return;
  }

  if (req.mode === "navigate") {
    // Fresh page when online; the saved app when offline.
    e.respondWith(
      fetch(req)
        .then((res) => putIn(SHELL, scope, res))
        .catch(() => caches.match(scope, { cacheName: SHELL }).then((r) => r || Response.error())),
    );
    return;
  }

  // Built files have unique names, so a saved copy is always right. Others refresh in the background.
  e.respondWith(
    caches.match(req, { cacheName: SHELL }).then((hit) => {
      const net = fetch(req).then((res) => putIn(SHELL, req, res)).catch(() => hit);
      return path.startsWith(`${scope}assets/`) && hit ? hit : hit || net;
    }),
  );
});
