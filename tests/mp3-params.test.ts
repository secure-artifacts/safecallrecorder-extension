import { describe, expect, it } from "vitest";
import { mixToMono, shouldExportMono, toMp3Kbps } from "../src/mp3-params";

describe("mp3 params", () => {
  it("converts bps to kbps without treating 16000 as kbps", () => {
    expect(toMp3Kbps(16000)).toBe(16);
    expect(toMp3Kbps(64000)).toBe(64);
    expect(toMp3Kbps(128000)).toBe(128);
  });

  it("forces mono for 16 kbps", () => {
    expect(shouldExportMono(16000)).toBe(true);
    expect(shouldExportMono(32000)).toBe(false);
  });

  it("mixes stereo to mono without inventing noise", () => {
    const left = new Float32Array([0.5, -0.5]);
    const right = new Float32Array([0.5, 0.5]);
    const mono = mixToMono(left, right);
    expect(mono[0]).toBeCloseTo(0.5);
    expect(mono[1]).toBeCloseTo(0);
  });
});
