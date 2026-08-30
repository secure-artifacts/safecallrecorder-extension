import { connectGoogleAccount, revokeGoogleAuthToken } from "./auth";
import { isGoogleDriveConfigured } from "./config";
import { createDriveFolder, ensureDefaultDriveFolder, listDriveFolders } from "./drive-api";
import { uploadSessionMp3ToDrive } from "./upload-service";
import { DEFAULT_SETTINGS, type AppSettings } from "../types";
import { storageGetDirect, storageSetDirect } from "../extension-storage";

async function loadSettings(): Promise<AppSettings> {
  const cur = await storageGetDirect("settings");
  return { ...DEFAULT_SETTINGS, ...(cur.settings as AppSettings | undefined) };
}

async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const cur = await loadSettings();
  const next = { ...cur, ...patch };
  await storageSetDirect({ settings: next });
  return next;
}

export async function handleGoogleDriveMessage(
  type: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  if (type === "GOOGLE_DRIVE_GET_STATUS") {
    const settings = await loadSettings();
    return {
      configured: isGoogleDriveConfigured(),
      enabled: settings.googleDriveEnabled === true,
      connected: Boolean(settings.googleDriveAccountEmail),
      email: settings.googleDriveAccountEmail,
      folderId: settings.googleDriveFolderId,
      folderName: settings.googleDriveFolderName,
      uploadMode: settings.googleDriveUploadMode || "local_and_cloud",
      autoUploadOnStop: settings.googleDriveAutoUploadOnStop !== false
    };
  }

  if (type === "GOOGLE_DRIVE_CONNECT") {
    const { email } = await connectGoogleAccount();
    let settings = await saveSettings({ googleDriveAccountEmail: email, googleDriveEnabled: true });
    if (!settings.googleDriveFolderId) {
      const folder = await ensureDefaultDriveFolder();
      settings = await saveSettings({
        googleDriveFolderId: folder.id,
        googleDriveFolderName: folder.name
      });
    }
    return {
      email,
      folderId: settings.googleDriveFolderId,
      folderName: settings.googleDriveFolderName
    };
  }

  if (type === "GOOGLE_DRIVE_DISCONNECT") {
    await revokeGoogleAuthToken().catch(() => undefined);
    await saveSettings({
      googleDriveAccountEmail: undefined,
      googleDriveEnabled: false
    });
    return { ok: true };
  }

  if (type === "GOOGLE_DRIVE_LIST_FOLDERS") {
    const parentId = typeof payload.parentId === "string" ? payload.parentId : undefined;
    const folders = await listDriveFolders(parentId);
    return { folders };
  }

  if (type === "GOOGLE_DRIVE_SET_FOLDER") {
    const folderId = String(payload.folderId || "");
    const folderName = String(payload.folderName || "");
    if (!folderId) throw new Error("未选择文件夹");
    await saveSettings({ googleDriveFolderId: folderId, googleDriveFolderName: folderName });
    return { folderId, folderName };
  }

  if (type === "GOOGLE_DRIVE_CREATE_FOLDER") {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("请输入文件夹名称");
    const parentId = typeof payload.parentId === "string" ? payload.parentId : undefined;
    const folder = await createDriveFolder(name, parentId);
    await saveSettings({ googleDriveFolderId: folder.id, googleDriveFolderName: folder.name });
    return folder;
  }

  if (type === "GOOGLE_DRIVE_ENSURE_DEFAULT_FOLDER") {
    const folder = await ensureDefaultDriveFolder();
    await saveSettings({ googleDriveFolderId: folder.id, googleDriveFolderName: folder.name });
    return folder;
  }

  if (type === "GOOGLE_DRIVE_UPLOAD_MP3") {
    const sessionId = String(payload.sessionId || "");
    if (!sessionId) throw new Error("缺少 sessionId");
    return uploadSessionMp3ToDrive(sessionId, "manual");
  }

  throw new Error(`Unsupported Google Drive message: ${type}`);
}
