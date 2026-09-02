import type { Session } from "../types";

/** Public Google Drive file page (opens preview / download in browser). */
export function buildDriveFileViewUrl(fileId: string): string {
  const id = fileId.trim();
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}

/** Resolved link for a session that was uploaded to Drive. */
export function resolveSessionDriveWebUrl(session: Session): string | undefined {
  const saved = session.driveMp3WebUrl?.trim();
  if (saved) return saved;
  const fileId = session.driveMp3FileId?.trim();
  if (session.driveMp3Status === "uploaded" && fileId) return buildDriveFileViewUrl(fileId);
  return undefined;
}

export function driveLinkLabel(session: Session): string {
  return session.driveMp3FileName?.trim() || "打开云端音频";
}
