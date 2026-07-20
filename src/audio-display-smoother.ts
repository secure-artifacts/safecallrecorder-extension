import { AudioVisualizationConfig as C } from "./audio-visualization-config";

export type DisplayPushInput = {
  rms: number;
  peak: number;
  waveform: number[];
  now?: number;
};

export type DisplaySnapshot = {
  /** Quantized volume shown in DOM. */
  volumePercent: number;
  /** Peak hold value shown in DOM. */
  peakPercent: number;
  /** Spatially smoothed target bars (0..1) for rAF interpolation. */
  waveformTarget: number[];
  /** Continuous internal display RMS (not quantized). */
  displayRms: number;
  noiseFloor: number;
  volumeChanged: boolean;
  peakChanged: boolean;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function spatialSmooth(bars: number[], weights = C.waveformSpatialWeights): number[] {
  if (bars.length < 3) return bars.slice();
  const [wp, ws, wn] = weights;
  const out = new Array<number>(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const prev = bars[i - 1] ?? bars[i]!;
    const self = bars[i]!;
    const next = bars[i + 1] ?? bars[i]!;
    out[i] = prev * wp + self * ws + next * wn;
  }
  return out;
}

/** Quantize percent with wider steps at low levels. */
export function quantizeVolumePercent(raw: number): number {
  const v = Math.max(0, Math.min(100, raw));
  if (v <= 10) return Math.round(v / 2) * 2;
  if (v <= 30) return Math.round(v / 2) * 2;
  return Math.round(v / 2) * 2;
}

/**
 * Display-only smoother: attack/release volume, peak hold, gated+spatial waveform targets.
 * Does not touch MediaStream / MediaRecorder.
 */
export class AudioDisplaySmoother {
  private displayRms = 0;
  private shownVolume = 0;
  private peakDisplay = 0;
  private peakHoldUntil = 0;
  private noiseFloor = 0;
  private noiseSamples: number[] = [];
  private startedAt = 0;
  private lastTargetPush = 0;
  private waveformTarget: number[];
  private lastEmittedVolume = -1;
  private lastEmittedPeak = -1;

  constructor(points: number = C.waveformPoints) {
    this.waveformTarget = Array.from({ length: points }, () => C.idleBarHeight);
  }

  reset() {
    this.displayRms = 0;
    this.shownVolume = 0;
    this.peakDisplay = 0;
    this.peakHoldUntil = 0;
    this.noiseFloor = 0;
    this.noiseSamples = [];
    this.startedAt = 0;
    this.lastTargetPush = 0;
    this.waveformTarget = this.waveformTarget.map(() => C.idleBarHeight);
    this.lastEmittedVolume = -1;
    this.lastEmittedPeak = -1;
  }

  private learnNoiseFloor(rms: number, now: number) {
    if (!this.startedAt) this.startedAt = now;
    if (now - this.startedAt > C.noiseFloorWarmupMs) return;
    if (rms > C.visualNoiseGateMinRms * 2) return;
    this.noiseSamples.push(rms);
    if (this.noiseSamples.length > C.noiseFloorMaxSamples) this.noiseSamples.shift();
    if (this.noiseSamples.length >= 10) {
      const sorted = [...this.noiseSamples].sort((a, b) => a - b);
      this.noiseFloor = sorted[Math.floor(sorted.length * 0.35)] ?? 0;
    }
  }

  private gateRms(rms: number): number {
    const gate = Math.max(C.visualNoiseGateMinRms, this.noiseFloor * C.visualNoiseGateMultiplier);
    return Math.max(0, rms - gate);
  }

  private stepToward(current: number, target: number, attackMs: number, releaseMs: number, dtMs: number): number {
    const tau = target > current ? attackMs : releaseMs;
    const alpha = 1 - Math.exp(-Math.max(1, dtMs) / Math.max(1, tau));
    return current + (target - current) * alpha;
  }

  /**
   * Ingest a raw analysis sample. Updates internal display state.
   * Call on every analysis tick or throttled UI tick — safe either way.
   */
  push(input: DisplayPushInput): DisplaySnapshot {
    const now = input.now ?? Date.now();
    const dt = this.lastTargetPush ? Math.min(250, Math.max(8, now - this.lastTargetPush)) : C.uiUpdateIntervalMs;
    this.lastTargetPush = now;

    this.learnNoiseFloor(input.rms, now);
    const gated = this.gateRms(input.rms);
    this.displayRms = this.stepToward(
      this.displayRms,
      gated,
      C.volumeAttackMs,
      C.volumeReleaseMs,
      dt
    );

    const continuousPercent = Math.min(100, this.displayRms * C.volumePercentScale);
    if (Math.abs(continuousPercent - this.shownVolume) >= C.volumeDisplayDeadbandPercent || this.shownVolume === 0) {
      this.shownVolume = continuousPercent;
    }
    const volumePercent = quantizeVolumePercent(this.shownVolume);

    // Peak hold (display %)
    const instantPeakPercent = Math.min(100, Math.max(0, input.peak * 100));
    if (instantPeakPercent > this.peakDisplay) {
      const attackAlpha = 1 - Math.exp(-dt / Math.max(1, C.peakAttackMs));
      this.peakDisplay = this.peakDisplay + (instantPeakPercent - this.peakDisplay) * Math.max(attackAlpha, 0.55);
      this.peakHoldUntil = now + C.peakHoldMs;
    } else if (now >= this.peakHoldUntil) {
      const decay = (C.peakDecayPercentPerSecond * dt) / 1000;
      this.peakDisplay = Math.max(volumePercent, this.peakDisplay - decay);
    }
    const peakPercent = Math.round(this.peakDisplay);

    // Waveform: gate, spatial smooth, floor to idle height
    const gate = Math.max(C.visualNoiseGateMinRms, this.noiseFloor * C.visualNoiseGateMultiplier);
    const raw = input.waveform.length ? input.waveform : this.waveformTarget;
    const gatedBars = raw.map((v) => {
      const adj = Math.max(0, v - gate * 2.2);
      if (adj <= 0.002) return C.idleBarHeight;
      return clamp01(C.idleBarHeight + adj * (1 - C.idleBarHeight));
    });
    // Resize target array if needed
    if (gatedBars.length !== this.waveformTarget.length) {
      this.waveformTarget = gatedBars.slice();
    } else {
      this.waveformTarget = spatialSmooth(gatedBars);
    }

    const volumeChanged = volumePercent !== this.lastEmittedVolume;
    const peakChanged = peakPercent !== this.lastEmittedPeak;
    if (volumeChanged) this.lastEmittedVolume = volumePercent;
    if (peakChanged) this.lastEmittedPeak = peakPercent;

    return {
      volumePercent,
      peakPercent,
      waveformTarget: this.waveformTarget.slice(),
      displayRms: this.displayRms,
      noiseFloor: this.noiseFloor,
      volumeChanged,
      peakChanged
    };
  }

  /** Interpolate display bars toward targets (call from rAF). */
  interpolateBars(current: number[], target: number[]): number[] {
    const n = Math.max(current.length, target.length);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const t = target[i] ?? C.idleBarHeight;
      const c = current[i] ?? C.idleBarHeight;
      const factor = t > c ? C.waveformAttackFactor : C.waveformReleaseFactor;
      out[i] = c + (t - c) * factor;
    }
    return out;
  }

  getNoiseFloor() {
    return this.noiseFloor;
  }
}
