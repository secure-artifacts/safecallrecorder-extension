import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildOriginalFileName, buildRecoveryZipName, buildMp3FileName } from "../src/filename";
import { buildStoreZip } from "../src/zip-store";
import { DEFAULT_SETTINGS } from "../src/types";

describe("stop → original download → background MP3 contract", () => {
  it("default settings prefer immediate original then background MP3", () => {
    expect(DEFAULT_SETTINGS.stopDownloadMode).toBe("original_then_mp3");
    expect(DEFAULT_SETTINGS.autoDownloadOriginal).toBe(true);
    expect(DEFAULT_SETTINGS.autoDownloadMp3AfterSuccess).toBe(true);
    expect(DEFAULT_SETTINGS.keepOriginalAfterMp3).toBe(true);
  });

  it("original filenames match display name with webm extension", () => {
    const name = buildOriginalFileName("会议记录", "webm");
    expect(name).toBe("会议记录.webm");
    expect(name.endsWith(".mp3")).toBe(false);
    expect(buildMp3FileName("会议记录")).toBe("会议记录.mp3");
  });

  it("recovery zip uses display name with zip extension", () => {
    expect(buildRecoveryZipName("通话")).toBe("通话.zip");
  });

  it("store zip contains multiple parts", async () => {
    const zip = buildStoreZip([
      { name: "part_001.webm", data: new Uint8Array([1, 2, 3]) },
      { name: "part_002.webm", data: new Uint8Array([4, 5]) },
      { name: "session.json", data: new TextEncoder().encode("{}") }
    ]);
    expect(zip.type).toBe("application/zip");
    expect(zip.size).toBeGreaterThan(50);
    const buf = new Uint8Array(await zip.arrayBuffer());
    // local file header signature
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("WebM auto-download runs on dashboard after stop; staging avoids SW deadlock", () => {
    const offscreen = readFileSync(new URL("../src/offscreen.ts", import.meta.url), "utf8");
    const dashboard = readFileSync(new URL("../src/dashboard.ts", import.meta.url), "utf8");
    const downloadSave = readFileSync(new URL("../src/download-save.ts", import.meta.url), "utf8");
    const staging = readFileSync(new URL("../src/download-staging.ts", import.meta.url), "utf8");
    expect(offscreen).not.toMatch(/downloadOriginalRecording\(sessionId, \{ trigger: "auto" \}\)/);
    expect(dashboard).toContain('downloadOriginalRecording(id, { trigger: "auto" })');
    expect(downloadSave).toContain("stageDownloadBlob");
    expect(downloadSave).toContain("saveDownloadBlobFromStaging");
    expect(staging).toContain("SafeCallRecorderDownloadStaging");
  });

  it("recording stop finalizes as completed without processing_mp3", () => {
    const src = readFileSync(new URL("../src/recording-manager.ts", import.meta.url), "utf8");
    expect(src).toContain('a.session.recordingStatus = "completed"');
    expect(src).toContain('a.session.originalStatus = "available"');
    expect(src).toContain("requestData");
    expect(src).toContain("pendingWrites");
    expect(src).not.toMatch(/historyStatus = reason \? "interrupted" : "processing_mp3"/);
  });

  it("export manager keeps recording completed when MP3 fails", () => {
    const src = readFileSync(new URL("../src/export-manager.ts", import.meta.url), "utf8");
    expect(src).toContain('session.mp3Status = "failed"');
    expect(src).toContain('session.recordingStatus = "completed"');
    expect(src).toContain("encodeMp3Streaming");
    expect(src).toContain("PCM_SLICE_SAMPLES");
    expect(src).toContain("queueMp3GenerationInBackground");
  });

  it("dashboard stop UI no longer waits with 正在生成 MP3", () => {
    const src = readFileSync(new URL("../src/dashboard.ts", import.meta.url), "utf8");
    expect(src).toContain("正在结束录音");
    expect(src).toContain("原始录音下载已开始");
    expect(src).not.toMatch(/setStatus\("正在生成 MP3…"\)/);
    expect(src).toContain("recordingLabel");
    expect(src).toContain("mp3Label");
    expect(src).toContain("下载原始录音");
  });

  it("auto downloads never use saveAs picker", () => {
    const src = readFileSync(new URL("../src/download-save.ts", import.meta.url), "utf8");
    expect(src).toContain("saveAs: false");
    expect(src).toContain("silentAuto");
  });

  it("dashboard settings expose stop download modes", () => {
    const html = readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf8");
    expect(html).toContain('id="stopDownloadMode"');
    expect(html).toContain("original_then_mp3");
    expect(html).toContain("original_only");
    expect(html).toContain("mp3_only");
    expect(html).toContain('id="autoDownloadOriginal"');
    expect(html).toContain('id="keepOriginalAfterMp3"');
  });

  it("session type splits recordingStatus and mp3Status", () => {
    const src = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
    expect(src).toContain("recordingStatus");
    expect(src).toContain("mp3Status");
    expect(src).toContain("originalStatus");
    expect(src).toContain("StopDownloadMode");
  });
});
