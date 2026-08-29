import type { AppSettings } from "./types";

const VIDEO_EXT = /\.(mp4|mkv|mov|avi|wmv|m4v)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|opus|m4a|aac|flac|webm)(\?|#|$)/i;

export type LocalMediaKind = "video" | "audio";

export type LocalMediaPlaylistItem = {
  id: string;
  file: File;
  kind: LocalMediaKind;
};

/** Infer whether a picked file should use <video> or <audio>. */
export function detectLocalMediaKind(file: File): LocalMediaKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  const name = file.name.toLowerCase();
  if (AUDIO_EXT.test(name)) return "audio";
  if (VIDEO_EXT.test(name)) return "video";
  return null;
}

export function createLocalMediaPlaylistItem(
  file: File,
  id = crypto.randomUUID()
): LocalMediaPlaylistItem | null {
  const kind = detectLocalMediaKind(file);
  if (!kind) return null;
  return { id, file, kind };
}

export function addFilesToPlaylist(
  existing: LocalMediaPlaylistItem[],
  files: File[]
): { playlist: LocalMediaPlaylistItem[]; added: number; skipped: string[] } {
  const playlist = [...existing];
  const skipped: string[] = [];
  let added = 0;
  for (const file of files) {
    const item = createLocalMediaPlaylistItem(file);
    if (!item) {
      skipped.push(file.name);
      continue;
    }
    playlist.push(item);
    added += 1;
  }
  return { playlist, added, skipped };
}

export function movePlaylistItem<T extends { id: string }>(items: T[], id: string, delta: -1 | 1): T[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return items;
  const next = index + delta;
  if (next < 0 || next >= items.length) return items;
  const copy = [...items];
  [copy[index], copy[next]] = [copy[next]!, copy[index]!];
  return copy;
}

export function reorderPlaylistItemTo<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
  if (fromId === toId) return items;
  const fromIdx = items.findIndex((item) => item.id === fromId);
  const toIdx = items.findIndex((item) => item.id === toId);
  if (fromIdx < 0 || toIdx < 0) return items;
  const copy = [...items];
  const [moved] = copy.splice(fromIdx, 1);
  if (!moved) return items;
  copy.splice(toIdx, 0, moved);
  return copy;
}

export function removePlaylistItem<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

export function isLocalMediaEndedAutoStartEnabled(
  settings: Pick<AppSettings, "autoStartOnLocalMediaEnded">
): boolean {
  return settings.autoStartOnLocalMediaEnded !== false;
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m % 60)}:${pad(s % 60)}`;
  return `${pad(m)}:${pad(s % 60)}`;
}

export function playlistPlayingStatus(
  index: number,
  total: number,
  fileName: string,
  autoStartEnabled: boolean
): string {
  const pos = `${index + 1}/${total}`;
  if (autoStartEnabled) {
    return total > 1
      ? `正在播放 ${pos}：${fileName} … 全部播完后将自动开始录音。`
      : `正在播放：${fileName} … 播完后将自动开始录音。`;
  }
  return total > 1 ? `正在播放 ${pos}：${fileName}` : `正在播放：${fileName}`;
}

export function playlistReadyStatus(total: number, autoStartEnabled: boolean): string {
  if (total <= 0) return "添加 mp4、mp3 等本地文件到播放列表；全部播完后将自动开始录音（需在设置中开启）。";
  if (total === 1) {
    return autoStartEnabled
      ? "已添加 1 个文件。双击条目或点击「播放列表」，播完后将自动开始录音。"
      : "已添加 1 个文件。双击条目或点击「播放列表」开始；自动录音需在设置中开启。";
  }
  return autoStartEnabled
    ? `已添加 ${total} 个文件。双击条目可从该文件开始播放，全部结束后将自动开始录音。`
    : `已添加 ${total} 个文件。双击条目可从该文件开始播放；自动录音需在设置中开启。`;
}

export function playlistSummary(total: number): string {
  if (total <= 0) return "播放列表为空";
  return total === 1 ? "共 1 个文件" : `共 ${total} 个文件`;
}
