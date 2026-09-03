import { buildDownloadPath, browserDownloadSettingsHint } from "./download-path";
import { writeBlobToDownloadDirectory } from "./download-directory";
import { clearStagedDownloadBlob, readStagedDownloadBlob, stageDownloadBlob } from "./download-staging";
import { getSettings, isExtensionContext } from "./extension-storage";
import { MessageType, requestId, type Request, type Response } from "./messages";
export type SaveDownloadMethod = "filesystem" | "chrome.downloads" | "anchor";

export type SaveDownloadResult =
  | {
      ok: true;
      filename: string;
      method: SaveDownloadMethod;
      downloadId?: number;
      pathLabel?: string;
    }
  | { ok: false; error: { code: string; message: string } };

function hasDownloadsApi(): boolean {
  return Boolean(chrome?.downloads?.download);
}

function anchorDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export type SaveDownloadOptions = {
  saveAs?: boolean;
  /** When false, do not prompt for folder permission (auto downloads after stop). */
  requestDirectoryPermission?: boolean;
};

export async function saveBlobWithChromeDownloads(
  blob: Blob,
  filename: string,
  downloadFolder?: string | null
): Promise<SaveDownloadResult> {
  const url = URL.createObjectURL(blob);
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: buildDownloadPath(filename, downloadFolder),
      saveAs: false,
      conflictAction: "uniquify"
    });
    if (typeof downloadId !== "number") {
      return { ok: false, error: { code: "DOWNLOAD_NOT_STARTED", message: "浏览器没有返回有效的下载任务" } };
    }
    return { ok: true, filename, method: "chrome.downloads", downloadId };
  } catch (e) {
    return {
      ok: false,
      error: { code: "DOWNLOAD_FAILED", message: e instanceof Error ? e.message : String(e) }
    };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export async function saveUrlWithChromeDownloads(
  url: string,
  filename: string,
  downloadFolder?: string | null
): Promise<SaveDownloadResult> {
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: buildDownloadPath(filename, downloadFolder),
      saveAs: false,
      conflictAction: "uniquify"
    });
    if (typeof downloadId !== "number") {
      return { ok: false, error: { code: "DOWNLOAD_NOT_STARTED", message: "浏览器没有返回有效的下载任务" } };
    }
    return { ok: true, filename, method: "chrome.downloads", downloadId };
  } catch (e) {
    return {
      ok: false,
      error: { code: "DOWNLOAD_FAILED", message: e instanceof Error ? e.message : String(e) }
    };
  }
}

/** Service worker entry — reads staged blob from IndexedDB (shared extension origin). */
export async function saveDownloadBlobFromStaging(
  stagingId: string,
  filename: string,
  downloadFolder?: string | null
): Promise<SaveDownloadResult> {
  const blob = await readStagedDownloadBlob(stagingId);
  if (!blob) {
    return { ok: false, error: { code: "STAGING_MISSING", message: "下载数据已过期，请重试。" } };
  }
  try {
    return await saveBlobWithChromeDownloads(blob, filename, downloadFolder);
  } finally {
    void clearStagedDownloadBlob(stagingId).catch(() => undefined);
  }
}

async function saveDownloadBlobViaServiceWorker(
  blob: Blob,
  filename: string,
  downloadFolder?: string | null
): Promise<SaveDownloadResult> {
  const stagingId = crypto.randomUUID();
  await stageDownloadBlob(stagingId, blob);
  try {
    const res = (await chrome.runtime.sendMessage({
      type: MessageType.SaveDownloadBlob,
      target: "service-worker",
      requestId: requestId(),
      payload: { stagingId, mimeType: blob.type, filename, downloadFolder }
    } satisfies Request)) as Response;
    if (!res?.ok) {
      return {
        ok: false,
        error: {
          code: "DOWNLOAD_PROXY_FAILED",
          message: res?.error?.message || "无法通过后台保存到下载文件夹"
        }
      };
    }
    return res.data as SaveDownloadResult;
  } catch (e) {
    return {
      ok: false,
      error: {
        code: "DOWNLOAD_PROXY_FAILED",
        message: e instanceof Error ? e.message : String(e)
      }
    };
  } finally {
    void clearStagedDownloadBlob(stagingId).catch(() => undefined);
  }
}

async function saveDownloadUrlViaServiceWorker(
  url: string,
  filename: string,
  downloadFolder?: string | null
): Promise<SaveDownloadResult> {
  const res = (await chrome.runtime.sendMessage({
    type: MessageType.SaveDownloadUrl,
    target: "service-worker",
    requestId: requestId(),
    payload: { url, filename, downloadFolder }
  } satisfies Request)) as Response;
  if (!res?.ok) {
    return {
      ok: false,
      error: {
        code: "DOWNLOAD_PROXY_FAILED",
        message: res?.error?.message || "无法通过后台保存到下载文件夹"
      }
    };
  }
  return res.data as SaveDownloadResult;
}

export async function saveDownloadBlob(
  blob: Blob,
  filename: string,
  options?: SaveDownloadOptions
): Promise<SaveDownloadResult> {
  const settings = await getSettings();
  const saveAs = !!options?.saveAs;
  const requestDirectoryPermission = options?.requestDirectoryPermission !== false;
  const silentAuto = !saveAs && !requestDirectoryPermission;
  const folder = settings.downloadFolder;

  // Auto-stop: prefer already-granted custom folder (silent), else service worker downloads API.
  if (silentAuto && isExtensionContext()) {
    const custom = await writeBlobToDownloadDirectory(blob, filename, folder, false);
    if (custom.ok) {
      return {
        ok: true,
        filename: custom.fileName,
        method: "filesystem",
        pathLabel: custom.pathLabel
      };
    }
    return saveDownloadBlobViaServiceWorker(blob, filename, folder);
  }
  if (!saveAs) {
    const custom = await writeBlobToDownloadDirectory(blob, filename, folder, requestDirectoryPermission);
    if (custom.ok) {
      return {
        ok: true,
        filename: custom.fileName,
        method: "filesystem",
        pathLabel: custom.pathLabel
      };
    }
  }

  if (hasDownloadsApi()) {
    return saveBlobWithChromeDownloads(blob, filename, folder);
  }

  if (isExtensionContext()) {
    return saveDownloadBlobViaServiceWorker(blob, filename, folder);
  }

  if (saveAs && typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    try {
      anchorDownload(url, filename);
      return { ok: true, filename, method: "anchor" };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    }
  }

  if (silentAuto) {
    return {
      ok: false,
      error: {
        code: "SILENT_DOWNLOAD_UNAVAILABLE",
        message: `无法自动保存到下载文件夹。${browserDownloadSettingsHint()}`
      }
    };
  }

  if (typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    try {
      anchorDownload(url, filename);
      return { ok: true, filename, method: "anchor" };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  return { ok: false, error: { code: "DOWNLOAD_API_UNAVAILABLE", message: "浏览器下载功能不可用" } };
}

export async function saveDownloadUrl(
  url: string,
  filename: string,
  options?: Pick<SaveDownloadOptions, "saveAs" | "requestDirectoryPermission">
): Promise<SaveDownloadResult> {
  const settings = await getSettings();
  const saveAs = !!options?.saveAs;
  const silentAuto = !saveAs && options?.requestDirectoryPermission === false;
  const folder = settings.downloadFolder;

  if (silentAuto && isExtensionContext()) {
    if (url.startsWith("data:")) {
      try {
        const blob = await (await fetch(url)).blob();
        const custom = await writeBlobToDownloadDirectory(blob, filename, folder, false);
        if (custom.ok) {
          return {
            ok: true,
            filename: custom.fileName,
            method: "filesystem",
            pathLabel: custom.pathLabel
          };
        }
      } catch {
        /* fall through to service worker */
      }
    }
    return saveDownloadUrlViaServiceWorker(url, filename, folder);
  }
  if (hasDownloadsApi()) {
    return saveUrlWithChromeDownloads(url, filename, folder);
  }

  if (isExtensionContext()) {
    return saveDownloadUrlViaServiceWorker(url, filename, folder);
  }

  if (saveAs && typeof document !== "undefined") {
    anchorDownload(url, filename);
    return { ok: true, filename, method: "anchor" };
  }

  if (silentAuto) {
    return {
      ok: false,
      error: {
        code: "SILENT_DOWNLOAD_UNAVAILABLE",
        message: `无法自动保存到下载文件夹。${browserDownloadSettingsHint()}`
      }
    };
  }

  if (typeof document !== "undefined") {
    anchorDownload(url, filename);
    return { ok: true, filename, method: "anchor" };
  }

  return { ok: false, error: { code: "DOWNLOAD_API_UNAVAILABLE", message: "浏览器下载功能不可用" } };
}
