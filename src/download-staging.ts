const DB_NAME = "SafeCallRecorderDownloadStaging";
const STORE = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function stageDownloadBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((ok, no) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => ok();
    tx.onerror = () => no(tx.error);
  });
}

export async function readStagedDownloadBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((ok, no) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => ok((req.result as Blob | undefined) || null);
    req.onerror = () => no(req.error);
  });
}

export async function clearStagedDownloadBlob(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((ok, no) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => ok();
    tx.onerror = () => no(tx.error);
  });
}

/** Test helper */
export async function clearAllStagedDownloadsForTests() {
  const db = await openDb();
  await new Promise<void>((ok, no) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => ok();
    tx.onerror = () => no(tx.error);
  });
}
