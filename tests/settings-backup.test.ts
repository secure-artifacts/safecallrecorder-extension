import { describe, expect, it } from "vitest";
import {
  applySettingsBackupImport,
  buildSettingsBackupExport,
  parseSettingsBackup,
  parseSettingsImport,
  serializeSettingsBackup
} from "../src/settings-backup";
import { DEFAULT_SETTINGS } from "../src/types";

describe("settings backup", () => {
  it("exports and imports full settings round-trip", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      defaultBitrate: 96000,
      detectionSensitivity: "sensitive" as const,
      downloadFolder: "会议录音",
      googleDriveEnabled: true,
      googleDriveFolderId: "folder123",
      googleDriveClientId: "123.apps.googleusercontent.com",
      googleDriveClientSecret: "GOCSPX-secret",
      googleDriveAccountEmail: "user@example.com"
    };
    const authSession = {
      accessToken: "ya29.test",
      expiresAt: Date.now() + 3_600_000,
      clientId: "123.apps.googleusercontent.com",
      refreshToken: "refresh-abc"
    };
    const json = serializeSettingsBackup(settings, authSession);
    const imported = parseSettingsImport(json);
    expect(imported.type).toBe("full");
    if (imported.type !== "full") return;
    expect(imported.doc.settings.defaultBitrate).toBe(96000);
    expect(imported.doc.settings.googleDriveClientSecret).toBe("GOCSPX-secret");
    expect(imported.doc.authSession?.refreshToken).toBe("refresh-abc");
    const applied = applySettingsBackupImport(imported.doc);
    expect(applied.googleDriveFolderId).toBe("folder123");
    expect(applied.detectionSensitivity).toBe("sensitive");
  });

  it("accepts legacy google drive config in unified import parser", () => {
    const doc = buildSettingsBackupExport({
      ...DEFAULT_SETTINGS,
      googleDriveEnabled: true,
      googleDriveFolderId: "abc"
    });
    const driveOnly = {
      kind: "SafeCallRecorderGoogleDriveConfig",
      version: 1,
      exportedAt: Date.now(),
      googleDrive: {
        enabled: true,
        uploadMode: "local_and_cloud",
        autoUploadOnStop: true,
        folderId: "abc",
        clientId: "123.apps.googleusercontent.com"
      }
    };
    const parsed = parseSettingsImport(JSON.stringify(driveOnly));
    expect(parsed.type).toBe("google-drive");
    expect(doc.kind).toBe("SafeCallRecorderSettings");
  });

  it("rejects invalid files", () => {
    expect(() => parseSettingsBackup("{}")).toThrow(/不是 SafeCallRecorder 的全部设置/);
    expect(() => parseSettingsImport('{"kind":"Other"}')).toThrow(/不是 SafeCallRecorder/);
  });

  it("builds export document", () => {
    const doc = buildSettingsBackupExport(DEFAULT_SETTINGS);
    expect(doc.kind).toBe("SafeCallRecorderSettings");
    expect(doc.settings.defaultBitrate).toBe(DEFAULT_SETTINGS.defaultBitrate);
  });
});
