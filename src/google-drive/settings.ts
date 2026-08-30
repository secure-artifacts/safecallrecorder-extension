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
