import { buildMp3FileName } from "../filename";
import { getMp3BlobForSession } from "../download/mp3-download-service";
import { getSettings } from "../extension-storage";
import { storage } from "../storage-manager";
import type { Session } from "../types";
import { uploadDriveFile } from "./drive-api";
import { hasGoogleDriveFolder, shouldAutoUploadMp3OnStop } from "./settings";

const uploadLocks = new Map<string, Promise<DriveUploadResult>>();

export type DriveUploadResult =
  | { ok: true; fileId: string; fileName: string }
  | { ok: false; error: { code: string; message: string } };

async function updateSessionDriveStatus(
  sessionId: string,
  patch: Partial<Pick<Session, "driveMp3Status" | "driveMp3FileId" | "driveMp3Error" | "driveMp3UploadedAt" | "driveMp3FileName">>
) {
  const sessions = await storage.all<Session>("sessions");
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;
  Object.assign(session, patch);
  await storage.saveSession(session);
}

export async function uploadSessionMp3ToDrive(
  sessionId: string,
  trigger: "auto" | "manual" = "manual",
  options?: { filenameOverride?: string }
): Promise<DriveUploadResult> {
  const existing = uploadLocks.get(sessionId);
  if (existing) return existing;

  const task = (async (): Promise<DriveUploadResult> => {
    try {
      const settings = await getSettings();
      if (!settings.googleDriveEnabled) {
        return { ok: false, error: { code: "DRIVE_DISABLED", message: "未启用 Google 云端上传" } };
      }
      const folderId = settings.googleDriveFolderId?.trim();
      if (!folderId) {
        return { ok: false, error: { code: "NO_FOLDER", message: "请先选择 Google Drive 目标文件夹" } };
      }

      await updateSessionDriveStatus(sessionId, {
        driveMp3Status: "uploading",
        driveMp3Error: undefined
      });

      const loaded = await getMp3BlobForSession(sessionId);
      if (!loaded.ok) {
        await updateSessionDriveStatus(sessionId, {
          driveMp3Status: "failed",
          driveMp3Error: loaded.error.message
        });
        return { ok: false, error: loaded.error };
      }

      const uploadName =
        options?.filenameOverride != null && options.filenameOverride !== ""
          ? options.filenameOverride.endsWith(".mp3")
            ? options.filenameOverride
            : buildMp3FileName(options.filenameOverride)
          : loaded.filename;

      const uploaded = await uploadDriveFile(loaded.blob, uploadName, loaded.mimeType, folderId);
      await updateSessionDriveStatus(sessionId, {
        driveMp3Status: "uploaded",
        driveMp3FileId: uploaded.id,
        driveMp3FileName: uploaded.name,
        driveMp3UploadedAt: Date.now(),
        driveMp3Error: undefined
      });
      console.info("[GoogleDrive]", { stage: "mp3_uploaded", sessionId, trigger, fileId: uploaded.id });
      return { ok: true, fileId: uploaded.id, fileName: uploaded.name };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await updateSessionDriveStatus(sessionId, {
        driveMp3Status: "failed",
        driveMp3Error: message
      });
      console.error("[GoogleDrive]", { stage: "mp3_upload_failed", sessionId, trigger, message });
      return { ok: false, error: { code: "UPLOAD_FAILED", message } };
    }
  })().finally(() => uploadLocks.delete(sessionId));

  uploadLocks.set(sessionId, task);
  return task;
}

export async function maybeAutoUploadMp3AfterEncode(
  sessionId: string,
  options?: { filenameOverride?: string; force?: boolean }
): Promise<DriveUploadResult | null> {
  const settings = await getSettings();
  if (!options?.force && !shouldAutoUploadMp3OnStop(settings)) return null;
  if (!hasGoogleDriveFolder(settings)) return null;
  return uploadSessionMp3ToDrive(sessionId, "auto", {
    filenameOverride: options?.filenameOverride
  });
}

export function driveUploadLabel(session: Session): string {
  switch (session.driveMp3Status) {
    case "uploading":
      return "上传中…";
    case "uploaded":
      return "已上传云端";
    case "failed":
      return "上传失败";
    case "skipped":
      return "未上传";
    default:
      return "—";
  }
}
