import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportHistoryBackup,
  importHistoryBackup,
  HISTORY_BACKUP_FORMAT_VERSION
} from "../src/history-backup";
import { storage } from "../src/storage-manager";
import type { Chunk, Mp3File, Part, Session } from "../src/types";
import { readStoreZip } from "../src/zip-read";

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
    displayName: partial.displayName || partial.id,
    ...partial
  };
}

async function seed(id: string, busy = false) {
  const s = session({
    id,
    status: busy ? "recording" : "completed",
    historyStatus: busy ? "recording" : "completed",
    displayName: `录音-${id}`
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
    blob: new Blob([new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12])], { type: "audio/mpeg" })
  };
  await storage.saveMp3(mp3);
  return s;
}

describe("history backup", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    storage.resetForTests();
  });

  it("exports safe sessions and skips busy ones", async () => {
    await seed("done-1");
    await seed("busy-1", true);
    const exported = await exportHistoryBackup();
    expect(exported.exportedSessions).toBe(1);
    expect(exported.skippedSessionIds).toEqual(["busy-1"]);
    expect(exported.blob.size).toBeGreaterThan(0);

    const entries = readStoreZip(await exported.blob.arrayBuffer());
    const manifest = JSON.parse(new TextDecoder().decode(entries.get("manifest.json")));
    expect(manifest.formatVersion).toBe(HISTORY_BACKUP_FORMAT_VERSION);
    expect(manifest.sessions).toHaveLength(1);
    expect(manifest.sessions[0].id).toBe("done-1");
    expect(manifest.chunks).toHaveLength(1);
    expect(manifest.mp3Files).toHaveLength(1);
  });

  it("imports backup with remapped ids and preserves blobs", async () => {
    await seed("src-1");
    const exported = await exportHistoryBackup();
    await storage.removeSession("src-1");
    expect(await storage.all("sessions")).toHaveLength(0);

    const result = await importHistoryBackup(exported.blob);
    expect(result.importedSessions).toBe(1);
    expect(result.skippedSessions).toBe(0);

    const sessions = await storage.all<Session>("sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).not.toBe("src-1");
    expect(sessions[0]!.displayName).toBe("录音-src-1");
    expect(sessions[0]!.status).toBe("completed");
    expect(sessions[0]!.hasMp3).toBe(true);
    expect(sessions[0]!.mp3Status).toBe("completed");
    expect(sessions[0]!.originalStatus).toBe("available");
    expect(sessions[0]!.historyStatus).toBe("completed");
    expect(sessions[0]!.fileSize).toBeGreaterThan(0);

    const parts = await storage.all<Part>("parts");
    expect(parts).toHaveLength(1);
    expect(parts[0]!.sessionId).toBe(sessions[0]!.id);

    const chunks = await storage.all<Chunk>("chunks");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.sessionId).toBe(sessions[0]!.id);
    const chunkBuf = new Uint8Array(await chunks[0]!.blob.arrayBuffer());
    expect([...chunkBuf]).toEqual([1, 2, 3, 4]);

    const mp3s = await storage.all<Mp3File>("mp3Files");
    expect(mp3s).toHaveLength(1);
    expect(mp3s[0]!.sessionId).toBe(sessions[0]!.id);
    const mp3Buf = new Uint8Array(await mp3s[0]!.blob.arrayBuffer());
    expect([...mp3Buf]).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("normalizes busy session status on import", async () => {
    const { buildStoreZip } = await import("../src/zip-store");
    const now = Date.now();
    const manifest = {
      formatVersion: HISTORY_BACKUP_FORMAT_VERSION,
      app: "SafeCallRecorder",
      exportedAt: now,
      sessions: [
        {
          id: "old-busy",
          name: "old-busy",
          mode: "device",
          status: "recording",
          recordingStatus: "recording",
          historyStatus: "recording",
          mp3Status: "encoding",
          mp3Progress: 55,
          startedAt: now,
          bitrate: 64000,
          safeDurationMs: 1000,
          recoveryCount: 0,
          mixed: false
        }
      ],
      parts: [
        {
          id: "old-part",
          sessionId: "old-busy",
          trackId: "selected_device",
          startedAt: now,
          mimeType: "audio/webm",
          completed: true
        }
      ],
      chunks: [
        {
          id: "old-chunk",
          sessionId: "old-busy",
          partId: "old-part",
          trackId: "selected_device",
          index: 0,
          startedAt: now,
          endedAt: now + 1000,
          durationMs: 1000,
          size: 2,
          mimeType: "audio/webm",
          blobPath: "blobs/chunks/old-chunk.bin"
        }
      ],
      mp3Files: []
    };
    const blob = buildStoreZip([
      { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
      { name: "blobs/chunks/old-chunk.bin", data: new Uint8Array([1, 2]) }
    ]);

    const result = await importHistoryBackup(blob);
    expect(result.importedSessions).toBe(1);
    const sessions = await storage.all<Session>("sessions");
    expect(sessions[0]!.status).toBe("interrupted");
    expect(sessions[0]!.recordingStatus).toBe("interrupted");
    expect(sessions[0]!.mp3Status).toBe("failed");
    expect(sessions[0]!.mp3Progress).toBeUndefined();
  });
});
