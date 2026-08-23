import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("history UI sync after delete/clear", () => {
  const dashboard = readFileSync(new URL("../src/dashboard.ts", import.meta.url), "utf8");
  const deletion = readFileSync(new URL("../src/recording-deletion-service.ts", import.meta.url), "utf8");
  const reconcile = readFileSync(new URL("../src/download/mp3-download-service.ts", import.meta.url), "utf8");

  it("maintains historyRecords as UI source of truth", () => {
    expect(dashboard).toContain("let historyRecords: Session[]");
    expect(dashboard).toContain("function applyHistoryRecords");
    expect(dashboard).toContain("function removeSessionsFromUi");
  });

  it("invalidates in-flight refresh with historyRequestVersion", () => {
    expect(dashboard).toContain("let historyRequestVersion");
    expect(dashboard).toContain("invalidateHistoryReads");
    expect(dashboard).toContain("poll_discarded");
    expect(dashboard).toContain("reload_discarded");
  });

  it("removes cards immediately after delete without location.reload", () => {
    expect(dashboard).toContain("removeSessionsFromUi([deletedId])");
    expect(dashboard).toContain('setStatus("录音已删除。")');
    expect(dashboard).not.toContain("location.reload");
    expect(dashboard).not.toContain("window.location.reload");
  });

  it("clear uses deletedSessionIds to update UI", () => {
    expect(dashboard).toContain("removeSessionsFromUi(deletedIds)");
    expect(dashboard).toContain("已清空全部录音历史");
    expect(deletion).toContain("deletedSessionIds");
    expect(deletion).toContain("skippedSessionIds");
    expect(deletion).toContain("failedSessions");
  });

  it("renderHistory clears DOM before appending", () => {
    expect(dashboard).toContain("host.replaceChildren()");
    expect(dashboard).toContain('dataset.sessionId = s.id');
  });

  it("supports multi-page sync via BroadcastChannel and message", () => {
    expect(dashboard).toContain("BroadcastChannel");
    expect(dashboard).toContain("RecordingHistoryChanged");
    expect(dashboard).toContain("applyRemoteHistoryChange");
    expect(dashboard).toContain("safe-call-recorder-history");
  });

  it("stops playback and releases object URL on delete", () => {
    expect(dashboard).toContain("stopPlaybackIfSession");
    expect(dashboard).toContain("URL.revokeObjectURL");
    expect(dashboard).toContain("playingAudio");
  });

  it("guards clear button against double submit", () => {
    expect(dashboard).toContain("clearingHistory");
    expect(dashboard).toContain("正在清空……");
    expect(dashboard).toContain("if (clearingHistory) return");
  });

  it("does not resurrect deleted sessions during reconcile", () => {
    expect(reconcile).toContain("Never resurrect");
    expect(reconcile).toContain('some((s) => s.id === session.id)');
  });

  it("lets saved recordings export MP3 at a chosen bitrate", () => {
    expect(dashboard).toContain("history-export-bitrate");
    expect(dashboard).toContain("导出MP3");
    expect(dashboard).toContain("overrideBitrate: target");
    expect(dashboard).toContain("BITRATE_PRESETS");
  });

  it("keeps the export-bitrate select open across history polls", () => {
    expect(dashboard).toContain("exportBitrateChoice");
    expect(dashboard).toContain("isHistoryExportSelectOpen");
    expect(dashboard).toContain("lastHistoryListKey");
    expect(dashboard).toContain("holdHistoryExportUi");
    expect(dashboard).toContain("if (!force && isHistoryExportSelectOpen()) return");
    expect(dashboard).toContain("if (!force && nextKey === lastHistoryListKey && host.childElementCount > 0) return");
  });

  it("delete and UI share sessionId field", () => {
    expect(deletion).toContain("sessionId: string");
    expect(dashboard).toContain("uiSessionId");
    expect(dashboard).toContain("serviceSessionId");
  });
});
