import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  findAllClusterOffsets,
  findByteIdOffset,
  groupChunksIntoWindows,
  looksLikeWebm,
  mediaClusterSlices,
  splitWebmInitAndMedia,
  WEBM_CLUSTER_ID,
  WEBM_EBML_ID
} from "../src/webm-decode-windows";

describe("webm decode windows", () => {
  it("finds EBML and Cluster ids", () => {
    const bytes = new Uint8Array(40);
    bytes.set(WEBM_EBML_ID, 0);
    bytes.set(WEBM_CLUSTER_ID, 24);
    expect(looksLikeWebm(bytes)).toBe(true);
    expect(findByteIdOffset(bytes, WEBM_CLUSTER_ID)).toBe(24);
  });

  it("splits init segment from first Cluster", () => {
    const bytes = new Uint8Array(32);
    bytes.set(WEBM_EBML_ID, 0);
    bytes.set(WEBM_CLUSTER_ID, 10);
    bytes[14] = 0xaa;
    const split = splitWebmInitAndMedia(bytes);
    expect(split).not.toBeNull();
    expect(split!.init.length).toBe(10);
    expect(split!.firstMedia[0]).toBe(0x1f);
    expect(split!.firstMedia[4]).toBe(0xaa);
  });

  it("returns null when Cluster is missing", () => {
    const bytes = new Uint8Array(WEBM_EBML_ID);
    expect(splitWebmInitAndMedia(bytes)).toBeNull();
  });

  it("packs chunks into time and size windows without splitting a chunk", () => {
    const chunks = [
      { blob: new Blob([new Uint8Array(100)]), size: 100, durationMs: 1500 },
      { blob: new Blob([new Uint8Array(100)]), size: 100, durationMs: 1500 },
      { blob: new Blob([new Uint8Array(100)]), size: 100, durationMs: 1500 },
      { blob: new Blob([new Uint8Array(4000)]), size: 4000, durationMs: 1500 }
    ];
    const windows = groupChunksIntoWindows(chunks, { maxBytes: 250, maxDurationMs: 4000 });
    expect(windows).toHaveLength(3);
    expect(windows[0]!.startIndex).toBe(0);
    expect(windows[0]!.endIndex).toBe(1);
    expect(windows[0]!.blobs).toHaveLength(2);
    expect(windows[1]!.startIndex).toBe(2);
    expect(windows[1]!.endIndex).toBe(2);
    expect(windows[2]!.size).toBe(4000);
  });

  it("splits a long WebM by Cluster ids", () => {
    const bytes = new Uint8Array(120);
    bytes.set(WEBM_EBML_ID, 0);
    bytes.set(WEBM_CLUSTER_ID, 16);
    bytes.set(WEBM_CLUSTER_ID, 50);
    bytes.set(WEBM_CLUSTER_ID, 90);
    expect(findAllClusterOffsets(bytes)).toEqual([16, 50, 90]);
    const slices = mediaClusterSlices(bytes, 40);
    expect(slices.length).toBeGreaterThan(1);
    expect(slices[0]![0]).toBe(0x1f);
  });

  it("keeps a single oversized chunk as its own window", () => {
    const windows = groupChunksIntoWindows(
      [{ blob: new Blob([new Uint8Array(99)]), size: 99, durationMs: 90_000 }],
      { maxBytes: 10, maxDurationMs: 1000 }
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]!.size).toBe(99);
  });
});

describe("export manager uses windowed decode for long recordings", () => {
  const dashboard = readFileSync(new URL("../src/export-manager.ts", import.meta.url), "utf8");

  it("decodes MediaRecorder chunks in windows instead of one AudioBuffer", () => {
    expect(dashboard).toContain("decodeWebmWindows");
    expect(dashboard).toContain("groupChunksIntoWindows");
    expect(dashboard).toContain("chunksForPart");
    expect(dashboard).toContain("MAX_DECODE_WINDOW");
  });
});
