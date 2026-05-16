/*
  Service worker da PWA.
  Este ficheiro guarda os ficheiros principais em cache para a app abrir offline.
*/

/* Define o nome da cache; muda este valor quando alterares ficheiros importantes. */
const CACHE_NAME = "flight-data-recorder-v1";

/* Define os ficheiros que devem ficar disponíveis offline. */
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/* Instala o service worker e guarda os ficheiros principais em cache. */
self.addEventListener("install", (event) => {
  /* Espera até todos os ficheiros serem guardados. */
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );

  /* Activa o novo service worker mais depressa. */
  self.skipWaiting();
});

/* Remove caches antigas quando uma nova versão fica activa. */
self.addEventListener("activate", (event) => {
  /* Limpa qualquer cache cujo nome já não seja o actual. */
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );

  /* Garante que o service worker controla páginas abertas. */
  self.clients.claim();
});

/* Intercepta pedidos e devolve cache quando possível. */
self.addEventListener("fetch", (event) => {
  /* Só trata pedidos GET, porque outros métodos não devem ser cacheados. */
  if (event.request.method !== "GET") return;

  /* Tenta rede primeiro e usa cache se a rede falhar. */
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        /* Guarda uma cópia da resposta na cache. */
        const responseClone = response.clone();

        /* Actualiza a cache em segundo plano. */
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });

        /* Devolve a resposta da rede. */
        return response;
      })
      .catch(() => {
        /* Se estiver offline, tenta devolver resposta da cache. */
        return caches.match(event.request).then((cached) => {
          return cached || caches.match("./index.html");
        });
      })
  );
});
