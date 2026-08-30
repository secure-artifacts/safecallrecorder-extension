import { describe, expect, it } from "vitest";
import {
  shouldAutoDownloadMp3Locally,
  shouldAutoUploadMp3OnStop,
  hasGoogleDriveFolder
} from "../src/google-drive/settings";
import { DEFAULT_SETTINGS } from "../src/types";

describe("google drive settings", () => {
  it("defaults to local save when drive disabled", () => {
    expect(shouldAutoDownloadMp3Locally(DEFAULT_SETTINGS)).toBe(true);
    expect(shouldAutoUploadMp3OnStop(DEFAULT_SETTINGS)).toBe(false);
  });

  it("respects cloud_only upload mode", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      googleDriveEnabled: true,
      googleDriveUploadMode: "cloud_only" as const
    };
    expect(shouldAutoDownloadMp3Locally(settings)).toBe(false);
    expect(shouldAutoUploadMp3OnStop(settings)).toBe(true);
  });

  it("requires folder id for upload readiness", () => {
    expect(hasGoogleDriveFolder({ ...DEFAULT_SETTINGS, googleDriveEnabled: true })).toBe(false);
    expect(
      hasGoogleDriveFolder({
        ...DEFAULT_SETTINGS,
        googleDriveEnabled: true,
        googleDriveFolderId: "abc"
      })
    ).toBe(true);
  });
});
