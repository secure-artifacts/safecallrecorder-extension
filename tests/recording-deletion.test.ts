import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRecordingHistory, deleteRecordingSession, isSessionBusy } from "../src/recording-deletion-service";
import { storage } from "../src/storage-manager";
import type { Chunk, Mp3File, Part, Session } from "../src/types";

vi.mock("../src/recording-manager", () => ({
  recordings: { active: new Map() }
}));

vi.mock("../src/export-manager", () => ({
  isMp3Encoding: () => false
}));

function session(partial: Partial<Session> & { id: string }): Session {
  return {
    name: partial.id,
    mode: "device",
    startedAt: Date.now(),
    status: "completed",
    historyStatus: "completed",
    bitrate: 16000,
    hasMp3: true,
    safeDurationMs: 25000,
    recoveryCount: 0,
    mixed: false,
    ...partial
  };
}

async function seed(id: string, busy = false) {
  const s = session({
    id,
    status: busy ? "recording" : "completed",
    historyStatus: busy ? "recording" : "completed"
  });
  await storage.saveSession(s);
  const now = Date.now();
  const part: Part = {
    id: `${id}-part`,
    sessionId: id,
    trackId: "selected_device",
    startedAt: now,
    mimeType: "audio/webm;codecs=opus",
    completed: true
  };
  await storage.savePart(part);
  const chunk: Chunk = {
    id: `${id}-chunk`,
    sessionId: id,
    partId: part.id,
    trackId: "selected_device",
    index: 0,
    startedAt: now,
    endedAt: now + 2000,
    durationMs: 2000,
    size: 4,
    mimeType: "audio/webm;codecs=opus",
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" })
  };
  await storage.saveChunk(chunk);
  const mp3: Mp3File = {
    id: `${id}-mp3`,
    sessionId: id,
    fileName: `${id}.mp3`,
    mimeType: "audio/mpeg",
    size: 8,
    createdAt: now,
    blob: new Blob([new Uint8Array(8)], { type: "audio/mpeg" })
  };
  await storage.saveMp3(mp3);
  return s;
}

describe("recording deletion service", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    storage.resetForTests();
  });

  it("marks recording sessions busy and skips them", async () => {
    const busy = await seed("busy-1", true);
    expect(isSessionBusy(busy)).toBe(true);
    const result = await clearRecordingHistory({ onlySafe: true });
    expect(result.deletedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skippedSessionIds).toEqual(["busy-1"]);
    const sessions = await storage.all<Session>("sessions");
    expect(sessions).toHaveLength(1);
  });

  it("deletes mp3, chunks, parts and session together", async () => {
    await seed("done-1");
    const del = await deleteRecordingSession("done-1");
    expect(del.ok).toBe(true);
    expect(del.sessionId).toBe("done-1");
    expect(del.reclaimedBytes).toBeGreaterThan(0);
    expect(await storage.all("sessions")).toHaveLength(0);
    expect(await storage.all("parts")).toHaveLength(0);
    expect(await storage.all("chunks")).toHaveLength(0);
    expect(await storage.all("mp3Files")).toHaveLength(0);
  });

  it("clearHistory deletes only safe sessions and keeps busy ones", async () => {
    await seed("keep", true);
    await seed("drop");
    const result = await clearRecordingHistory({ onlySafe: true });
    expect(result.deletedSessionIds).toEqual(["drop"]);
    expect(result.skippedSessionIds).toEqual(["keep"]);
    expect(result.deletedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.partialFailure).toBe(false);
    const sessions = await storage.all<Session>("sessions");
    expect(sessions.map((s) => s.id)).toEqual(["keep"]);
  });

  it("single delete and clear share the same busy guard", async () => {
    await seed("live", true);
    const one = await deleteRecordingSession("live");
    expect(one.ok).toBe(false);
    expect(one.sessionId).toBe("live");
    expect(one.error).toMatch(/处理中|录音/);
  });

  it("clear returns deletedSessionIds for UI sync", async () => {
    await seed("a");
    await seed("b");
    const result = await clearRecordingHistory({ onlySafe: true });
    expect(result.success).toBe(true);
    expect(new Set(result.deletedSessionIds)).toEqual(new Set(["a", "b"]));
    expect(result.failedSessions).toEqual([]);
  });
});
