/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { createLocalMediaPlaylistItem } from "../src/local-media-player";
import {
  awaitPrefetchedAudioBuffer,
  clearLocalMediaPrefetch,
  getLocalMediaDecodeStatus,
  getReadyPrefetchedAudioBuffer,
  prefetchLocalMediaAudio,
  prefetchLocalMediaVideo,
  takePrefetchedAudioBuffer,
  tryReadyAudioBuffer,
  waitForPrefetchedAudioBuffer,
  waitForPrefetchedVideo
} from "../src/local-media-prefetch";

vi.mock("../src/local-media-playable", () => ({
  preparePlayableLocalMediaBlob: vi.fn(async (file: Blob) => file)
}));

vi.mock("../src/local-media-audio-engine", () => ({
  decodeLocalAudioBlob: vi.fn(async () => ({ duration: 1 } as AudioBuffer))
}));

vi.mock("../src/local-media-video-loader", () => ({
  prepareLocalVideoElement: vi.fn(async () => ({
    objectUrl: "blob:mock-video",
    revoke: vi.fn()
  }))
}));

describe("local media prefetch", () => {
  it("exposes ready buffers without blocking playback", async () => {
    const item = createLocalMediaPlaylistItem(new File([], "a.mp3", { type: "audio/mpeg" }));
    expect(item).toBeTruthy();
    prefetchLocalMediaAudio(item!);
    expect(getReadyPrefetchedAudioBuffer(item!.id)).toBeUndefined();
    const decoded = await awaitPrefetchedAudioBuffer(item!.id);
    expect(decoded?.duration).toBe(1);
    const buffer = takePrefetchedAudioBuffer(item!.id);
    expect(buffer?.duration).toBe(1);
    clearLocalMediaPrefetch();
  });

  it("reports audio decode progress for playlists", async () => {
    const a = createLocalMediaPlaylistItem(new File([], "a.mp3", { type: "audio/mpeg" }));
    const b = createLocalMediaPlaylistItem(new File([], "b.mp4", { type: "video/mp4" }));
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    prefetchLocalMediaAudio(a!);
    expect(getLocalMediaDecodeStatus([a!, b!])).toEqual({ mediaCount: 2, readyCount: 0 });
    await awaitPrefetchedAudioBuffer(a!.id);
    expect(getLocalMediaDecodeStatus([a!, b!])).toEqual({ mediaCount: 2, readyCount: 1 });
    clearLocalMediaPrefetch();
  });

  it("waitForPrefetchedAudioBuffer blocks until decode completes", async () => {
    const item = createLocalMediaPlaylistItem(new File([], "c.mp3", { type: "audio/mpeg" }));
    expect(item).toBeTruthy();
    const pending = waitForPrefetchedAudioBuffer(item!);
    const ready = await pending;
    expect(ready.duration).toBe(1);
    clearLocalMediaPrefetch();
  });

  it("prefetches video into memory before playback", async () => {
    const item = createLocalMediaPlaylistItem(new File([], "clip.mp4", { type: "video/mp4" }));
    expect(item).toBeTruthy();
    prefetchLocalMediaVideo(item!);
    const prepared = await waitForPrefetchedVideo(item!);
    expect(prepared.objectUrl).toBe("blob:mock-video");
    clearLocalMediaPrefetch();
  });

  it("tryReadyAudioBuffer returns immediately when decode already finished", async () => {
    const item = createLocalMediaPlaylistItem(new File([], "b.mp3", { type: "audio/mpeg" }));
    expect(item).toBeTruthy();
    prefetchLocalMediaAudio(item!);
    await awaitPrefetchedAudioBuffer(item!.id);
    const ready = await tryReadyAudioBuffer(item!.id, 0);
    expect(ready?.duration).toBe(1);
    clearLocalMediaPrefetch();
  });
});
