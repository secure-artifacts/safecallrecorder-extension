import { downloadFolderHint, sanitizeDownloadFolder } from "./download-path";

const DB_NAME = "SafeCallRecorderDownloadDir";
const STORE = "handles";
const HANDLE_KEY = "custom";

let cachedHandle: FileSystemDirectoryHandle | null | undefined;

function openDirDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function supportsDirectoryPicker(): boolean {
  if (typeof globalThis === "undefined") return false;
  const picker = (globalThis as unknown as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker;
  return typeof picker === "function";
}

export function directoryPickerUnavailableMessage(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const brave = /Brave/i.test(ua);
  if (brave) {
    return (
      "Brave 扩展页面暂不支持「选择其他位置」。请点「使用下载文件夹」保存到默认下载目录；" +
      "或在上方填写子文件夹名称（如 SafeCallRecorder）。若必须保存到 D 盘等自定义目录，可改用 Chrome 或 Edge。"
    );
  }
  return "当前浏览器不支持文件夹选择。请使用「使用下载文件夹」，或在上方填写下载子文件夹名称。";
}

export async function getSavedDownloadDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedHandle !== undefined) return cachedHandle;
  try {
    const db = await openDirDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((ok, no) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => ok((req.result as FileSystemDirectoryHandle | undefined) || null);
      req.onerror = () => no(req.error);
    });
    cachedHandle = handle;
    return handle;
  } catch {
    cachedHandle = null;
    return null;
  }
}

export async function ensureDownloadDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  requestIfNeeded = true
): Promise<boolean> {
  const current = await handle.queryPermission({ mode: "readwrite" });
  if (current === "granted") return true;
  if (!requestIfNeeded) return false;
  const next = await handle.requestPermission({ mode: "readwrite" });
  return next === "granted";
}

export async function pickDownloadDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!supportsDirectoryPicker()) {
    throw new Error(directoryPickerUnavailableMessage());
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const db = await openDirDb();
  await new Promise<void>((ok, no) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => ok();
    tx.onerror = () => no(tx.error);
  });
  cachedHandle = handle;
  return handle;
}

export async function clearSavedDownloadDirectory() {
  const db = await openDirDb();
  await new Promise<void>((ok, no) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => ok();
    tx.onerror = () => no(tx.error);
  });
  cachedHandle = null;
}

async function resolveTargetDirectory(
  root: FileSystemDirectoryHandle,
  subfolder?: string | null
): Promise<FileSystemDirectoryHandle> {
  const normalized = subfolder?.trim() ? sanitizeDownloadFolder(subfolder, true) : "";
  if (!normalized) return root;
  let dir = root;
  for (const part of normalized.split("/")) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

function safeFileName(fileName: string): string {
  return fileName.replace(/^[/\\]+/, "").split(/[/\\]/).pop() || "download";
}

export type WriteDownloadDirectoryResult =
  | { ok: true; fileName: string; pathLabel: string }
  | { ok: false; reason: "no_directory" | "permission_denied" | "write_failed"; message?: string };

export async function writeBlobToDownloadDirectory(
  blob: Blob,
  fileName: string,
  subfolder?: string | null,
  requestPermission = true
): Promise<WriteDownloadDirectoryResult> {
  const handle = await getSavedDownloadDirectory();
  if (!handle) return { ok: false, reason: "no_directory" };
  if (!(await ensureDownloadDirectoryPermission(handle, requestPermission))) {
    return { ok: false, reason: "permission_denied" };
  }

  const safeName = safeFileName(fileName);
  try {
    const dir = await resolveTargetDirectory(handle, subfolder);
    const fileHandle = await dir.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    const sub = subfolder?.trim() ? sanitizeDownloadFolder(subfolder, true) : "";
    const pathLabel = sub ? `${handle.name}/${sub}/${safeName}` : `${handle.name}/${safeName}`;
    return { ok: true, fileName: safeName, pathLabel };
  } catch (e) {
    return {
      ok: false,
      reason: "write_failed",
      message: e instanceof Error ? e.message : String(e)
    };
  }
}

export async function describeDownloadDirectory(subfolder?: string | null): Promise<string> {
  const handle = await getSavedDownloadDirectory();
  if (!handle) return downloadFolderHint(subfolder);
  const sub = subfolder?.trim() ? sanitizeDownloadFolder(subfolder, true) : "";
  return sub ? `${handle.name} / ${sub.replace(/\//g, " / ")} /` : `${handle.name} /`;
}

/** Test helper */
export function resetDownloadDirectoryCacheForTests() {
  cachedHandle = undefined;
}
