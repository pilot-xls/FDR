/* Service worker for offline PWA support. */

/* Defines the cache version for this release. */
const CACHE_NAME = "flight-data-recorder-v4";

/* Defines the local files required to open the app offline. */
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

/* Installs the service worker and caches the app shell. */
self.addEventListener("install", (event) => {
  /* Opens cache and stores the app files. */
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));

  /* Activates the new worker immediately. */
  self.skipWaiting();
});

/* Activates the worker and removes old caches. */
self.addEventListener("activate", (event) => {
  /* Deletes caches that do not match the current version. */
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));

  /* Takes control of open clients. */
  self.clients.claim();
});

/* Handles fetch requests for offline use. */
self.addEventListener("fetch", (event) => {
  /* Only handles GET requests. */
  if (event.request.method !== "GET") return;

  /* Does not cache external airport lookup calls. */
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  /* Uses network first and cache fallback. */
  event.respondWith(fetch(event.request).then((response) => {
    /* Copies the response for caching. */
    const copy = response.clone();

    /* Updates cache in the background. */
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));

    /* Returns the live response. */
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))));
});
