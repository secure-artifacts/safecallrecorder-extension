import { describe, expect, it } from "vitest";
import {
  detectLocalMediaKind,
  formatPlaybackTime,
  isLocalMediaEndedAutoStartEnabled
} from "../src/local-media-player";
import { DEFAULT_SETTINGS } from "../src/types";
import { readFileSync } from "node:fs";

describe("local media player", () => {
  it("detects video and audio files", () => {
    expect(detectLocalMediaKind(new File([], "clip.mp4", { type: "video/mp4" }))).toBe("video");
    expect(detectLocalMediaKind(new File([], "song.mp3", { type: "audio/mpeg" }))).toBe("audio");
    expect(detectLocalMediaKind(new File([], "voice.wav", { type: "" }))).toBe("audio");
    expect(detectLocalMediaKind(new File([], "rec.webm", { type: "audio/webm" }))).toBe("audio");
    expect(detectLocalMediaKind(new File([], "rec_original.webm", { type: "" }))).toBe("audio");
    expect(detectLocalMediaKind(new File([], "notes.txt", { type: "text/plain" }))).toBe(null);
  });

  it("formats playback durations", () => {
    expect(formatPlaybackTime(65)).toBe("01:05");
    expect(formatPlaybackTime(3661)).toBe("01:01:01");
  });

  it("enables post-play auto-start independently of master switch", () => {
    expect(isLocalMediaEndedAutoStartEnabled({ autoStartOnLocalMediaEnded: true })).toBe(true);
    expect(isLocalMediaEndedAutoStartEnabled({ autoStartOnLocalMediaEnded: undefined })).toBe(true);
    expect(isLocalMediaEndedAutoStartEnabled({ autoStartOnLocalMediaEnded: false })).toBe(false);
  });

  it("dashboard exposes local media player UI and ended auto-start", () => {
    const html = readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf8");
    const dash = readFileSync(new URL("../src/dashboard.ts", import.meta.url), "utf8");
    expect(html).toContain('id="localMediaCard"');
    expect(html).toContain('id="localMediaFile"');
    expect(html).toContain('id="autoStartOnLocalMediaEnded"');
    expect(dash).toContain("local_media_ended");
    expect(dash).not.toContain('tryAutoStartRecording("local_media_ended",');
    expect(dash).toContain("localMediaPlaybackActive");
    expect(DEFAULT_SETTINGS.autoStartOnLocalMediaEnded).toBe(true);
  });
});
