import { decodeLocalAudioBlob } from "./local-media-audio-engine";
import type { LocalMediaPlaylistItem } from "./local-media-player";
import { preparePlayableLocalMediaBlob } from "./local-media-playable";

const audioBufferPrefetch = new Map<string, Promise<AudioBuffer>>();
const audioBufferReady = new Map<string, AudioBuffer>();

export function prefetchLocalMediaAudio(item: LocalMediaPlaylistItem): void {
  if (item.kind !== "audio") return;
  if (audioBufferReady.has(item.id) || audioBufferPrefetch.has(item.id)) return;
  audioBufferPrefetch.set(
    item.id,
    preparePlayableLocalMediaBlob(item.file)
      .then((blob) => decodeLocalAudioBlob(blob))
      .then((buffer) => {
        audioBufferReady.set(item.id, buffer);
        audioBufferPrefetch.delete(item.id);
        return buffer;
      })
      .catch((e) => {
        audioBufferPrefetch.delete(item.id);
        throw e;
      })
  );
}

/** Return decoded audio only when already ready — never blocks playback. */
export function getReadyPrefetchedAudioBuffer(id: string): AudioBuffer | undefined {
  return audioBufferReady.get(id);
}

/** Wait for background decode; playback should not call this. */
export async function awaitPrefetchedAudioBuffer(id: string): Promise<AudioBuffer | undefined> {
  const ready = getReadyPrefetchedAudioBuffer(id);
  if (ready) return ready;
  const pending = audioBufferPrefetch.get(id);
  if (!pending) return undefined;
  try {
    return await pending;
  } catch {
    return undefined;
  }
}

export function takePrefetchedAudioBuffer(id: string): AudioBuffer | undefined {
  const ready = audioBufferReady.get(id);
  if (ready) {
    audioBufferReady.delete(id);
    audioBufferPrefetch.delete(id);
    return ready;
  }
  return undefined;
}

export function clearLocalMediaPrefetch(ids?: Iterable<string>): void {
  if (!ids) {
    audioBufferPrefetch.clear();
    audioBufferReady.clear();
    return;
  }
  for (const id of ids) {
    audioBufferPrefetch.delete(id);
    audioBufferReady.delete(id);
  }
}

export function prefetchLocalMediaPlaylist(items: LocalMediaPlaylistItem[], fromIndex = 0, count = 2): void {
  const end = Math.min(items.length, fromIndex + count);
  for (let i = fromIndex; i < end; i++) {
    const item = items[i];
    if (item?.kind === "audio") prefetchLocalMediaAudio(item);
  }
}

export function prefetchAllLocalMediaAudio(items: LocalMediaPlaylistItem[]): void {
  prefetchLocalMediaPlaylist(items, 0, items.length);
}

export function getLocalMediaAudioDecodeStatus(items: LocalMediaPlaylistItem[]): {
  audioCount: number;
  readyCount: number;
} {
  let audioCount = 0;
  let readyCount = 0;
  for (const item of items) {
    if (item.kind !== "audio") continue;
    audioCount += 1;
    if (audioBufferReady.has(item.id)) readyCount += 1;
  }
  return { audioCount, readyCount };
}

/** Block until background decode finishes (for wait-for-decode playback mode). */
export async function waitForPrefetchedAudioBuffer(item: LocalMediaPlaylistItem): Promise<AudioBuffer> {
  if (item.kind !== "audio") throw new Error("不是音频文件");
  prefetchLocalMediaAudio(item);
  const ready = getReadyPrefetchedAudioBuffer(item.id);
  if (ready) return ready;
  const pending = audioBufferPrefetch.get(item.id);
  if (!pending) throw new Error("无法解码该音频");
  try {
    return await pending;
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "无法解码该音频");
  }
}

/** Wait briefly for background decode; falls back to instant element playback. */
export async function tryReadyAudioBuffer(id: string, waitMs = 250): Promise<AudioBuffer | undefined> {
  const ready = getReadyPrefetchedAudioBuffer(id);
  if (ready) return ready;
  const pending = audioBufferPrefetch.get(id);
  if (!pending || waitMs <= 0) return undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), waitMs))
    ]);
  } catch {
    return undefined;
  }
}
