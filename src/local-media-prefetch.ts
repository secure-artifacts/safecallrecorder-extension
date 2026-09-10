import { decodeLocalAudioBlob } from "./local-media-audio-engine";
import type { LocalMediaPlaylistItem } from "./local-media-player";
import { preparePlayableLocalMediaBlob } from "./local-media-playable";
import { prepareLocalVideoElement, type LocalVideoPrepareResult } from "./local-media-video-loader";

const audioBufferPrefetch = new Map<string, Promise<AudioBuffer>>();
const audioBufferReady = new Map<string, AudioBuffer>();
const videoPrefetch = new Map<string, Promise<LocalVideoPrepareResult>>();
const videoReady = new Map<string, LocalVideoPrepareResult>();

function revokeVideoPrepareResult(result: LocalVideoPrepareResult): void {
  try {
    result.revoke();
  } catch {
    /* ignore */
  }
}

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

export function prefetchLocalMediaVideo(item: LocalMediaPlaylistItem): void {
  if (item.kind !== "video") return;
  if (videoReady.has(item.id) || videoPrefetch.has(item.id)) return;
  videoPrefetch.set(
    item.id,
    (async () => {
      const probe = document.createElement("video");
      probe.muted = true;
      probe.playsInline = true;
      const blob = await preparePlayableLocalMediaBlob(item.file);
      const prepared = await prepareLocalVideoElement(probe, blob, item.file.name);
      videoReady.set(item.id, prepared);
      videoPrefetch.delete(item.id);
      return prepared;
    })().catch((e) => {
      videoPrefetch.delete(item.id);
      throw e;
    })
  );
}

export function getReadyPrefetchedVideo(id: string): LocalVideoPrepareResult | undefined {
  return videoReady.get(id);
}

export function takePrefetchedVideo(id: string): LocalVideoPrepareResult | undefined {
  const ready = videoReady.get(id);
  if (ready) {
    videoReady.delete(id);
    videoPrefetch.delete(id);
    return ready;
  }
  return undefined;
}

export function clearLocalMediaPrefetch(ids?: Iterable<string>): void {
  if (!ids) {
    for (const result of videoReady.values()) revokeVideoPrepareResult(result);
    audioBufferPrefetch.clear();
    audioBufferReady.clear();
    videoPrefetch.clear();
    videoReady.clear();
    return;
  }
  for (const id of ids) {
    audioBufferPrefetch.delete(id);
    audioBufferReady.delete(id);
    videoPrefetch.delete(id);
    const video = videoReady.get(id);
    if (video) {
      revokeVideoPrepareResult(video);
      videoReady.delete(id);
    }
  }
}

export function prefetchLocalMediaPlaylist(items: LocalMediaPlaylistItem[], fromIndex = 0, count = 2): void {
  const end = Math.min(items.length, fromIndex + count);
  for (let i = fromIndex; i < end; i++) {
    const item = items[i];
    if (!item) continue;
    if (item.kind === "audio") prefetchLocalMediaAudio(item);
    else if (item.kind === "video") prefetchLocalMediaVideo(item);
  }
}

export function prefetchAllLocalMedia(items: LocalMediaPlaylistItem[]): void {
  prefetchLocalMediaPlaylist(items, 0, items.length);
}

/** @deprecated Use prefetchAllLocalMedia */
export function prefetchAllLocalMediaAudio(items: LocalMediaPlaylistItem[]): void {
  for (const item of items) {
    if (item.kind === "audio") prefetchLocalMediaAudio(item);
  }
}

export function isLocalMediaItemPrefetched(item: LocalMediaPlaylistItem): boolean {
  if (item.kind === "audio") return audioBufferReady.has(item.id);
  if (item.kind === "video") return videoReady.has(item.id);
  return true;
}

export function getLocalMediaDecodeStatus(items: LocalMediaPlaylistItem[]): {
  mediaCount: number;
  readyCount: number;
} {
  let mediaCount = 0;
  let readyCount = 0;
  for (const item of items) {
    if (item.kind !== "audio" && item.kind !== "video") continue;
    mediaCount += 1;
    if (isLocalMediaItemPrefetched(item)) readyCount += 1;
  }
  return { mediaCount, readyCount };
}

/** @deprecated Use getLocalMediaDecodeStatus */
export function getLocalMediaAudioDecodeStatus(items: LocalMediaPlaylistItem[]): {
  audioCount: number;
  readyCount: number;
} {
  const status = getLocalMediaDecodeStatus(items.filter((item) => item.kind === "audio"));
  return { audioCount: status.mediaCount, readyCount: status.readyCount };
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

/** Block until background video preload finishes (for wait-for-decode playback mode). */
export async function waitForPrefetchedVideo(item: LocalMediaPlaylistItem): Promise<LocalVideoPrepareResult> {
  if (item.kind !== "video") throw new Error("不是视频文件");
  prefetchLocalMediaVideo(item);
  const ready = getReadyPrefetchedVideo(item.id);
  if (ready) return ready;
  const pending = videoPrefetch.get(item.id);
  if (!pending) throw new Error("无法预加载该视频");
  try {
    return await pending;
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "无法预加载该视频");
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
