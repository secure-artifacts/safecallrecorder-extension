import { AudioLevelConfig, type SoundUiState } from "./audio-level-config";
import { soundStateLabel } from "./audio-detection-state";

export interface LevelSample {
  rms: number;
  peak: number;
  /** Bar magnitudes in 0..1 for mirrored column drawing (not signed oscilloscope samples). */
  waveform: number[];
  /** Instantaneous frame flag — not for UI status; use SoundDetectionEngine. */
  hasSound: boolean;
  isClipping: boolean;
  isNearClipping: boolean;
}

export interface SilenceTracker {
  silentSince: number | null;
  clippingSince: number | null;
  firstSoundAt: number | null;
  maxPeak: number;
  rmsSum: number;
  rmsCount: number;
}

export function createSilenceTracker(): SilenceTracker {
  return { silentSince: null, clippingSince: null, firstSoundAt: null, maxPeak: 0, rmsSum: 0, rmsCount: 0 };
}

/** Nonlinear boost so small levels still move bars without inventing random noise. */
export function boostMagnitude(v: number, gamma = AudioLevelConfig.barGamma): number {
  const x = Math.max(0, Math.min(1, v));
  return Math.pow(x, gamma);
}

/**
 * Build mirrored-bar magnitudes from time-domain bytes.
 * Each bar = peak absolute amplitude in a bin, then nonlinear boost.
 */
export function barsFromTimeDomain(
  data: Uint8Array,
  barCount: number = AudioLevelConfig.waveformPoints
): number[] {
  const bars: number[] = [];
  const bin = Math.max(1, Math.floor(data.length / barCount));
  for (let i = 0; i < barCount; i++) {
    const start = i * bin;
    const end = Math.min(data.length, start + bin);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const a = Math.abs((data[j]! - 128) / 128);
      if (a > peak) peak = a;
    }
    bars.push(Math.round(boostMagnitude(peak) * 1000) / 1000);
  }
  return bars;
}

/** Optional frequency bars (0..1) for fuller visual energy distribution. */
export function barsFromFrequency(
  data: Uint8Array,
  barCount: number = AudioLevelConfig.waveformPoints
): number[] {
  const usable = Math.max(8, Math.floor(data.length * 0.7));
  const bin = Math.max(1, Math.floor(usable / barCount));
  const bars: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const start = i * bin;
    const end = Math.min(usable, start + bin);
    let sum = 0;
    for (let j = start; j < end; j++) sum += data[j]!;
    const avg = sum / Math.max(1, end - start) / 255;
    bars.push(Math.round(boostMagnitude(avg) * 1000) / 1000);
  }
  return bars;
}

/** Blend time + frequency magnitudes (still from real analyser data only). */
export function blendBars(timeBars: number[], freqBars: number[]): number[] {
  const n = Math.min(timeBars.length, freqBars.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(Math.min(1, timeBars[i]! * 0.55 + freqBars[i]! * 0.45));
  }
  return out;
}

/** Compute RMS / peak from time domain and bar magnitudes for UI waveform. */
export function sampleFromTimeDomain(
  data: Uint8Array,
  waveformPoints: number = AudioLevelConfig.waveformPoints,
  frequency?: Uint8Array
): LevelSample {
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const n = (data[i]! - 128) / 128;
    sumSq += n * n;
    const a = Math.abs(n);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, data.length));
  const timeBars = barsFromTimeDomain(data, waveformPoints);
  const waveform = frequency ? blendBars(timeBars, barsFromFrequency(frequency, waveformPoints)) : timeBars;
  // Instantaneous only — status uses SoundDetectionEngine hysteresis.
  const hasSound = rms >= AudioLevelConfig.silenceThreshold;
  const isClipping = peak >= AudioLevelConfig.clippingThreshold;
  const isNearClipping = peak >= AudioLevelConfig.clippingThreshold * 0.85;
  return { rms, peak, waveform, hasSound, isClipping, isNearClipping };
}

export function updateSilenceTracker(tracker: SilenceTracker, sample: LevelSample, now = Date.now()): SilenceTracker {
  tracker.maxPeak = Math.max(tracker.maxPeak, sample.peak);
  tracker.rmsSum += sample.rms;
  tracker.rmsCount += 1;
  if (sample.hasSound) {
    if (tracker.firstSoundAt == null) tracker.firstSoundAt = now;
    tracker.silentSince = null;
  } else if (tracker.silentSince == null) {
    tracker.silentSince = now;
  }
  if (sample.isClipping) {
    if (tracker.clippingSince == null) tracker.clippingSince = now;
  } else {
    tracker.clippingSince = null;
  }
  return tracker;
}

/**
 * @deprecated Prefer SoundDetectionEngine.tick(). Kept for legacy unit tests.
 * Fixed: no longer returns silent on the first quiet frame before hold duration.
 */
export function classifySoundState(
  sample: LevelSample,
  tracker: SilenceTracker,
  opts: { paused?: boolean; disconnected?: boolean; unavailable?: boolean; now?: number } = {}
): SoundUiState {
  if (opts.unavailable) return "unavailable";
  if (opts.disconnected) return "disconnected";
  if (opts.paused) return "paused";
  const now = opts.now ?? Date.now();
  if (tracker.clippingSince != null && now - tracker.clippingSince >= AudioLevelConfig.clippingDurationMs) {
    return "clipping";
  }
  if (tracker.silentSince != null && now - tracker.silentSince >= AudioLevelConfig.silenceDurationMs) {
    return "silent";
  }
  // During hold window, keep previous "sound" classification even if this frame is quiet.
  if (sample.hasSound || (tracker.firstSoundAt != null && tracker.silentSince != null)) {
    if (sample.hasSound && sample.rms < AudioLevelConfig.lowVolumeThreshold) return "low_volume";
    if (tracker.firstSoundAt != null) return sample.hasSound && sample.rms < AudioLevelConfig.lowVolumeThreshold ? "low_volume" : "has_sound";
  }
  if (sample.hasSound && sample.rms < AudioLevelConfig.lowVolumeThreshold) return "low_volume";
  if (sample.hasSound) return "has_sound";
  // Never heard sound yet, or fully silent after hold — silent.
  if (tracker.firstSoundAt == null) return "silent";
  return "has_sound";
}

export { soundStateLabel };

export function volumeBadge(update: {
  soundState: string;
  isClipping: boolean;
  isNearClipping: boolean;
  hasSound: boolean;
  rms: number;
  badge?: string;
}): string {
  if (update.badge) return update.badge;
  if (update.soundState === "clipping" || update.isClipping) return "音量过大";
  if (update.isNearClipping && update.hasSound) return "音量过大";
  if (update.soundState === "low_volume") return "声音较小";
  if (update.soundState === "silent") return "无声音";
  if (update.soundState === "disconnected") return "设备断开";
  if (update.hasSound || update.soundState === "has_sound") return "声音正常";
  return "无声音";
}

export function flatWaveform(points = AudioLevelConfig.waveformPoints): number[] {
  return Array.from({ length: points }, () => 0);
}
