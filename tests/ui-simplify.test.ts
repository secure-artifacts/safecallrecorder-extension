import { describe, expect, it } from "vitest";
import { buildMp3FileName, sanitizeFileBase } from "../src/filename";
import { sampleFromTimeDomain, createSilenceTracker, updateSilenceTracker, classifySoundState } from "../src/audio-level-analyser";
import { AudioLevelConfig } from "../src/audio-level-config";

describe("ui simplification contract", () => {
  it("dashboard html has core controls only", async () => {
    const { readFileSync } = await import("node:fs");
    const html = readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf8");
    expect(html).toContain('id="device"');
    expect(html).toContain('id="start"');
    expect(html).toContain('id="stop"');
    expect(html).toContain('id="bitrate"');
    expect(html).toContain('id="recNamePreview"');
    expect(html).toContain('id="recNameToggles"');
    expect(html).toContain('id="recNameEditor" class="rec-name-editor hidden"');
    expect(html).toContain('id="recNameEditToggle"');
    expect(html).toContain('id="recNameAddBtn"');
    expect(html).toContain('id="recNameItemFields"');
    expect(html).toContain('data-add="date"');
    expect(html).toContain('data-add="number"');
    expect(html).toContain('data-add="custom"');
    expect(html).toContain('data-add="space"');
    expect(html).toContain('id="recNameDateMd"');
    expect(html).toContain('id="recNameDateYmd"');
    expect(html).toContain("录音历史");
    expect(html).toContain('id="clearHistory"');
    expect(html).toContain('id="exportHistory"');
    expect(html).toContain('id="importHistory"');
    expect(html).toContain('id="importHistoryFile"');
    expect(html).toContain('class="history-toolbar"');
    expect(html).toContain("导出备份");
    expect(html).toContain("导入备份");
    expect(html).toContain("清空历史");
    expect(html).toContain('id="googleDriveOAuthIdentity"');
    expect(html).toContain("步骤 0：确认扩展 ID 与重定向 URI");
    expect(html).toContain('id="googleDriveCopyRedirectUri"');
    expect(html).toContain('id="googleDriveOpenExtensionsPage"');
    expect(html).not.toContain("emelhfpkanogoiegfanfbbgmglhiblfp");
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
