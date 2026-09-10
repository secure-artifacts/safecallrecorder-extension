import { describe, expect, it, vi } from "vitest";
import { createLocalMediaPlaylistItem } from "../src/local-media-player";
import {
  awaitPrefetchedAudioBuffer,
  clearLocalMediaPrefetch,
  getLocalMediaAudioDecodeStatus,
  getReadyPrefetchedAudioBuffer,
  prefetchLocalMediaAudio,
  takePrefetchedAudioBuffer,
  tryReadyAudioBuffer,
  waitForPrefetchedAudioBuffer
} from "../src/local-media-prefetch";

vi.mock("../src/local-media-playable", () => ({
  preparePlayableLocalMediaBlob: vi.fn(async (file: Blob) => file)
}));

vi.mock("../src/local-media-audio-engine", () => ({
  decodeLocalAudioBlob: vi.fn(async () => ({ duration: 1 } as AudioBuffer))
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
    expect(getLocalMediaAudioDecodeStatus([a!, b!])).toEqual({ audioCount: 1, readyCount: 0 });
    await awaitPrefetchedAudioBuffer(a!.id);
    expect(getLocalMediaAudioDecodeStatus([a!, b!])).toEqual({ audioCount: 1, readyCount: 1 });
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
