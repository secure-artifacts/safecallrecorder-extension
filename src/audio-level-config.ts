import { AudioDetectionShared, DETECTION_PRESETS } from "./audio-detection-config";

/**
 * Shared analyser / UI knobs. Sound/silence hysteresis lives in audio-detection-config.ts.
 * Legacy fields kept for older tests; prefer SoundDetectionEngine for status.
 */
export const AudioLevelConfig = {
  /** @deprecated Use dual thresholds in DETECTION_PRESETS.standard */
  silenceThreshold: DETECTION_PRESETS.standard.soundExitThresholdRms,
  lowVolumeThreshold: DETECTION_PRESETS.standard.lowVolumeThresholdRms,
  clippingThreshold: DETECTION_PRESETS.standard.clippingThreshold,
  /** @deprecated Use silenceHoldMs from detection preset */
  silenceDurationMs: DETECTION_PRESETS.standard.silenceHoldMs,
  longSilenceDurationMs: 10000,
  clippingDurationMs: DETECTION_PRESETS.standard.clippingDurationMs,
  fftSize: AudioDetectionShared.fftSize,
  waveformPoints: AudioDetectionShared.waveformPoints,
  smoothingTimeConstant: AudioDetectionShared.smoothingTimeConstant,
  barGamma: AudioDetectionShared.barGamma,
  uiAttack: AudioDetectionShared.uiAttack,
  uiDecay: AudioDetectionShared.uiDecay,
  maxUpdatesPerSecond: AudioDetectionShared.maxUpdatesPerSecond,
  monitorStaleMs: AudioDetectionShared.monitorStaleMs,
  hiddenUpdateHz: AudioDetectionShared.hiddenUpdateHz
} as const;

export type SoundUiState =
  | "has_sound"
  | "low_volume"
  | "silent"
  | "clipping"
  | "paused"
  | "disconnected"
  | "unavailable";
