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
      stopDownloadMode: "cloud_only" as const,
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
    expect(parsed.stopDownloadMode).toBe("cloud_only");
    const applied = applyGoogleDriveConfig({ ...DEFAULT_SETTINGS }, parsed);
    expect(applied.googleDriveFolderId).toBe("folder123");
    expect(applied.stopDownloadMode).toBe("cloud_only");
    expect(applied.autoDownloadOriginal).toBe(false);
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

  it("exports auth session when provided and still valid", () => {
    const authSession = {
      accessToken: "ya29.test",
      expiresAt: Date.now() + 3_600_000,
      clientId: "123.apps.googleusercontent.com"
    };
    const doc = buildGoogleDriveConfigExport(
      { ...DEFAULT_SETTINGS, googleDriveEnabled: true, googleDriveFolderId: "abc" },
      authSession
    );
    expect(doc.authSession?.accessToken).toBe("ya29.test");
    const roundTrip = parseGoogleDriveConfig(JSON.stringify(doc));
    expect(roundTrip.authSession?.clientId).toBe("123.apps.googleusercontent.com");
  });

  it("omits expired auth session from export document", () => {
    const doc = buildGoogleDriveConfigExport(
      { ...DEFAULT_SETTINGS, googleDriveEnabled: true, googleDriveFolderId: "abc" },
      { accessToken: "x", expiresAt: Date.now() - 1000, clientId: "123.apps.googleusercontent.com" }
    );
    expect(doc.authSession).toBeUndefined();
  });

  it("keeps refresh token in export even when access token expired", () => {
    const doc = buildGoogleDriveConfigExport(
      { ...DEFAULT_SETTINGS, googleDriveEnabled: true, googleDriveFolderId: "abc" },
      {
        accessToken: "x",
        expiresAt: Date.now() - 1000,
        clientId: "123.apps.googleusercontent.com",
        refreshToken: "refresh-abc"
      }
    );
    expect(doc.authSession?.refreshToken).toBe("refresh-abc");
  });

  it("exports client secret in config", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      googleDriveEnabled: true,
      googleDriveFolderId: "abc",
      googleDriveClientId: "123.apps.googleusercontent.com",
      googleDriveClientSecret: "GOCSPX-secret"
    };
    const doc = buildGoogleDriveConfigExport(settings);
    expect(doc.googleDrive.clientSecret).toBe("GOCSPX-secret");
    const applied = applyGoogleDriveConfig(DEFAULT_SETTINGS, parseGoogleDriveConfig(JSON.stringify(doc)));
    expect(applied.googleDriveClientSecret).toBe("GOCSPX-secret");
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
