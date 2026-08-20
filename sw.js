// sw.js — gestisce sia le notifiche push sia il caching per l'uso offline

const CACHE_NAME = 'jointtracker-v11';

// Chart.js e Leaflet/MarkerCluster NON sono precaricati qui: sono ~174 KiB usati solo
// nelle pagine Grafici/Mappa e vengono iniettati a runtime (vedi loadChartJs()/loadMapLibs()
// in app.js) solo quando servono davvero. Il fetch handler sotto li mette comunque in
// cache-first automaticamente alla prima richiesta reale, quindi restano disponibili offline.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/i18n.js',
  '/manifest.json',
  '/icon-192.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ========== INSTALLAZIONE: precarica i file essenziali ==========
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.log('Impossibile precaricare:', url, err);
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
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
