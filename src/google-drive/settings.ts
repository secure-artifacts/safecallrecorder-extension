import type { AppSettings } from "../types";

export function shouldAutoDownloadMp3Locally(settings: AppSettings): boolean {
  if (!settings.googleDriveEnabled) return true;
  return settings.googleDriveUploadMode !== "cloud_only";
}

export function shouldAutoUploadMp3OnStop(settings: AppSettings): boolean {
  return settings.googleDriveEnabled === true && settings.googleDriveAutoUploadOnStop !== false;
}

export function hasGoogleDriveFolder(settings: AppSettings): boolean {
  return Boolean(settings.googleDriveFolderId?.trim());
}

/** Linked = saved account email and/or a chosen Drive folder (folder implies OAuth succeeded). */
export function isGoogleDriveLinked(settings: AppSettings): boolean {
  return Boolean(settings.googleDriveAccountEmail?.trim() || settings.googleDriveFolderId?.trim());
}

export function googleDriveAccountLabel(settings: AppSettings): string {
  const email = settings.googleDriveAccountEmail?.trim();
  if (email) return `已连接：${email}`;
  if (settings.googleDriveFolderId?.trim()) return "已连接 Google 账号";
  return "未连接 Google 账号";
}
