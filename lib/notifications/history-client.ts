import {
  pruneNotificationHistory,
  type NotificationHistoryItem,
} from "./history-core.ts";

const DATABASE_NAME = "thue-notification-history";
const DATABASE_VERSION = 1;
const STORE_NAME = "notifications";

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Không đọc được lịch sử thông báo."));
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Không cập nhật được lịch sử thông báo."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Cập nhật lịch sử thông báo đã bị hủy."));
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(STORE_NAME)) return;
      const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("receivedAt", "receivedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Không mở được lịch sử thông báo."));
  });
}

export async function readNotificationHistory(): Promise<NotificationHistoryItem[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  try {
    const readTransaction = database.transaction(STORE_NAME, "readonly");
    const readCompleted = transactionComplete(readTransaction);
    const values = await requestResult(readTransaction.objectStore(STORE_NAME).getAll());
    await readCompleted;

    const retained = pruneNotificationHistory(values);
    const retainedIds = new Set(retained.map((item) => item.id));
    const expiredIds = values
      .filter((value): value is { id: string } => Boolean(value && typeof value === "object" && "id" in value && typeof value.id === "string"))
      .map((value) => value.id)
      .filter((id) => !retainedIds.has(id));

    if (expiredIds.length) {
      const cleanupTransaction = database.transaction(STORE_NAME, "readwrite");
      const cleanupCompleted = transactionComplete(cleanupTransaction);
      const store = cleanupTransaction.objectStore(STORE_NAME);
      for (const id of expiredIds) store.delete(id);
      await cleanupCompleted;
    }
    return retained;
  } finally {
    database.close();
  }
}

export async function clearNotificationHistory() {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).clear();
    await completed;
  } finally {
    database.close();
  }
}
