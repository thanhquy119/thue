export type ReadingStateRecord = {
  documentId: string;
  bookmarked: boolean;
  documentNumber?: string;
  documentTitle?: string;
  sourceUrl?: string;
  progress: {
    provisionId: string | null;
    blockIndex: number;
  };
  updatedAt: string;
};

const DATABASE_NAME = "thue-ro";
const STORE_NAME = "reading-state-simple";
const DATABASE_VERSION = 3;
const READING_STATE_EVENT = "thue-ro-reading-state";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "documentId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function loadReadingStates() {
  if (!("indexedDB" in window)) return [] as ReadingStateRecord[];
  return withStore<ReadingStateRecord[]>("readonly", (store) => store.getAll());
}

function enrichRecord(record: ReadingStateRecord): ReadingStateRecord {
  const documentNumber = record.documentNumber || document.querySelector<HTMLElement>(".documentKicker")?.textContent?.trim();
  const documentTitle = record.documentTitle || document.querySelector<HTMLElement>(".detailHeader h2")?.textContent?.trim();
  const sourceUrl = record.sourceUrl || document.querySelector<HTMLAnchorElement>(".sourceLink")?.href;
  return {
    ...record,
    ...(documentNumber ? { documentNumber } : {}),
    ...(documentTitle ? { documentTitle } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export async function putReadingState(record: ReadingStateRecord) {
  if (!("indexedDB" in window)) return;
  const enriched = enrichRecord(record);
  await withStore<IDBValidKey>("readwrite", (store) => store.put(enriched));
  window.dispatchEvent(new CustomEvent<ReadingStateRecord>(READING_STATE_EVENT, { detail: enriched }));
}
