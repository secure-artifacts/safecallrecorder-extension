import type { AppSettings } from "./types";

const VIDEO_EXT = /\.(mp4|webm|mkv|mov|avi|wmv|m4v)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|opus|m4a|aac|flac)(\?|#|$)/i;

export type LocalMediaKind = "video" | "audio";

/** Infer whether a picked file should use <video> or <audio>. */
export function detectLocalMediaKind(file: File): LocalMediaKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  const name = file.name.toLowerCase();
  if (VIDEO_EXT.test(name)) return "video";
  if (AUDIO_EXT.test(name)) return "audio";
  return null;
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
