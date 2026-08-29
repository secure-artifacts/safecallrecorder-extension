/** Strip only characters illegal in Windows filenames. Do not rewrite letters or symbols. */
export function sanitizeFileBase(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/[\u007F]/g, "")
    .slice(0, 200);
  if (cleaned === "." || cleaned === "..") return "";
  return cleaned;
}

/** Format recording start time as YYYY-MM-DD_HH-mm-ss (legacy / internal). */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function fileBase(displayName: string | undefined, suffix = 0): string {
  const base = sanitizeFileBase(displayName || "") || "未命名录音";
  return suffix > 1 ? `${base}_${suffix}` : base;
}

/** Download filename matches the displayed recording name (+ optional collision suffix). */
export function buildMp3FileName(displayName: string | undefined, suffix = 0): string {
  return `${fileBase(displayName, suffix)}.mp3`;
}

/** Single-part original capture — same base name as MP3, different extension. */
export function buildOriginalFileName(displayName: string | undefined, ext = "webm", suffix = 0): string {
  const cleanExt = sanitizeFileBase(ext).replace(/^\./, "") || "webm";
  return `${fileBase(displayName, suffix)}.${cleanExt}`;
}

/** Multi-part recovery package — same base name, .zip extension. */
export function buildRecoveryZipName(displayName: string | undefined, suffix = 0): string {
  return `${fileBase(displayName, suffix)}.zip`;
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
