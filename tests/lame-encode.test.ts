import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { toMp3Kbps } from "../src/mp3-params";

/**
 * Production loads dist/lame.min.js via importScripts (not the broken CJS entry).
 * This test mirrors that path and proves 16 kbps mono encoding works.
 */
describe("lamejs 16 kbps encode", () => {
  it("encodes mono PCM at 16 kbps via lame.min.js", () => {
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
    const lamejs = sandbox.lamejs;
    expect(lamejs?.Mp3Encoder).toBeTypeOf("function");

    const kbps = toMp3Kbps(16000);
    expect(kbps).toBe(16);
    expect(kbps).not.toBe(16000);

    const encoder = new lamejs!.Mp3Encoder(1, 48000, kbps);
    const samples = new Int16Array(1152 * 20);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.floor(Math.sin(i / 20) * 8000);
    }
    const parts: Int8Array[] = [];
    for (let i = 0; i < samples.length; i += 1152) {
      const buf = encoder.encodeBuffer(samples.subarray(i, i + 1152));
      if (buf.length) parts.push(buf);
    }
    const end = encoder.flush();
    if (end.length) parts.push(end);
    const total = parts.reduce((n, p) => n + p.length, 0);
    expect(total).toBeGreaterThan(64);
  });

  it("documents that CJS lamejs entry hits MPEGMode bug", () => {
    const require = createRequire(import.meta.url);
    const lamejs = require("lamejs") as {
      Mp3Encoder: new (c: number, sr: number, kbps: number) => unknown;
    };
    expect(() => new lamejs.Mp3Encoder(1, 48000, 16)).toThrow(/MPEGMode/);
  });

  it("rejects treating 16 as already-bps accidentally", () => {
    expect(toMp3Kbps(16000)).toBe(16);
    expect(() => toMp3Kbps(16)).toThrow();
  });
});
