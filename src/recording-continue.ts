import type { Session } from "./types";

const ACTIVE_RECORDING = new Set(["recording", "starting", "paused"]);

/** Whether a history session can append new audio onto existing saved content. */
export function canContinueRecording(session: Session): boolean {
  const hasSavedAudio =
    (session.safeDurationMs != null && session.safeDurationMs > 0) || session.originalStatus === "available";
  if (!hasSavedAudio) return false;
  if (ACTIVE_RECORDING.has(session.recordingStatus || "")) return false;
  if (ACTIVE_RECORDING.has(session.status)) return false;
  return true;
}
