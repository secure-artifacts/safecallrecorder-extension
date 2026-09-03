import type { AppSettings, StopDownloadMode } from "../types";
import { applyStopDownloadModeToSettings } from "../stop-download-mode";

export const GOOGLE_DRIVE_CONFIG_VERSION = 1;
export const GOOGLE_DRIVE_CONFIG_FILENAME = "safecallrecorder-google-drive-config.json";

export type GoogleDriveAuthSessionExport = {
  accessToken: string;
  expiresAt: number;
  clientId: string;
  /** Long-lived — allows auto-renewal after import when client secret is also configured. */
  refreshToken?: string;
};

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
    /** Enables refresh-token restore on import without Google login popup. */
    clientSecret?: string;
  };
  /** Optional — short-lived access token (~1h) or refresh token (long-lived). */
  authSession?: GoogleDriveAuthSessionExport;
  /** Optional — restores stop behavior when moving browsers. */
  stopDownloadMode?: StopDownloadMode;
};

export function isUsableAuthSessionExport(session?: GoogleDriveAuthSessionExport | null): boolean {
  if (!session?.clientId?.trim()) return false;
  if (session.refreshToken?.trim()) return true;
  if (!session.accessToken?.trim()) return false;
  return session.expiresAt > Date.now() + 30_000;
}

export function buildGoogleDriveConfigExport(
  settings: AppSettings,
  authSession?: GoogleDriveAuthSessionExport | null
): GoogleDriveConfigExport {
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
      clientId: settings.googleDriveClientId,
      clientSecret: settings.googleDriveClientSecret
    },
    authSession: isUsableAuthSessionExport(authSession) ? authSession! : undefined,
    stopDownloadMode: settings.stopDownloadMode
  };
}

export function serializeGoogleDriveConfig(
  settings: AppSettings,
  authSession?: GoogleDriveAuthSessionExport | null
): string {
  return JSON.stringify(buildGoogleDriveConfigExport(settings, authSession), null, 2);
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
  const clientSecret = typeof g.clientSecret === "string" ? g.clientSecret.trim() : "";
  if (g.enabled && !folderId) {
    throw new Error("配置文件已启用上传，但缺少 Google Drive 文件夹 ID。");
  }
  const authRaw = (doc as { authSession?: Partial<GoogleDriveAuthSessionExport> }).authSession;
  let authSession: GoogleDriveAuthSessionExport | undefined;
  if (authRaw && typeof authRaw === "object") {
    const accessToken = typeof authRaw.accessToken === "string" ? authRaw.accessToken.trim() : "";
    const clientIdAuth = typeof authRaw.clientId === "string" ? authRaw.clientId.trim() : "";
    const expiresAt = typeof authRaw.expiresAt === "number" ? authRaw.expiresAt : 0;
    const refreshToken =
      typeof authRaw.refreshToken === "string" ? authRaw.refreshToken.trim() : "";
    const candidate: GoogleDriveAuthSessionExport = {
      accessToken,
      expiresAt,
      clientId: clientIdAuth,
      refreshToken: refreshToken || undefined
    };
    if (isUsableAuthSessionExport(candidate)) {
      authSession = candidate;
    }
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
      clientId: clientId || undefined,
      clientSecret: clientSecret || undefined
    },
    authSession,
    stopDownloadMode:
      doc.stopDownloadMode === "original_only" ||
      doc.stopDownloadMode === "mp3_only" ||
      doc.stopDownloadMode === "cloud_only" ||
      doc.stopDownloadMode === "original_then_mp3"
        ? doc.stopDownloadMode
        : undefined
  };
}

/** Apply imported config to settings. OAuth session is restored separately via authSession. */
export function applyGoogleDriveConfig(
  settings: AppSettings,
  config: GoogleDriveConfigExport
): AppSettings {
  const g = config.googleDrive;
  let next: AppSettings = {
    ...settings,
    googleDriveEnabled: g.enabled,
    googleDriveUploadMode: g.uploadMode,
    googleDriveAutoUploadOnStop: g.autoUploadOnStop,
    googleDriveFolderId: g.folderId,
    googleDriveFolderName: g.folderName,
    googleDriveClientId: g.clientId,
    googleDriveClientSecret: g.clientSecret,
    googleDriveAccountEmail: undefined
  };
  const stopMode =
    config.stopDownloadMode ?? (g.uploadMode === "cloud_only" ? "cloud_only" : undefined);
  if (stopMode) {
    next = applyStopDownloadModeToSettings(next, stopMode);
  }
  return next;
}

export function describeGoogleDriveConfigExport(authSession?: GoogleDriveAuthSessionExport | null): string {
  if (authSession?.refreshToken?.trim()) {
    return "含客户端 ID、密钥与长期登录状态；导入后通常无需再点「连接 Google 账号」。";
  }
  if (isUsableAuthSessionExport(authSession)) {
    return "含客户端 ID、密钥与短期登录状态（约 1 小时内有效）；请尽快导入。";
  }
  return "含客户端 ID 与密钥；导入后需点「连接 Google 账号」授权。";
}

export function googleDriveConfigFileName(exportedAt = Date.now()): string {
  const d = new Date(exportedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `safecallrecorder-google-drive-${stamp}.json`;
}
