/** Central config for sound / silence detection (hysteresis, debounce, smoothing). */

export type DetectionSensitivity = "sensitive" | "standard" | "stable";

export type DetectionPreset = {
  soundEnterThresholdRms: number;
  soundExitThresholdRms: number;
  soundConfirmMs: number;
  silenceHoldMs: number;
  minVisibleStateDurationMs: number;
  rmsSmoothingAlpha: number;
  lowVolumeThresholdRms: number;
  clippingThreshold: number;
  clippingDurationMs: number;
  disconnectedTimeoutMs: number;
  noiseFloorWarmupMs: number;
  noiseFloorEnterMultiplier: number;
  noiseFloorExitMultiplier: number;
  maxEnterThresholdRms: number;
  maxExitThresholdRms: number;
};

const BASE = {
  clippingThreshold: 0.98,
  clippingDurationMs: 400,
  disconnectedTimeoutMs: 2500,
  noiseFloorWarmupMs: 1500,
  noiseFloorEnterMultiplier: 2.5,
  noiseFloorExitMultiplier: 1.6,
  maxEnterThresholdRms: 0.045,
  maxExitThresholdRms: 0.028,
  lowVolumeThresholdRms: 0.08,
  rmsSmoothingAlpha: 0.22,
  soundConfirmMs: 200,
  minVisibleStateDurationMs: 800
} as const;

export const DETECTION_PRESETS: Record<DetectionSensitivity, DetectionPreset> = {
  sensitive: {
    ...BASE,
    soundEnterThresholdRms: 0.014,
    soundExitThresholdRms: 0.008,
    silenceHoldMs: 1200,
    soundConfirmMs: 150,
    minVisibleStateDurationMs: 600
  },
  standard: {
    ...BASE,
    soundEnterThresholdRms: 0.018,
    soundExitThresholdRms: 0.01,
    silenceHoldMs: 1800,
    soundConfirmMs: 200,
    minVisibleStateDurationMs: 800
  },
  stable: {
    ...BASE,
    soundEnterThresholdRms: 0.022,
    soundExitThresholdRms: 0.012,
    silenceHoldMs: 2500,
    soundConfirmMs: 250,
    minVisibleStateDurationMs: 1000,
    rmsSmoothingAlpha: 0.18
  }
};

export const DEFAULT_DETECTION_SENSITIVITY: DetectionSensitivity = "standard";

export function resolveDetectionPreset(sensitivity?: DetectionSensitivity | string): DetectionPreset {
  if (sensitivity === "sensitive" || sensitivity === "stable" || sensitivity === "standard") {
    return DETECTION_PRESETS[sensitivity];
  }
  return DETECTION_PRESETS.standard;
}

/** Keep analyser / UI timing knobs here for one import surface. */
export const AudioDetectionShared = {
  fftSize: 512,
  waveformPoints: 72,
  smoothingTimeConstant: 0.8,
  barGamma: 0.62,
  uiAttack: 0.42,
  uiDecay: 0.18,
  maxUpdatesPerSecond: 30,
  monitorStaleMs: 2500,
  hiddenUpdateHz: 2,
  logThrottleMs: 500
} as const;
