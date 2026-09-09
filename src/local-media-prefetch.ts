import { decodeLocalAudioBlob } from "./local-media-audio-engine";
import type { LocalMediaPlaylistItem } from "./local-media-player";
import { preparePlayableLocalMediaBlob } from "./local-media-playable";

const audioBufferPrefetch = new Map<string, Promise<AudioBuffer>>();

export function prefetchLocalMediaAudio(item: LocalMediaPlaylistItem): void {
  if (item.kind !== "audio") return;
  if (audioBufferPrefetch.has(item.id)) return;
  audioBufferPrefetch.set(
    item.id,
    preparePlayableLocalMediaBlob(item.file)
      .then((blob) => decodeLocalAudioBlob(blob))
      .catch((e) => {
        audioBufferPrefetch.delete(item.id);
        throw e;
      })
  );
}

export async function takePrefetchedAudioBuffer(id: string): Promise<AudioBuffer | undefined> {
  const pending = audioBufferPrefetch.get(id);
  if (!pending) return undefined;
  audioBufferPrefetch.delete(id);
  try {
    return await pending;
  } catch {
    return undefined;
  }
}

export function clearLocalMediaPrefetch(ids?: Iterable<string>): void {
  if (!ids) {
    audioBufferPrefetch.clear();
    return;
  }
  for (const id of ids) audioBufferPrefetch.delete(id);
}

export function prefetchLocalMediaPlaylist(items: LocalMediaPlaylistItem[], fromIndex = 0, count = 2): void {
  const end = Math.min(items.length, fromIndex + count);
  for (let i = fromIndex; i < end; i++) {
    const item = items[i];
    if (item?.kind === "audio") prefetchLocalMediaAudio(item);
  }
}
