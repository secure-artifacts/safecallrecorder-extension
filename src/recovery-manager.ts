import { storage } from "./storage-manager";
import type { Session } from "./types";

export async function recoverIncomplete(activeIds: string[] = []) {
  const sessions = await storage.all<Session>("sessions");
  const unfinished = sessions.filter(
    (s) => ["starting", "recording", "paused", "exporting"].includes(s.status) && !activeIds.includes(s.id)
  );
  for (const s of unfinished) {
    s.status = "interrupted";
    s.recordingStatus = "interrupted";
    s.historyStatus = s.safeDurationMs > 0 ? "partial" : "interrupted";
    s.originalStatus = s.safeDurationMs > 0 ? "available" : "missing";
    if (s.mp3Status === "queued" || s.mp3Status === "decoding" || s.mp3Status === "encoding") {
      s.mp3Status = "failed";
      s.mp3Error = s.mp3Error || "浏览器关闭时 MP3 尚未完成，可重新生成。";
    }
    s.interruptionReason ??= "browser_closed_or_crashed";
    await storage.saveSession(s);
  }
  return storage.all<Session>("sessions");
}
