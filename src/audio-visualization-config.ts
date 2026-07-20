/** Display-only visualization knobs. Never modify MediaRecorder / recording streams. */

export const AudioVisualizationConfig = {
  /** Internal analyser tick rate (detection still runs every tick). */
  audioAnalysisRateHz: 30,
  /** Max UI payload / display-target updates per second (foreground). */
  uiUpdateRateHz: 10,
  uiUpdateIntervalMs: 100,
  /** Background tab UI emit rate. */
  backgroundUiUpdateRateHz: 2,

  /** Display RMS attack / release (time constants). */
  volumeAttackMs: 120,
  volumeReleaseMs: 500,
  /** Ignore tiny display-percent changes. */
  volumeDisplayDeadbandPercent: 2,
  /** Quantize shown volume to this step (low range). */
  volumeQuantizationPercent: 2,

  /** Peak hold + decay (display only). */
  peakHoldMs: 1200,
  peakDecayPercentPerSecond: 12,
  peakAttackMs: 50,

  /** Per-bar temporal interpolation toward target. */
  waveformAttackFactor: 0.3,
  waveformReleaseFactor: 0.1,
  /** Spatial blur weights for [prev, self, next]. */
  waveformSpatialWeights: [0.25, 0.5, 0.25] as const,

  /** Analyser node smoothing for raw capture. */
  analyserSmoothingTimeConstant: 0.82,

  /** Display noise gate relative to estimated floor. */
  visualNoiseGateMultiplier: 1.5,
  /** Absolute minimum visual gate in RMS units. */
  visualNoiseGateMinRms: 0.012,
  /** Idle short-bar height as fraction of full scale (0..1). */
  idleBarHeight: 0.035,
  /** Minimum drawn bar half-height in CSS pixels before DPR. */
  minimumBarHeightPx: 3,

  /** Noise floor learning. */
  noiseFloorWarmupMs: 1500,
  noiseFloorMaxSamples: 48,

  /** Map smoothed RMS → display percent (slightly boosted for readability). */
  volumePercentScale: 140,

  waveformPoints: 72
} as const;

export type AudioVisualizationConfigType = typeof AudioVisualizationConfig;
