import { describe, expect, it } from "vitest";
import {
  shouldAutoDownloadMp3AfterStop,
  shouldAutoDownloadOriginalAfterStop,
  shouldGenerateMp3AfterStop
} from "../src/stop-download-mode";
import { DEFAULT_SETTINGS } from "../src/types";

describe("stop download mode", () => {
  it("generates mp3 for recommended mode", () => {
    expect(shouldGenerateMp3AfterStop({ ...DEFAULT_SETTINGS, stopDownloadMode: "original_then_mp3" })).toBe(
      true
    );
  });

  it("still generates mp3 for original_only when cloud auto-upload is on", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      stopDownloadMode: "original_only" as const,
      googleDriveEnabled: true,
      googleDriveAutoUploadOnStop: true,
      googleDriveFolderId: "folder",
      googleDriveAccountEmail: "user@gmail.com"
    };
    expect(shouldGenerateMp3AfterStop(settings)).toBe(true);
    expect(shouldAutoDownloadMp3AfterStop(settings)).toBe(false);
    expect(shouldAutoDownloadOriginalAfterStop(settings)).toBe(true);
  });

  it("skips mp3 for original_only when cloud upload disabled", () => {
    expect(
      shouldGenerateMp3AfterStop({ ...DEFAULT_SETTINGS, stopDownloadMode: "original_only" })
    ).toBe(false);
  });

  it("generates and downloads mp3 for mp3_only", () => {
    const settings = { ...DEFAULT_SETTINGS, stopDownloadMode: "mp3_only" as const };
    expect(shouldGenerateMp3AfterStop(settings)).toBe(true);
    expect(shouldAutoDownloadMp3AfterStop(settings)).toBe(true);
    expect(shouldAutoDownloadOriginalAfterStop(settings)).toBe(false);
  });
});
