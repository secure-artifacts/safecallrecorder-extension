import { describe, expect, it } from "vitest";
import { isLocalMediaUrl, suggestRecordingName } from "../src/auto-start";
import { readFileSync } from "node:fs";

describe("auto-start", () => {
  it("detects file:// and media extensions", () => {
    expect(isLocalMediaUrl("file:///D:/Videos/demo.mp4")).toBe(true);
    expect(isLocalMediaUrl("file:///C:/Music/song.mp3")).toBe(true);
    expect(isLocalMediaUrl("blob:chrome-extension://abc/def")).toBe(true);
    expect(isLocalMediaUrl("https://example.com/video.mp4")).toBe(true);
    expect(isLocalMediaUrl("https://example.com/page.html")).toBe(false);
  });

  it("suggests recording name from tab title or file path", () => {
    expect(suggestRecordingName("lecture.mp4", "file:///D:/lecture.mp4")).toBe("lecture");
    expect(suggestRecordingName("", "file:///D:/Music/my_song.mp3")).toBe("my_song");
  });

  it("dashboard wires auto-start settings and preview hook", () => {
    const dash = readFileSync(new URL("../src/dashboard.ts", import.meta.url), "utf8");
    expect(dash).toContain("tryAutoStartRecording");
    expect(dash).toContain("autoStartRecording");
    expect(dash).toContain("autoStartOnLocalMediaEnded");
    expect(dash).toContain("RequestAutoStart");
    expect(dash).toContain("previewHadSound");
    expect(dash).toContain("localMediaPlaybackActive");
  });

  it("service worker monitors tab audible for local media", () => {
    const sw = readFileSync(new URL("../src/service-worker.ts", import.meta.url), "utf8");
    expect(sw).toContain("chrome.tabs.onUpdated");
    expect(sw).toContain("isLocalMediaUrl");
    expect(sw).toContain("handleLocalMediaAutoStart");
  });

  it("manifest includes tabs permission", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
    expect(manifest.permissions).toContain("tabs");
  });
});
