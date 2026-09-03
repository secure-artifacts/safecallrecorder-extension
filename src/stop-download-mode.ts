import type { AppSettings, StopDownloadMode } from "./types";

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
