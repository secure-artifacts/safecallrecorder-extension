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

/** Folder + client configured; user still must complete OAuth (email saved on connect). */
export function isGoogleDriveAuthenticated(settings: AppSettings): boolean {
  return Boolean(settings.googleDriveAccountEmail?.trim());
}

export function canUploadToGoogleDrive(settings: AppSettings): boolean {
  return (
    settings.googleDriveEnabled === true &&
    hasGoogleDriveFolder(settings) &&
    isGoogleDriveAuthenticated(settings)
  );
}

/**
 * cloud_only stop requires live Google auth — after config import, fall back to local saves.
 */
export function resolveStopDownloadMode(settings: AppSettings): StopDownloadMode {
  const mode = (settings.stopDownloadMode || "original_then_mp3") as StopDownloadMode;
  if (mode === "cloud_only" && !canUploadToGoogleDrive(settings)) {
    return "original_then_mp3";
  }
  return mode;
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
