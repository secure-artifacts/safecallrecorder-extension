import { sanitizeFileBase } from "./filename";

export const DEFAULT_DOWNLOAD_FOLDER = "SafeCallRecorder";

/** Normalize a subfolder path under the browser default Downloads directory. */
export function sanitizeDownloadFolder(raw: string | undefined | null, allowEmpty = false): string {
  if (!raw?.trim()) return allowEmpty ? "" : DEFAULT_DOWNLOAD_FOLDER;
  const parts = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => sanitizeFileBase(part))
    .filter(Boolean);
  if (!parts.length) return allowEmpty ? "" : DEFAULT_DOWNLOAD_FOLDER;
  return parts.join("/");
}

/** Build chrome.downloads filename: optional subfolder + file name (no leading slash). */
export function buildDownloadPath(fileName: string, folder?: string | null): string {
  const dir = sanitizeDownloadFolder(folder, true);
  const base = fileName.replace(/^[/\\]+/, "").split(/[/\\]/).pop() || "download";
  const safe = sanitizeFileBase(base.replace(/\.[^.]+$/, "")) || "download";
  const extMatch = base.match(/(\.[^./\\]+)$/);
  const ext = extMatch?.[1] || "";
  const name = `${safe}${ext}`;
  return dir ? `${dir}/${name}` : name;
}

export function downloadFolderHint(folder?: string | null): string {
  const dir = sanitizeDownloadFolder(folder, true);
  if (!dir) return "浏览器下载文件夹 /";
  return `浏览器下载/ ${dir.replace(/\//g, " / ")} /`;
}

export function isProtectedFolderPickError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /system file|系统文件|protected|受保护|cannot open this folder|无法打开此文件夹/i.test(msg);
}

export function friendlyProtectedFolderPickError(): string {
  return "Chrome 不允许直接选择「下载」等系统文件夹。请点「使用下载文件夹」，音频会自动保存到浏览器下载目录；子文件夹可留空。";
}

/** Shown when auto-download triggers a save dialog — usually browser settings, not the extension. */
export function browserDownloadSettingsHint(): string {
  return (
    "若停止录音后弹出「另存为」窗口，通常是浏览器下载设置导致，不是插件故障。" +
    "请在浏览器设置中关闭「下载前询问每个文件的保存位置」" +
    "（Brave：brave://settings/downloads · Chrome：chrome://settings/downloads · Edge：edge://settings/downloads）。"
  );
}
