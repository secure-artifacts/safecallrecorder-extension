import { describe, expect, it } from "vitest";
import {
  shouldAutoDownloadMp3Locally,
  shouldAutoUploadMp3OnStop,
  hasGoogleDriveFolder,
  googleDriveAccountLabel,
  isGoogleDriveLinked
} from "../src/google-drive/settings";
import { friendlyGoogleConnectError } from "../src/google-drive/config";
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

  it("treats chosen folder as linked for account label", () => {
    expect(
      googleDriveAccountLabel({
        ...DEFAULT_SETTINGS,
        googleDriveFolderId: "abc",
        googleDriveFolderName: "9月"
      })
    ).toBe("已连接 Google 账号");
    expect(isGoogleDriveLinked({ ...DEFAULT_SETTINGS, googleDriveFolderId: "abc" })).toBe(true);
  });

  it("prefers email in account label when available", () => {
    expect(
      googleDriveAccountLabel({
        ...DEFAULT_SETTINGS,
        googleDriveAccountEmail: "user@gmail.com",
        googleDriveFolderId: "abc"
      })
    ).toBe("已连接：user@gmail.com");
  });

  it("explains redirect_uri_mismatch for control panel oauth", () => {
    const msg = friendlyGoogleConnectError("Error 400: redirect_uri_mismatch");
    expect(msg).toContain("Web 应用");
    expect(msg).toContain("重定向 URI 不匹配");
    expect(msg).toContain("chromiumapp.org");
  });
});
