import { describe, expect, it } from "vitest";
import {
  applyGoogleDriveConfig,
  buildGoogleDriveConfigExport,
  parseGoogleDriveConfig,
  serializeGoogleDriveConfig
} from "../src/google-drive/config-backup";
import { DEFAULT_SETTINGS } from "../src/types";

describe("google drive config backup", () => {
  it("exports and imports round-trip", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      googleDriveEnabled: true,
      googleDriveUploadMode: "cloud_only" as const,
      googleDriveAutoUploadOnStop: true,
      googleDriveFolderId: "folder123",
      googleDriveFolderName: "我的录音",
      googleDriveAccountEmail: "user@example.com",
      googleDriveClientId: "123.apps.googleusercontent.com"
    };
    const json = serializeGoogleDriveConfig(settings);
    const parsed = parseGoogleDriveConfig(json);
    expect(parsed.googleDrive.folderId).toBe("folder123");
    expect(parsed.googleDrive.clientId).toBe("123.apps.googleusercontent.com");
    expect(parsed.googleDrive.uploadMode).toBe("cloud_only");
    const applied = applyGoogleDriveConfig(settings, parsed);
    expect(applied.googleDriveFolderId).toBe("folder123");
    expect(applied.googleDriveClientId).toBe("123.apps.googleusercontent.com");
    expect(applied.googleDriveAccountEmail).toBeUndefined();
    expect(applied.googleDriveEnabled).toBe(true);
  });

  it("rejects invalid files", () => {
    expect(() => parseGoogleDriveConfig("{}")).toThrow(/不是 SafeCallRecorder/);
    expect(() =>
      parseGoogleDriveConfig(
        JSON.stringify({
          kind: "SafeCallRecorderGoogleDriveConfig",
          version: 1,
          googleDrive: { enabled: true, uploadMode: "local_and_cloud", autoUploadOnStop: true }
        })
      )
    ).toThrow(/缺少 Google Drive 文件夹 ID/);
  });

  it("builds export document", () => {
    const doc = buildGoogleDriveConfigExport({
      ...DEFAULT_SETTINGS,
      googleDriveEnabled: true,
      googleDriveFolderId: "abc"
    });
    expect(doc.kind).toBe("SafeCallRecorderGoogleDriveConfig");
    expect(doc.googleDrive.enabled).toBe(true);
  });
});
