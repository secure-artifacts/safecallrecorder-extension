import { MessageType, requestId, type Request } from "./messages";
import { DEFAULT_SETTINGS, type AppSettings } from "./types";

export type StorageErrorCode =
  | "EXTENSION_CONTEXT_MISSING"
  | "CHROME_STORAGE_UNAVAILABLE"
  | "STORAGE_PERMISSION_MISSING"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "OFFSCREEN_STORAGE_REQUEST_FAILED";

export class ExtensionStorageError extends Error {
  code: StorageErrorCode;
  details?: string;
  constructor(code: StorageErrorCode, message: string, details?: string) {
    super(message);
    this.name = "ExtensionStorageError";
    this.code = code;
    this.details = details;
  }
}

export function isExtensionContext(): boolean {
  return Boolean(globalThis.chrome?.runtime?.id);
}

export function hasChromeStorageLocal(): boolean {
  return Boolean(isExtensionContext() && chrome.storage?.local);
}

export function diagnoseStorageEnvironment() {
  const ext = typeof chrome !== "undefined" ? chrome : undefined;
  return {
    context: guessContext(),
    url: typeof location !== "undefined" ? location.href : "(no location)",
    chromeExists: typeof chrome !== "undefined",
    runtimeExists: Boolean(ext?.runtime),
    runtimeId: ext?.runtime?.id || null,
    storageExists: Boolean(ext?.storage),
    storageLocalExists: Boolean(ext?.storage?.local),
    manifestVersion: 3
  };
}

function guessContext(): string {
  try {
    if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope && !(self as unknown as { document?: unknown }).document) {
      return "web-worker";
    }
  } catch {
    /* ignore */
  }
  if (typeof location !== "undefined") {
    const href = location.href;
    if (href.includes("offscreen.html")) return "offscreen";
    if (href.includes("dashboard.html")) return "dashboard";
    if (href.startsWith("file:")) return "file-page";
    if (href.startsWith("http")) return "http-page";
  }
  if (typeof ServiceWorkerGlobalScope !== "undefined") return "service-worker";
  return "unknown";
}

function userMessage(code: StorageErrorCode): string {
  switch (code) {
    case "EXTENSION_CONTEXT_MISSING":
      return "当前页面不是从浏览器扩展中打开的。请在扩展管理页加载 dist 目录，然后点击扩展图标打开。";
    case "CHROME_STORAGE_UNAVAILABLE":
    case "STORAGE_PERMISSION_MISSING":
      return "浏览器扩展存储功能不可用，请重新加载插件后重试。";
    case "STORAGE_READ_FAILED":
      return "读取扩展设置失败，已使用默认设置。";
    case "STORAGE_WRITE_FAILED":
    case "OFFSCREEN_STORAGE_REQUEST_FAILED":
      return "录音正在进行，但状态信息暂时无法保存。";
    default:
      return "浏览器扩展存储功能不可用，请重新加载插件后重试。";
  }
}

function logStorageIssue(where: string, error: unknown) {
  const env = diagnoseStorageEnvironment();
  console.error("[ExtensionStorage]", {
    where,
    env,
    error,
    stack: error instanceof Error ? error.stack : undefined
  });
}

async function viaServiceWorker<T>(
  type: typeof MessageType.StorageGet | typeof MessageType.StorageSet | typeof MessageType.StorageRemove,
  payload: Record<string, unknown>
): Promise<T> {
  if (!isExtensionContext()) {
    throw new ExtensionStorageError("EXTENSION_CONTEXT_MISSING", userMessage("EXTENSION_CONTEXT_MISSING"));
  }
  try {
    const res = await chrome.runtime.sendMessage({
      type,
      target: "service-worker",
      requestId: requestId(),
      payload
    } satisfies Request);
    if (!res?.ok) {
      throw new ExtensionStorageError(
        "OFFSCREEN_STORAGE_REQUEST_FAILED",
        userMessage("OFFSCREEN_STORAGE_REQUEST_FAILED"),
        res?.error?.message || res?.error?.details
      );
    }
    return res.data as T;
  } catch (e) {
    if (e instanceof ExtensionStorageError) throw e;
    logStorageIssue("viaServiceWorker", e);
    throw new ExtensionStorageError(
      "OFFSCREEN_STORAGE_REQUEST_FAILED",
      userMessage("OFFSCREEN_STORAGE_REQUEST_FAILED"),
      e instanceof Error ? e.message : String(e)
    );
  }
}

/** Direct local access — only for service worker / dashboard when API exists. */
export async function storageGetDirect(keys: string | string[] | Record<string, unknown>) {
  if (!hasChromeStorageLocal()) {
    throw new ExtensionStorageError("CHROME_STORAGE_UNAVAILABLE", userMessage("CHROME_STORAGE_UNAVAILABLE"), JSON.stringify(diagnoseStorageEnvironment()));
  }
  try {
    return await chrome.storage.local.get(keys);
  } catch (e) {
    logStorageIssue("storageGetDirect", e);
    throw new ExtensionStorageError("STORAGE_READ_FAILED", userMessage("STORAGE_READ_FAILED"), e instanceof Error ? e.message : String(e));
  }
}

export async function storageSetDirect(items: Record<string, unknown>) {
  if (!hasChromeStorageLocal()) {
    throw new ExtensionStorageError("CHROME_STORAGE_UNAVAILABLE", userMessage("CHROME_STORAGE_UNAVAILABLE"), JSON.stringify(diagnoseStorageEnvironment()));
  }
  try {
    await chrome.storage.local.set(items);
  } catch (e) {
    logStorageIssue("storageSetDirect", e);
    throw new ExtensionStorageError("STORAGE_WRITE_FAILED", userMessage("STORAGE_WRITE_FAILED"), e instanceof Error ? e.message : String(e));
  }
}

export async function storageRemoveDirect(keys: string | string[]) {
  if (!hasChromeStorageLocal()) {
    throw new ExtensionStorageError("CHROME_STORAGE_UNAVAILABLE", userMessage("CHROME_STORAGE_UNAVAILABLE"), JSON.stringify(diagnoseStorageEnvironment()));
  }
  try {
    await chrome.storage.local.remove(keys);
  } catch (e) {
    logStorageIssue("storageRemoveDirect", e);
    throw new ExtensionStorageError("STORAGE_WRITE_FAILED", userMessage("STORAGE_WRITE_FAILED"), e instanceof Error ? e.message : String(e));
  }
}

/**
 * Context-aware get: uses chrome.storage.local when available,
 * otherwise asks the service worker (for offscreen / limited contexts).
 */
export async function storageGet(keys: string | string[] | Record<string, unknown>) {
  if (hasChromeStorageLocal()) return storageGetDirect(keys);
  if (isExtensionContext()) return viaServiceWorker<Record<string, unknown>>(MessageType.StorageGet, { keys });
  throw new ExtensionStorageError("EXTENSION_CONTEXT_MISSING", userMessage("EXTENSION_CONTEXT_MISSING"));
}

export async function storageSet(items: Record<string, unknown>) {
  if (hasChromeStorageLocal()) return storageSetDirect(items);
  if (isExtensionContext()) {
    await viaServiceWorker(MessageType.StorageSet, { items });
    return;
  }
  throw new ExtensionStorageError("EXTENSION_CONTEXT_MISSING", userMessage("EXTENSION_CONTEXT_MISSING"));
}

export async function storageRemove(keys: string | string[]) {
  if (hasChromeStorageLocal()) return storageRemoveDirect(keys);
  if (isExtensionContext()) {
    await viaServiceWorker(MessageType.StorageRemove, { keys });
    return;
  }
  throw new ExtensionStorageError("EXTENSION_CONTEXT_MISSING", userMessage("EXTENSION_CONTEXT_MISSING"));
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const data = (await storageGet("settings")) as { settings?: AppSettings };
    return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  } catch (e) {
    logStorageIssue("getSettings", e);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const cur = await getSettings();
  const next = { ...cur, ...partial };
  await storageSet({ settings: next });
  return next;
}

/** Non-critical live session mirror — never throws into MediaRecorder path. */
export function mirrorLiveSession(sessionId: string, session: unknown) {
  void storageSet({ [`live:${sessionId}`]: session }).catch((e) => logStorageIssue("mirrorLiveSession", e));
}

export function clearLiveSession(sessionId: string) {
  void storageRemove(`live:${sessionId}`).catch((e) => logStorageIssue("clearLiveSession", e));
}

export async function setSessionSourceTab(meta: {
  latestSourceTabId: number | null;
  latestSourceTabTitle: string;
  latestSourceTabUrl: string;
}) {
  if (!isExtensionContext()) return;
  if (chrome.storage?.session) {
    await chrome.storage.session.set(meta);
    return;
  }
  // Fallback if session store unavailable
  await storageSet({ sourceTabMeta: meta });
}

export async function getSessionSourceTab() {
  if (chrome.storage?.session) {
    return chrome.storage.session.get(["latestSourceTabId", "latestSourceTabTitle", "latestSourceTabUrl"]);
  }
  const data = (await storageGet("sourceTabMeta")) as { sourceTabMeta?: Record<string, unknown> };
  return data.sourceTabMeta || {};
}
