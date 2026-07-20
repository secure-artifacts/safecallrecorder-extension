import { describe, expect, it } from "vitest";
import { buildMp3FileName, sanitizeFileBase } from "../src/filename";
import { sampleFromTimeDomain, createSilenceTracker, updateSilenceTracker, classifySoundState } from "../src/audio-level-analyser";
import { AudioLevelConfig } from "../src/audio-level-config";

describe("filename", () => {
  it("builds stamp-only names", () => {
    const name = buildMp3FileName(undefined, new Date("2026-07-18T19:42:08").getTime());
    expect(name).toMatch(/^2026-07-18_19-42-08\.mp3$/);
  });

  it("includes sanitized display name", () => {
    const name = buildMp3FileName("VK通话", new Date("2026-07-18T19:42:08").getTime());
    expect(name).toBe("VK通话_2026-07-18_19-42-08.mp3");
  });

  it("strips illegal path characters", () => {
    expect(sanitizeFileBase("../a\\b:c*?.txt")).not.toMatch(/[<>:"/\\|?*]/);
    expect(sanitizeFileBase("../secret")).not.toContain("..");
  });

  it("adds numeric suffix for collisions", () => {
    expect(buildMp3FileName("会议", 0, 2)).toContain("_2.mp3");
  });
});

describe("ui simplification contract", () => {
  it("dashboard html has core controls only", async () => {
    const { readFileSync } = await import("node:fs");
    const html = readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf8");
    expect(html).toContain('id="device"');
    expect(html).toContain('id="start"');
    expect(html).toContain('id="stop"');
    expect(html).toContain('id="bitrate"');
    expect(html).toContain('id="recName"');
    expect(html).toContain("录音历史");
    expect(html).toContain('id="clearHistory"');
    expect(html).toContain("清空历史");
    expect(html).toContain('id="confirmModal"');
    const live = html.indexOf('id="liveMonitor"');
    const start = html.indexOf('id="start"');
    const bitrate = html.indexOf('id="bitrate"');
    expect(live).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(live);
    expect(bitrate).toBeGreaterThan(start);
    expect(html).not.toContain(">暂停</");
    expect(html).not.toContain("id=\"pause\"");
    expect(html).not.toContain("测试3秒");
    expect(html).not.toContain("网页声音＋");
    expect(html).not.toContain("同时生成混合录音");
    expect(html).not.toContain("未完成录音");
  });

  it("manifest has no default_popup", async () => {
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
    expect(manifest.action.default_popup).toBeUndefined();
  });
});

describe("levels", () => {
  it("silent input stays near flat", () => {
    const data = new Uint8Array(512).fill(128);
    const sample = sampleFromTimeDomain(data);
    expect(sample.hasSound).toBe(false);
    expect(sample.waveform.every((v) => v === 0)).toBe(true);
  });

  it("marks silence after threshold duration", () => {
    const tracker = createSilenceTracker();
    const data = new Uint8Array(512).fill(128);
    const sample = sampleFromTimeDomain(data);
    updateSilenceTracker(tracker, sample, 1);
    expect(classifySoundState(sample, tracker, { now: 1 + AudioLevelConfig.silenceDurationMs })).toBe("silent");
  });
});
