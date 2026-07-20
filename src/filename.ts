/** Sanitize recording names for safe download filenames (no path traversal). */
export function sanitizeFileBase(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "";
}

/** Format recording start time as YYYY-MM-DD_HH-mm-ss */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function coreName(displayName: string | undefined, startedAt: number, suffix = 0): string {
  const stamp = formatStamp(startedAt);
  const base = sanitizeFileBase(displayName || "");
  const core = base ? `${base}_${stamp}` : stamp;
  return suffix > 1 ? `${core}_${suffix}` : core;
}

export function buildMp3FileName(displayName: string | undefined, startedAt: number, suffix = 0): string {
  return `${coreName(displayName, startedAt, suffix)}.mp3`;
}

/** Single-part original capture (usually WebM/Opus). */
export function buildOriginalFileName(
  displayName: string | undefined,
  startedAt: number,
  ext = "webm",
  suffix = 0
): string {
  const cleanExt = sanitizeFileBase(ext).replace(/^\./, "") || "webm";
  return `${coreName(displayName, startedAt, suffix)}_original.${cleanExt}`;
}

/** Multi-part recovery package. */
export function buildRecoveryZipName(displayName: string | undefined, startedAt: number, suffix = 0): string {
  return `${coreName(displayName, startedAt, suffix)}_recovery.zip`;
}

export {
  BITRATE_OPTIONS,
  BITRATE_PRESETS,
  DEFAULT_BITRATE,
  captureAudioBitsPerSecond,
  estimateMp3Mb,
  formatBitrateHistory,
  getBitratePreset,
  resolveBitrate
} from "./bitrate-presets";
