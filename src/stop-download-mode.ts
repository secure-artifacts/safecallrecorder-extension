import type { AppSettings, StopDownloadMode } from "./types";
import { canUploadToGoogleDrive, shouldAutoUploadMp3OnStop } from "./google-drive/settings";

function stopMode(settings: AppSettings): StopDownloadMode {
  return (settings.stopDownloadMode || "original_then_mp3") as StopDownloadMode;
}

/** Apply stop-download mode and related auto-download flags (shared by UI + config import). */
export function applyStopDownloadModeToSettings(
  settings: AppSettings,
  mode: StopDownloadMode
): AppSettings {
  const next: AppSettings = { ...settings, stopDownloadMode: mode };
  if (mode === "original_only") {
    next.autoDownloadOriginal = true;
    next.autoDownloadMp3AfterSuccess = false;
    next.autoDownloadMp3 = false;
  } else if (mode === "mp3_only") {
    next.autoDownloadOriginal = false;
    next.autoDownloadMp3AfterSuccess = true;
    next.autoDownloadMp3 = true;
  } else if (mode === "cloud_only") {
    next.autoDownloadOriginal = false;
    next.autoDownloadMp3AfterSuccess = false;
    next.autoDownloadMp3 = false;
    next.googleDriveEnabled = true;
    next.googleDriveAutoUploadOnStop = true;
  } else {
    next.autoDownloadOriginal = true;
    next.autoDownloadMp3AfterSuccess = true;
    next.autoDownloadMp3 = true;
  }
  return next;
}

/** Whether to encode MP3 after stop (includes cloud-only upload when Drive auto-upload is on). */
export function shouldGenerateMp3AfterStop(settings: AppSettings): boolean {
  const mode = stopMode(settings);
  if (mode === "original_then_mp3" || mode === "mp3_only" || mode === "cloud_only") return true;
  if (mode === "original_only") {
    return shouldAutoUploadMp3OnStop(settings) && canUploadToGoogleDrive(settings);
  }
  return false;
}

/** Local MP3 download after encode — independent of Google Drive auto-upload. */
export function shouldAutoDownloadMp3AfterStop(settings: AppSettings): boolean {
  const mode = stopMode(settings);
  if (mode === "cloud_only" || mode === "original_only") return false;
  return settings.autoDownloadMp3AfterSuccess !== false && settings.autoDownloadMp3 !== false;
}

/** Local WebM download after stop. */
export function shouldAutoDownloadOriginalAfterStop(settings: AppSettings): boolean {
  const mode = stopMode(settings);
  if (mode === "mp3_only" || mode === "cloud_only") return false;
  return settings.autoDownloadOriginal !== false;
}
