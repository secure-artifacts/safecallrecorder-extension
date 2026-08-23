import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  buildId3v2Tag,
  finalizeMp3Buffer,
  mp3HasSeekMetadata,
  scanMp3Frames,
  skipId3v2
} from "../src/mp3-metadata";
import { toMp3Kbps } from "../src/mp3-params";

function encodeTestMp3(seconds = 2): Uint8Array {
  const require = createRequire(import.meta.url);
  const minPath = require.resolve("lamejs/lame.min.js");
  const code = readFileSync(minPath, "utf8");
  const sandbox: {
    self: Record<string, unknown>;
    lamejs?: {
      Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => {
        encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
        flush(): Int8Array;
      };
    };
  } = { self: {} };
  sandbox.self = sandbox;
  vm.runInNewContext(code, sandbox, { filename: "lame.min.js" });
  const encoder = new sandbox.lamejs!.Mp3Encoder(1, 48000, toMp3Kbps(64000));
  const sampleCount = 48000 * seconds;
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.floor(Math.sin(i / 40) * 12000);
  }
  const parts: Int8Array[] = [];
  for (let i = 0; i < samples.length; i += 1152) {
    const buf = encoder.encodeBuffer(samples.subarray(i, i + 1152));
    if (buf.length) parts.push(buf);
  }
  const end = encoder.flush();
  if (end.length) parts.push(end);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe("mp3-metadata", () => {
  it("builds ID3v2 tag with TLEN", () => {
    const tag = buildId3v2Tag({ durationMs: 125000, title: "测试录音 №12" });
    expect(tag[0]).toBe(0x49);
    expect(tag[1]).toBe(0x44);
    expect(tag[2]).toBe(0x33);
    const body = String.fromCharCode(...tag.subarray(10, 10 + 80));
    expect(body).toContain("TLEN");
    expect(body).toContain("125000");
    expect(body).toContain("TIT2");
    const titleStart = (() => {
      for (let i = 10; i < tag.length - 4; i++) {
        if (tag[i] === 0x54 && tag[i + 1] === 0x49 && tag[i + 2] === 0x54 && tag[i + 3] === 0x32) return i;
      }
      return -1;
    })();
    expect(titleStart).toBeGreaterThan(0);
    expect(tag[titleStart + 10]).toBe(1);
    expect(tag[titleStart + 11]).toBe(0xff);
    expect(tag[titleStart + 12]).toBe(0xfe);
    const decoded = new TextDecoder("utf-16le").decode(tag.subarray(titleStart + 13));
    expect(decoded.startsWith("测试录音 №12")).toBe(true);
  });

  it("detects lamejs output lacks seek metadata", () => {
    const raw = encodeTestMp3(1);
    expect(mp3HasSeekMetadata(raw)).toBe(false);
    expect(scanMp3Frames(raw).frames.length).toBeGreaterThan(10);
  });

  it("adds Info frame + ID3 so players can seek", () => {
    const raw = encodeTestMp3(3);
    const durationMs = 3000;
    const finalized = finalizeMp3Buffer(raw, { durationMs, title: "demo" });
    expect(finalized.length).toBeGreaterThan(raw.length);
    expect(mp3HasSeekMetadata(finalized)).toBe(true);
    expect(skipId3v2(finalized)).toBeGreaterThan(10);

    const audioStart = skipId3v2(finalized);
    const tag = String.fromCharCode(
      finalized[audioStart + 4 + 17]!,
      finalized[audioStart + 4 + 18]!,
      finalized[audioStart + 4 + 19]!,
      finalized[audioStart + 4 + 20]!
    );
    expect(tag).toBe("Info");

    const { frames } = scanMp3Frames(finalized, audioStart);
    expect(frames.length).toBeGreaterThan(scanMp3Frames(raw).frames.length);
  });

  it("is idempotent when metadata already present", () => {
    const raw = encodeTestMp3(1);
    const once = finalizeMp3Buffer(raw, { durationMs: 1000 });
    const twice = finalizeMp3Buffer(once, { durationMs: 1000 });
    expect(twice.length).toBe(once.length);
  });
});
