import type { AppSettings } from "../types";

export const GOOGLE_DRIVE_CONFIG_VERSION = 1;
export const GOOGLE_DRIVE_CONFIG_FILENAME = "safecallrecorder-google-drive-config.json";

export type GoogleDriveConfigExport = {
  kind: "SafeCallRecorderGoogleDriveConfig";
  version: typeof GOOGLE_DRIVE_CONFIG_VERSION;
  exportedAt: number;
  googleDrive: {
    enabled: boolean;
    uploadMode: "local_and_cloud" | "cloud_only";
    autoUploadOnStop: boolean;
    folderId?: string;
    folderName?: string;
    accountEmail?: string;
    clientId?: string;
  };
};

export function buildGoogleDriveConfigExport(settings: AppSettings): GoogleDriveConfigExport {
  return {
    kind: "SafeCallRecorderGoogleDriveConfig",
    version: GOOGLE_DRIVE_CONFIG_VERSION,
    exportedAt: Date.now(),
    googleDrive: {
      enabled: settings.googleDriveEnabled === true,
      uploadMode: settings.googleDriveUploadMode || "local_and_cloud",
      autoUploadOnStop: settings.googleDriveAutoUploadOnStop !== false,
      folderId: settings.googleDriveFolderId,
      folderName: settings.googleDriveFolderName,
      accountEmail: settings.googleDriveAccountEmail,
      clientId: settings.googleDriveClientId
    }
  };
}

export function serializeGoogleDriveConfig(settings: AppSettings): string {
  return JSON.stringify(buildGoogleDriveConfigExport(settings), null, 2);
}

export function parseGoogleDriveConfig(raw: string): GoogleDriveConfigExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("配置文件不是有效的 JSON。");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("配置文件格式无效。");
  const doc = parsed as Partial<GoogleDriveConfigExport>;
  if (doc.kind !== "SafeCallRecorderGoogleDriveConfig") {
    throw new Error("不是 SafeCallRecorder 的 Google 云端配置文件。");
  }
  if (doc.version !== GOOGLE_DRIVE_CONFIG_VERSION) {
    throw new Error(`不支持的配置版本：${String(doc.version)}`);
  }
  const g = doc.googleDrive;
  if (!g || typeof g !== "object") throw new Error("配置文件缺少 googleDrive 字段。");
  const uploadMode = g.uploadMode === "cloud_only" ? "cloud_only" : "local_and_cloud";
  const folderId = typeof g.folderId === "string" ? g.folderId.trim() : "";
  const folderName = typeof g.folderName === "string" ? g.folderName.trim() : "";
  const clientId = typeof g.clientId === "string" ? g.clientId.trim() : "";
  if (g.enabled && !folderId) {
    throw new Error("配置文件已启用上传，但缺少 Google Drive 文件夹 ID。");
  }
  return {
    kind: "SafeCallRecorderGoogleDriveConfig",
    version: GOOGLE_DRIVE_CONFIG_VERSION,
    exportedAt: typeof doc.exportedAt === "number" ? doc.exportedAt : Date.now(),
    googleDrive: {
      enabled: g.enabled === true,
      uploadMode,
      autoUploadOnStop: g.autoUploadOnStop !== false,
      folderId: folderId || undefined,
      folderName: folderName || undefined,
      accountEmail: typeof g.accountEmail === "string" ? g.accountEmail : undefined,
      clientId: clientId || undefined
    }
  };
}

/** Apply imported config to settings. Clears live OAuth session; user reconnects in new browser. */
export function applyGoogleDriveConfig(
  settings: AppSettings,
  config: GoogleDriveConfigExport
): AppSettings {
  const g = config.googleDrive;
  return {
    ...settings,
    googleDriveEnabled: g.enabled,
    googleDriveUploadMode: g.uploadMode,
    googleDriveAutoUploadOnStop: g.autoUploadOnStop,
    googleDriveFolderId: g.folderId,
    googleDriveFolderName: g.folderName,
    googleDriveClientId: g.clientId,
    googleDriveAccountEmail: undefined
  };
}

export function googleDriveConfigFileName(exportedAt = Date.now()): string {
  const d = new Date(exportedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `safecallrecorder-google-drive-${stamp}.json`;
}
