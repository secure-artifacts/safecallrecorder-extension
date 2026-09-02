import { storage } from "./storage-manager";
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

/** Title for UI and exports; prefers user-set displayName. */
export function resolveSessionExportName(session: Session, schemeName: string): string {
  const custom = session.displayName?.trim();
  return custom || schemeName;
}
