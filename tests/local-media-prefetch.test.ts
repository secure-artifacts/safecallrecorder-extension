import { describe, expect, it, vi } from "vitest";
import { createLocalMediaPlaylistItem } from "../src/local-media-player";
import {
  clearLocalMediaPrefetch,
  prefetchLocalMediaAudio,
  takePrefetchedAudioBuffer
} from "../src/local-media-prefetch";

vi.mock("../src/local-media-playable", () => ({
  preparePlayableLocalMediaBlob: vi.fn(async (file: Blob) => file)
}));

vi.mock("../src/local-media-audio-engine", () => ({
  decodeLocalAudioBlob: vi.fn(async () => ({ duration: 1 } as AudioBuffer))
}));

describe("local media prefetch", () => {
  it("prefetches audio buffers by playlist item id", async () => {
    const item = createLocalMediaPlaylistItem(new File([], "a.mp3", { type: "audio/mpeg" }));
    expect(item).toBeTruthy();
    prefetchLocalMediaAudio(item!);
    const buffer = await takePrefetchedAudioBuffer(item!.id);
    expect(buffer?.duration).toBe(1);
    clearLocalMediaPrefetch();
  });
});
