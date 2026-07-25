const CACHE_NAME = "thue-v10";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
const HISTORY_DATABASE = "thue-notification-history";
const HISTORY_DATABASE_VERSION = 1;
const HISTORY_STORE = "notifications";
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Notification history transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Notification history transaction aborted."));
  });
}

function openHistoryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DATABASE, HISTORY_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(HISTORY_STORE)) return;
      const store = database.createObjectStore(HISTORY_STORE, { keyPath: "id" });
      store.createIndex("receivedAt", "receivedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Notification history database failed to open."));
  });
}

async function pruneNotificationHistory() {
  const database = await openHistoryDatabase();
  try {
    const transaction = database.transaction(HISTORY_STORE, "readwrite");
    const index = transaction.objectStore(HISTORY_STORE).index("receivedAt");
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    const request = index.openCursor(IDBKeyRange.upperBound(cutoff, true));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

async function notifyHistoryUpdated() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: "THUE_NOTIFICATION_HISTORY_UPDATED" });
}

async function saveNotificationHistory(payload) {
  const receivedAt = Date.now();
  const revisionId = typeof payload.revisionId === "string" && payload.revisionId ? payload.revisionId : null;
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : "notification";
  const item = {
    id: revisionId || `${tag}-${receivedAt}`,
    title: typeof payload.title === "string" && payload.title ? payload.title : "Thuế",
    body: typeof payload.body === "string" ? payload.body : "",
    url: typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/?source=notification",
    number: typeof payload.number === "string" && payload.number ? payload.number : null,
    revisionId,
    receivedAt,
  };

  const database = await openHistoryDatabase();
  try {
    const transaction = database.transaction(HISTORY_STORE, "readwrite");
    transaction.objectStore(HISTORY_STORE).put(item);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  await pruneNotificationHistory();
  await notifyHistoryUpdated();
  return item.id;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
      pruneNotificationHistory().catch(() => undefined),
    ]),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  if (!APP_SHELL.includes(url.pathname) && !url.pathname.startsWith("/_next/static/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "Có văn bản thuế mới đã sẵn sàng." };
  }

  const title = payload.title || "Thuế";
  const options = {
    body: payload.body || "Có văn bản thuế mới đã sẵn sàng.",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    tag: payload.tag || "thue-legal-update",
    renotify: false,
    data: {
      url: payload.url || "/?source=notification",
      number: payload.number || null,
      revisionId: payload.revisionId || null,
    },
  };

  const tasks = [self.registration.showNotification(title, options)];
  if (payload.tag !== "thue-notifications-enabled") {
    tasks.push(saveNotificationHistory(payload).catch((error) => {
      console.warn("[notification-history-save-failed]", error instanceof Error ? error.message : String(error));
    }));
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || "/?source=notification", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        const targetClient = "navigate" in client ? await client.navigate(target) : client;
        if (!targetClient) continue;
        await targetClient.focus();
        targetClient.postMessage({
          type: "THUE_OPEN_DOCUMENT",
          number: data.number || null,
          url: target,
        });
        return;
      }
      await self.clients.openWindow(target);
    }),
  );
});
