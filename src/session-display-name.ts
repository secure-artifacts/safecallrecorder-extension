import { storage } from "./storage-manager";
import type { AppSettings } from "./types";
import {
  buildSessionRecordingName,
  getActiveRecordingNameProfile
} from "./recording-name-profiles";
import type { Session } from "./types";

export function normalizeSessionDisplayNameInput(raw: string): string {
  return raw.trim().slice(0, 200);
}

export async function updateSessionDisplayName(sessionId: string, displayName: string): Promise<Session> {
  const trimmed = normalizeSessionDisplayNameInput(displayName);
  const sessions = await storage.all<Session>("sessions");
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("找不到录音记录");
  if (trimmed) session.displayName = trimmed;
  else delete session.displayName;
  await storage.saveSession(session);
  return session;
}

/** Updates list title from the active naming scheme (does not set displayName). */
export async function updateSessionAutoName(sessionId: string, name: string): Promise<Session> {
  const trimmed = normalizeSessionDisplayNameInput(name);
  const sessions = await storage.all<Session>("sessions");
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("找不到录音记录");
  if (trimmed) session.name = trimmed;
  await storage.saveSession(session);
  return session;
}

/** Export / download filename: manual displayName override, else current active naming scheme. */
export function resolveExportNameForSession(session: Session, settings: AppSettings): string {
  const schemeName = buildSessionRecordingName(getActiveRecordingNameProfile(settings), session.startedAt);
  return resolveSessionExportName(session, schemeName);
}

/** Title for UI and exports; prefers user-set displayName. */
export function resolveSessionExportName(session: Session, schemeName: string): string {
  const custom = session.displayName?.trim();
  return custom || schemeName;
}
