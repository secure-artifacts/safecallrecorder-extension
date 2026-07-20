import { recordings } from "./recording-manager";
import { isMp3Encoding } from "./export-manager";
import { storage } from "./storage-manager";
import type { Session } from "./types";

export type FailedSessionInfo = {
  sessionId: string;
  errorCode: string;
  message: string;
};

export type ClearHistoryResult = {
  success: boolean;
  deletedSessionIds: string[];
  skippedSessionIds: string[];
  failedSessions: FailedSessionInfo[];
  /** @deprecated use deletedSessionIds.length */
  deletedSessions: number;
  /** @deprecated use skippedSessionIds.length */
  skippedSessions: number;
  /** @deprecated use failedSessions.length */
  failedCount: number;
  deletedCount: number;
  skippedCount: number;
  reclaimedBytes: number;
  partialFailure: boolean;
};

export type DeleteSessionResult = {
  ok: boolean;
  sessionId: string;
  reclaimedBytes: number;
  error?: string;
  errorCode?: string;
};

const BUSY: Session["status"][] = ["starting", "recording", "paused"];
const BUSY_HISTORY = new Set(["recording"]);

export function isSessionBusy(s: Session): boolean {
  if (recordings.active.has(s.id)) return true;
  if (isMp3Encoding(s.id)) return true;
  if (BUSY.includes(s.status)) return true;
  if (s.recordingStatus === "recording" || s.recordingStatus === "starting" || s.recordingStatus === "paused") {
    return true;
  }
  if (s.historyStatus && BUSY_HISTORY.has(s.historyStatus)) return true;
  return false;
}

export async function deleteRecordingSession(sessionId: string): Promise<DeleteSessionResult> {
  const sessions = await storage.all<Session>("sessions");
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    return { ok: false, sessionId, reclaimedBytes: 0, errorCode: "NOT_FOUND", error: "记录不存在" };
  }
  if (isSessionBusy(session)) {
    return {
      ok: false,
      sessionId,
      reclaimedBytes: 0,
      errorCode: "BUSY",
      error: "正在录音或处理中，无法删除"
    };
  }
  try {
    const bytes = await storage.estimateSessionBytes(sessionId);
    await storage.removeSession(sessionId);
    console.info("[HistoryDelete]", { stage: "storage_deleted", sessionId, reclaimedBytes: bytes });
    return { ok: true, sessionId, reclaimedBytes: bytes };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[HistoryDelete]", { stage: "storage_failed", sessionId, message });
    return { ok: false, sessionId, reclaimedBytes: 0, errorCode: "DELETE_FAILED", error: message };
  }
}

export async function clearRecordingHistory(options?: {
  onlySafe?: boolean;
}): Promise<ClearHistoryResult> {
  const sessions = await storage.all<Session>("sessions");
  const deletable: Session[] = [];
  const skippedSessionIds: string[] = [];
  for (const s of sessions) {
    if (isSessionBusy(s)) {
      skippedSessionIds.push(s.id);
      continue;
    }
    deletable.push(s);
  }

  console.info("[HistoryClear]", {
    stage: "started",
    storageCount: sessions.length,
    deletableCount: deletable.length,
    skippedCount: skippedSessionIds.length
  });

  const deletedSessionIds: string[] = [];
  const failedSessions: FailedSessionInfo[] = [];
  let reclaimed = 0;
  for (const s of deletable) {
    const result = await deleteRecordingSession(s.id);
    if (result.ok) {
      deletedSessionIds.push(s.id);
      reclaimed += result.reclaimedBytes;
    } else {
      failedSessions.push({
        sessionId: s.id,
        errorCode: result.errorCode || "DELETE_FAILED",
        message: result.error || "无法删除部分录音数据"
      });
    }
  }

  const result: ClearHistoryResult = {
    success: failedSessions.length === 0,
    deletedSessionIds,
    skippedSessionIds,
    failedSessions,
    deletedSessions: deletedSessionIds.length,
    skippedSessions: skippedSessionIds.length,
    failedCount: failedSessions.length,
    deletedCount: deletedSessionIds.length,
    skippedCount: skippedSessionIds.length,
    reclaimedBytes: reclaimed,
    partialFailure: failedSessions.length > 0
  };

  console.info("[HistoryClear]", {
    stage: "storage_completed",
    deletedSessionIds,
    failedCount: failedSessions.length,
    skippedCount: skippedSessionIds.length
  });

  return result;
}
