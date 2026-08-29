import { buildDownloadPath } from "./download-path";
import { writeBlobToDownloadDirectory } from "./download-directory";
import { getSettings } from "./extension-storage";

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

export async function saveDownloadBlob(
  blob: Blob,
  filename: string,
  options?: { saveAs?: boolean; requestDirectoryPermission?: boolean }
): Promise<SaveDownloadResult> {
  const settings = await getSettings();
  const saveAs = !!options?.saveAs;

  if (!saveAs) {
    const custom = await writeBlobToDownloadDirectory(
      blob,
      filename,
      settings.downloadFolder,
      options?.requestDirectoryPermission !== false
    );
    if (custom.ok) {
      return {
        ok: true,
        filename: custom.fileName,
        method: "filesystem",
        pathLabel: custom.pathLabel
      };
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    if (hasDownloadsApi()) {
      const downloadId = await chrome.downloads.download({
        url,
        filename: buildDownloadPath(filename, settings.downloadFolder),
        saveAs,
        conflictAction: "uniquify"
      });
      if (typeof downloadId !== "number") {
        return { ok: false, error: { code: "DOWNLOAD_NOT_STARTED", message: "浏览器没有返回有效的下载任务" } };
      }
      return { ok: true, filename, method: "chrome.downloads", downloadId };
    }

    if (typeof document !== "undefined") {
      anchorDownload(url, filename);
      return { ok: true, filename, method: "anchor" };
    }

    return { ok: false, error: { code: "DOWNLOAD_API_UNAVAILABLE", message: "浏览器下载功能不可用" } };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), saveAs ? 120_000 : 60_000);
  }
}

export async function saveDownloadUrl(
  url: string,
  filename: string,
  options?: { saveAs?: boolean }
): Promise<SaveDownloadResult> {
  const settings = await getSettings();
  const saveAs = !!options?.saveAs;
  if (hasDownloadsApi()) {
    try {
      const downloadId = await chrome.downloads.download({
        url,
        filename: buildDownloadPath(filename, settings.downloadFolder),
        saveAs,
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
  if (typeof document !== "undefined") {
    anchorDownload(url, filename);
    return { ok: true, filename, method: "anchor" };
  }
  return { ok: false, error: { code: "DOWNLOAD_API_UNAVAILABLE", message: "浏览器下载功能不可用" } };
}
