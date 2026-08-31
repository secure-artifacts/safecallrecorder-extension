import { describe, expect, it } from "vitest";
import {
  addFilesToPlaylist,
  detectLocalMediaKind,
  formatPlaybackTime,
  isLocalMediaEndedAutoStartEnabled,
  movePlaylistItem,
  reorderPlaylistItemTo,
  playlistPlayingStatus,
  playlistReadyStatus,
  playlistSummary,
  removePlaylistItem
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

  it("builds and edits playlists", () => {
    const a = new File([], "a.mp3", { type: "audio/mpeg" });
    const b = new File([], "b.mp4", { type: "video/mp4" });
    const bad = new File([], "c.txt", { type: "text/plain" });
    const first = addFilesToPlaylist([], [a, bad]);
    expect(first.added).toBe(1);
    expect(first.skipped).toEqual(["c.txt"]);
    expect(first.playlist).toHaveLength(1);

    const second = addFilesToPlaylist(first.playlist, [b]);
    expect(second.playlist).toHaveLength(2);
    const id = second.playlist[0]!.id;
    const moved = movePlaylistItem(second.playlist, id, 1);
    expect(moved[1]!.id).toBe(id);
    expect(reorderPlaylistItemTo(moved, moved[0]!.id, id).map((item) => item.id)).toEqual([
      moved[1]!.id,
      moved[0]!.id
    ]);
    expect(removePlaylistItem(moved, id)).toHaveLength(1);
  });

  it("describes playlist status for sequential playback", () => {
    expect(playlistSummary(0)).toBe("播放列表为空");
    expect(playlistSummary(2)).toBe("共 2 个文件");
    expect(playlistReadyStatus(3, true)).toContain("全部结束后");
    expect(playlistPlayingStatus(1, 4, "part.mp4", true)).toContain("2/4");
    expect(playlistPlayingStatus(1, 4, "part.mp4", true)).toContain("全部播完后");
  });

  it("dashboard exposes local media playlist UI and ended auto-start", () => {
    const html = readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf8");
    const dash = readFileSync(new URL("../src/dashboard.ts", import.meta.url), "utf8");
    expect(html).toContain('id="localMediaCard"');
    expect(html).toContain('id="localMediaFile"');
    expect(html).toContain('id="localMediaPlaylist"');
    expect(html).toContain('id="localMediaClearPlaylistBtn"');
    expect(html).toContain("multiple");
    expect(html).toContain("download-folder-card");
    expect(html).toContain('id="pickDownloadFolder"');
    expect(html).toContain('id="useDownloadFolderBtn"');
    expect(html).toContain('id="downloadFolder"');
    expect(dash).toContain("local_media_ended");
    expect(dash).toContain("playLocalMediaPlaylist");
    expect(dash).toContain("localMediaDragId");
    expect(dash).toContain("deferHistorySync");
    expect(dash).toContain("localMediaSessionActive");
    expect(dash).toContain("reorderLocalMediaPlaylistItem");
    expect(DEFAULT_SETTINGS.autoStartOnLocalMediaEnded).toBe(true);
  });
});
