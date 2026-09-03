import { buildDownloadPath, browserDownloadSettingsHint } from "./download-path";
import { getSavedDownloadDirectory, writeBlobToDownloadDirectory } from "./download-directory";
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
      await clearStagedDownloadBlob(stagingId).catch(() => undefined);
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
    await clearStagedDownloadBlob(stagingId).catch(() => undefined);
    return {
      ok: false,
      error: {
        code: "DOWNLOAD_PROXY_FAILED",
        message: e instanceof Error ? e.message : String(e)
      }
    };
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
  const customDir = await getSavedDownloadDirectory();

  async function tryCustomDirectory(requestPermission: boolean): Promise<SaveDownloadResult | null> {
    const custom = await writeBlobToDownloadDirectory(blob, filename, folder, requestPermission);
    if (custom.ok) {
      return {
        ok: true,
        filename: custom.fileName,
        method: "filesystem",
        pathLabel: custom.pathLabel
      };
    }
    return null;
  }

  // Auto-stop: custom folder (if already granted) → local chrome.downloads → SW staging (offscreen).
  if (silentAuto && isExtensionContext()) {
    if (customDir) {
      let saved = await tryCustomDirectory(false);
      if (!saved) saved = await tryCustomDirectory(true);
      if (saved) return saved;
      return {
        ok: false,
        error: {
          code: "CUSTOM_FOLDER_WRITE_FAILED",
          message:
            "无法写入已选择的保存文件夹。请打开控制面板，重新点「选择其他位置…」并允许访问；或点「使用下载文件夹」改用浏览器下载目录。"
        }
      };
    }
    if (hasDownloadsApi()) {
      return saveBlobWithChromeDownloads(blob, filename, folder);
    }
    return saveDownloadBlobViaServiceWorker(blob, filename, folder);
  }
  if (!saveAs) {
    if (customDir) {
      let saved = await tryCustomDirectory(requestDirectoryPermission);
      if (!saved && requestDirectoryPermission) saved = await tryCustomDirectory(true);
      if (saved) return saved;
      if (customDir) {
        return {
          ok: false,
          error: {
            code: "CUSTOM_FOLDER_WRITE_FAILED",
            message: "无法写入已选择的保存文件夹，请重新选择保存位置。"
          }
        };
      }
    } else {
      const saved = await tryCustomDirectory(requestDirectoryPermission);
      if (saved) return saved;
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
  const customDir = await getSavedDownloadDirectory();

  async function tryCustomFromUrl(requestPermission: boolean): Promise<SaveDownloadResult | null> {
    if (!url.startsWith("data:")) return null;
    try {
      const blob = await (await fetch(url)).blob();
      const custom = await writeBlobToDownloadDirectory(blob, filename, folder, requestPermission);
      if (custom.ok) {
        return {
          ok: true,
          filename: custom.fileName,
          method: "filesystem",
          pathLabel: custom.pathLabel
        };
      }
    } catch {
      /* fall through */
    }
    return null;
  }

  if (silentAuto && isExtensionContext()) {
    if (customDir) {
      let saved = await tryCustomFromUrl(false);
      if (!saved) saved = await tryCustomFromUrl(true);
      if (saved) return saved;
      return {
        ok: false,
        error: {
          code: "CUSTOM_FOLDER_WRITE_FAILED",
          message: "无法写入已选择的保存文件夹，请重新选择保存位置。"
        }
      };
    }
    if (url.startsWith("data:")) {
      try {
        const blob = await (await fetch(url)).blob();
        if (hasDownloadsApi()) {
          return saveBlobWithChromeDownloads(blob, filename, folder);
        }
      } catch {
        /* fall through */
      }
    }
    if (hasDownloadsApi()) {
      return saveUrlWithChromeDownloads(url, filename, folder);
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
