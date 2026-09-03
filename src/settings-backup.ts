import { applyRecordingNameProfilesToSettings } from "./recording-name-profiles";
import {
  GOOGLE_DRIVE_CONFIG_VERSION,
  isUsableAuthSessionExport,
  parseGoogleDriveConfig,
  type GoogleDriveAuthSessionExport,
  type GoogleDriveConfigExport
} from "./google-drive/config-backup";
import { DEFAULT_SETTINGS, type AppSettings } from "./types";

export const SETTINGS_BACKUP_KIND = "SafeCallRecorderSettings";
export const SETTINGS_BACKUP_VERSION = 1;

export type SettingsBackupExport = {
  kind: typeof SETTINGS_BACKUP_KIND;
  version: typeof SETTINGS_BACKUP_VERSION;
  exportedAt: number;
  settings: AppSettings;
  authSession?: GoogleDriveAuthSessionExport;
};

export type SettingsImportPayload =
  | { type: "full"; doc: SettingsBackupExport }
  | { type: "google-drive"; doc: GoogleDriveConfigExport };

export function buildSettingsBackupExport(
  settings: AppSettings,
  authSession?: GoogleDriveAuthSessionExport | null
): SettingsBackupExport {
  const normalized = applyRecordingNameProfilesToSettings({ ...settings });
  let session = authSession && isUsableAuthSessionExport(authSession) ? authSession : undefined;
  const clientId = normalized.googleDriveClientId?.trim();
  if (session && clientId && session.clientId !== clientId) {
    session = { ...session, clientId };
  }
  return {
    kind: SETTINGS_BACKUP_KIND,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: normalized,
    authSession: session
  };
}

export function serializeSettingsBackup(
  settings: AppSettings,
  authSession?: GoogleDriveAuthSessionExport | null
): string {
  return JSON.stringify(buildSettingsBackupExport(settings, authSession), null, 2);
}

export function parseSettingsBackup(raw: string): SettingsBackupExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("配置文件不是有效的 JSON。");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("配置文件格式无效。");
  const doc = parsed as Partial<SettingsBackupExport>;
  if (doc.kind !== SETTINGS_BACKUP_KIND) {
    throw new Error("不是 SafeCallRecorder 的全部设置备份文件。");
  }
  if (doc.version !== SETTINGS_BACKUP_VERSION) {
    throw new Error(`不支持的配置版本：${String(doc.version)}`);
  }
  if (!doc.settings || typeof doc.settings !== "object") {
    throw new Error("配置文件缺少 settings 字段。");
  }
  const authRaw = (doc as { authSession?: Partial<GoogleDriveAuthSessionExport> }).authSession;
  let authSession: GoogleDriveAuthSessionExport | undefined;
  if (authRaw && typeof authRaw === "object") {
    const candidate: GoogleDriveAuthSessionExport = {
      accessToken: typeof authRaw.accessToken === "string" ? authRaw.accessToken.trim() : "",
      expiresAt: typeof authRaw.expiresAt === "number" ? authRaw.expiresAt : 0,
      clientId: typeof authRaw.clientId === "string" ? authRaw.clientId.trim() : "",
      refreshToken: typeof authRaw.refreshToken === "string" ? authRaw.refreshToken.trim() : undefined
    };
    if (candidate.refreshToken === "") delete candidate.refreshToken;
    if (isUsableAuthSessionExport(candidate)) authSession = candidate;
  }
  const settings = applyRecordingNameProfilesToSettings({
    ...DEFAULT_SETTINGS,
    ...(doc.settings as AppSettings)
  });
  const clientId = settings.googleDriveClientId?.trim();
  if (authSession && clientId && authSession.clientId !== clientId) {
    authSession = { ...authSession, clientId };
  }
  return {
    kind: SETTINGS_BACKUP_KIND,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: typeof doc.exportedAt === "number" ? doc.exportedAt : Date.now(),
    settings,
    authSession
  };
}

/** Replace local settings with imported backup (full settings document). */
export function applySettingsBackupImport(doc: SettingsBackupExport): AppSettings {
  return applyRecordingNameProfilesToSettings({
    ...DEFAULT_SETTINGS,
    ...doc.settings
  });
}

export function parseSettingsImport(raw: string): SettingsImportPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("配置文件不是有效的 JSON。");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("配置文件格式无效。");
  const kind = (parsed as { kind?: string }).kind;
  if (kind === SETTINGS_BACKUP_KIND) {
    return { type: "full", doc: parseSettingsBackup(raw) };
  }
  if (kind === "SafeCallRecorderGoogleDriveConfig") {
    if ((parsed as { version?: number }).version !== GOOGLE_DRIVE_CONFIG_VERSION) {
      throw new Error(`不支持的 Google 云端配置版本：${String((parsed as { version?: unknown }).version)}`);
    }
    return { type: "google-drive", doc: parseGoogleDriveConfig(raw) };
  }
  throw new Error("不是 SafeCallRecorder 的设置或云端配置文件。");
}

export function settingsBackupFileName(exportedAt = Date.now()): string {
  const d = new Date(exportedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `safecallrecorder-settings-${stamp}.json`;
}

export function describeSettingsBackupExport(authSession?: GoogleDriveAuthSessionExport | null): string {
  if (authSession?.refreshToken?.trim()) {
    return "含全部设置与 Google 长期登录状态；导入后通常无需再点「连接 Google 账号」。";
  }
  if (isUsableAuthSessionExport(authSession)) {
    return "含全部设置与 Google 短期登录状态（约 1 小时内有效）；请尽快导入。";
  }
  return "含全部设置；若启用 Google 云端，导入后可能需重新连接账号。";
}
