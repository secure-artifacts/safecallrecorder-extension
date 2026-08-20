import { describe, expect, it } from "vitest";
import {
  BITRATE_PRESETS,
  DEFAULT_BITRATE,
  captureAudioBitsPerSecond,
  estimateMp3Mb,
  formatBitrateHistory,
  getBitratePreset,
  resolveBitrate
} from "../src/bitrate-presets";

describe("bitrate presets", () => {
  it("includes fine-grained voice presets in ascending order", () => {
    expect(BITRATE_PRESETS.map((p) => p.bitrate)).toEqual([
      16000, 24000, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000
    ]);
  });

  it("defaults to 64 kbps", () => {
    expect(DEFAULT_BITRATE).toBe(64000);
    expect(getBitratePreset(DEFAULT_BITRATE).badge).toBe("默认推荐");
  });

  it("has Chinese labels and size estimates", () => {
    expect(getBitratePreset(16000).label).toContain("最小文件");
    expect(getBitratePreset(16000).estimatedMbPerHour).toBe(7.2);
    expect(getBitratePreset(16000).warning).toBeTruthy();
    expect(getBitratePreset(32000).estimatedMbPerHour).toBe(14.4);
    expect(getBitratePreset(48000).badge).toBe("均衡推荐");
    expect(getBitratePreset(64000).shortTitle).toBe("重要通话");
    expect(getBitratePreset(96000).estimatedMbPerHour).toBe(43.2);
    expect(getBitratePreset(128000).badge).toBe("适合立体声");
    expect(getBitratePreset(128000).estimatedMbPerHour).toBe(57.6);
  });

  it("estimates 30 minutes at 64 kbps as about 14.4 MB", () => {
    expect(estimateMp3Mb(64000, 30 * 60 * 1000)).toBeCloseTo(14.4, 5);
  });

  it("does not double stereo total bitrate in size estimate", () => {
    // audioBitsPerSecond / lamejs kbps is stream total bitrate.
    expect(estimateMp3Mb(128000, 3_600_000)).toBe(57.6);
  });

  it("formats history labels for pending and completed", () => {
    expect(formatBitrateHistory(64000, true)).toBe("64 kbps · 重要通话");
    expect(formatBitrateHistory(64000, false)).toBe("目标：64 kbps · 重要通话");
  });

  it("resolves unsupported bitrates to nearest preset", () => {
    expect(resolveBitrate(70000)).toBe(64000);
    expect(resolveBitrate(20000)).toBe(16000);
    expect(resolveBitrate(55000)).toBe(56000);
    expect(resolveBitrate(100000)).toBe(96000);
  });

  it("keeps capture quality at or above target and floors low targets", () => {
    expect(captureAudioBitsPerSecond(16000)).toBe(96000);
    expect(captureAudioBitsPerSecond(128000)).toBe(128000);
    expect(captureAudioBitsPerSecond(64000)).toBe(96000);
  });
});
