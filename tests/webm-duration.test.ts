import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  finalizeWebmDuration,
  inferWebmDurationMs,
  webmHasSeekMetadata,
  __webmDurationTestUtils as u
} from "../src/webm-duration";

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function buildLiveWebm(): Uint8Array {
  const ebml = u.encodeElement(u.ID_EBML, new Uint8Array([0x42, 0x86, 0x81, 0x01]));
  const info = u.encodeElement(u.ID_INFO, u.encodeElement(u.ID_TIMESTAMP_SCALE, u.writeUint(1_000_000)));
  const tracks = u.encodeElement(u.ID_TRACKS, new Uint8Array([0xae, 0x81, 0x00]));
  const cluster = (tc: number) => u.encodeElement(u.ID_CLUSTER, u.encodeElement(u.ID_TIMECODE, u.writeUint(tc)));
  const segment = u.encodeElement(u.ID_SEGMENT, concat(info, tracks, cluster(0), cluster(1500), cluster(3000)));
  return concat(ebml, segment);
}

function findId(data: Uint8Array, id: number[]): number {
  outer: for (let i = 0; i <= data.length - id.length; i++) {
    for (let j = 0; j < id.length; j++) if (data[i + j] !== id[j]) continue outer;
    return i;
  }
  return -1;
}

describe("webm duration metadata", () => {
  it("adds Duration and Cues so players can show total time", () => {
    const raw = buildLiveWebm();
    expect(webmHasSeekMetadata(raw)).toBe(false);
    const fixed = finalizeWebmDuration(raw, 4500);
    expect(webmHasSeekMetadata(fixed)).toBe(true);
    expect(findId(fixed, u.ID_DURATION)).toBeGreaterThan(-1);
    expect(findId(fixed, u.ID_CUES)).toBeGreaterThan(-1);
    expect(inferWebmDurationMs(fixed)).toBeGreaterThanOrEqual(4500);
  });

  it("infers duration from cluster timecodes when hint is missing", () => {
    const raw = buildLiveWebm();
    const inferred = inferWebmDurationMs(raw);
    expect(inferred).toBeGreaterThanOrEqual(4500);
    const fixed = finalizeWebmDuration(raw, 0);
    expect(webmHasSeekMetadata(fixed)).toBe(true);
    expect(inferWebmDurationMs(fixed)).toBeGreaterThanOrEqual(inferred);
  });

  it("does not rewrite a file that already has Duration and Cues", () => {
    const raw = buildLiveWebm();
    const once = finalizeWebmDuration(raw, 4500);
    const twice = finalizeWebmDuration(once, 4500);
    expect(twice).toBe(once);
  });
});

describe("original export writes seekable WebM", () => {
  it("patches assembled originals before download", () => {
    const src = readFileSync(new URL("../src/download/original-download-service.ts", import.meta.url), "utf8");
    expect(src).toContain("finalizeWebmDurationBlob");
    expect(src).toContain("durationHintMs");
  });

  it("local player patches WebM so the progress bar has a duration", () => {
    const dash = readFileSync(new URL("../src/dashboard.ts", import.meta.url), "utf8");
    expect(dash).toContain("finalizeWebmDurationBlob");
  });
});
