// sw.js — gestisce sia le notifiche push sia il caching per l'uso offline

const CACHE_NAME = 'jointtracker-v2';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js'
];

// ========== INSTALLAZIONE: precarica i file essenziali ==========
self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.log('Impossibile precaricare:', url, err);
          });
        })
      );
    })
  );
});

// ========== ATTIVAZIONE: rimuove le cache vecchie ==========
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// ========== FETCH: strategia diversa per API vs risorse statiche ==========
self.addEventListener('fetch', function (event) {
  const url = event.request.url;

  // Le chiamate a Supabase e ai servizi di geocoding devono SEMPRE andare in rete:
  // i dati devono essere freschi, mai serviti dalla cache.
  if (url.includes('supabase.co') || url.includes('nominatim.openstreetmap.org')) {
    return; // lascia che il browser gestisca la richiesta normalmente
  }

  // Per tutto il resto (app shell, librerie): cache-first, con aggiornamento in background
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      const networkFetch = fetch(event.request).then(function (response) {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(function () {
        return cached; // offline: usa la cache se la rete fallisce
      });

      return cached || networkFetch;
    })
  );
});

// ========== PUSH: ricezione notifiche (invariato) ==========
self.addEventListener('push', function (event) {
  let data = { title: '🌿 JointTracker', body: 'Non hai ancora segnato nulla oggi!' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // fallback al messaggio di default se il payload non è JSON valido
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' }
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
