import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  downloadRecordingMp3,
  getMp3BlobForSession,
  __downloadTestUtils
} from "../src/download/mp3-download-service";
import { storage } from "../src/storage-manager";
import { buildMp3FileName, sanitizeFileBase } from "../src/filename";
import type { Mp3File, Session } from "../src/types";

describe("mp3 download service", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    storage.resetForTests();
    __downloadTestUtils.sessionLocks.clear();
    __downloadTestUtils.objectUrlByDownloadId.clear();
  });

  it("returns structured error when MP3 blob is missing", async () => {
    await storage.saveSession({
      id: "s1",
      name: "s1",
      mode: "device",
      status: "completed",
      historyStatus: "completed",
      startedAt: Date.now(),
      safeDurationMs: 18000,
      recoveryCount: 0,
      bitrate: 16000,
      mixed: false,
      hasMp3: true
    } satisfies Session);
    const result = await getMp3BlobForSession("s1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MP3_BLOB_NOT_FOUND");
  });

  it("loads MP3 blob for completed session", async () => {
    const sessionId = "s2";
    const blob = new Blob([new Uint8Array(256).fill(1)], { type: "audio/mpeg" });
    await storage.saveSession({
      id: sessionId,
      name: sessionId,
      mode: "device",
      status: "completed",
      historyStatus: "completed",
      startedAt: Date.now(),
      safeDurationMs: 18000,
      recoveryCount: 0,
      bitrate: 16000,
      mixed: false,
      hasMp3: true,
      fileSize: blob.size,
      mp3FileName: "2026-07-18_23-28-05.mp3"
    } satisfies Session);
    const file: Mp3File = {
      id: "mp3-1",
      sessionId,
      fileName: "2026-07-18_23-28-05.mp3",
      mimeType: "audio/mpeg",
      size: blob.size,
      createdAt: Date.now(),
      blob
    };
    await storage.saveMp3(file);
    const result = await getMp3BlobForSession(sessionId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.size).toBe(256);
      expect(result.filename).toBe("2026-07-18_23-28-05.mp3");
      expect(result.mimeType).toBe("audio/mpeg");
    }
  });

  it("rejects empty blob without starting download", async () => {
    const sessionId = "s3";
    await storage.saveSession({
      id: sessionId,
      name: sessionId,
      mode: "device",
      status: "completed",
      historyStatus: "completed",
      startedAt: Date.now(),
      safeDurationMs: 1000,
      recoveryCount: 0,
      bitrate: 16000,
      mixed: false,
      hasMp3: true
    } satisfies Session);
    await storage.saveMp3({
      id: "mp3-empty",
      sessionId,
      fileName: "empty.mp3",
      mimeType: "audio/mpeg",
      size: 0,
      createdAt: Date.now(),
      blob: new Blob([], { type: "audio/mpeg" })
    });
    const result = await getMp3BlobForSession(sessionId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MP3_BLOB_INVALID");
  });

  it("dedupes concurrent downloads for the same session", async () => {
    const sessionId = "s4";
    const blob = new Blob([new Uint8Array(128).fill(2)], { type: "audio/mpeg" });
    await storage.saveSession({
      id: sessionId,
      name: sessionId,
      mode: "device",
      status: "completed",
      historyStatus: "completed",
      startedAt: Date.now(),
      safeDurationMs: 1000,
      recoveryCount: 0,
      bitrate: 16000,
      mixed: false,
      hasMp3: true,
      mp3FileName: "test.mp3"
    } satisfies Session);
    await storage.saveMp3({
      id: "mp3-4",
      sessionId,
      fileName: "test.mp3",
      mimeType: "audio/mpeg",
      size: blob.size,
      createdAt: Date.now(),
      blob
    });

    const download = vi.fn(async (_opts: chrome.downloads.DownloadOptions) => 42);
    (globalThis as unknown as { chrome: unknown }).chrome = {
      downloads: {
        download,
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
      },
      runtime: { lastError: undefined }
    };

    const a = downloadRecordingMp3(sessionId, "manual");
    const b = downloadRecordingMp3(sessionId, "manual");
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
    expect(download).toHaveBeenCalledTimes(1);
    const arg = download.mock.calls[0]?.[0] as chrome.downloads.DownloadOptions;
    expect(arg).toMatchObject({
      filename: "SafeCallRecorder/test.mp3",
      conflictAction: "uniquify",
      saveAs: false
    });
    expect(String(arg.url)).toMatch(/^blob:/);
  });

  it("source and dist manifests include downloads permission", () => {
    const src = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
    expect(src.permissions).toContain("downloads");
    let dist: { permissions: string[] };
    try {
      dist = JSON.parse(readFileSync(new URL("../dist/manifest.json", import.meta.url), "utf8"));
    } catch {
      dist = src;
    }
    expect(dist.permissions).toContain("downloads");
  });

  it("sanitizes download filenames", () => {
    expect(sanitizeFileBase('a<>:"/\\|?*.mp3')).not.toMatch(/[<>:"/\\|?*]/);
    expect(buildMp3FileName("会议", new Date("2026-07-18T23:28:05").getTime())).toBe(
      "会议_2026-07-18_23-28-05.mp3"
    );
  });
});
