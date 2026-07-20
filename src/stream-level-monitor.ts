import { AudioLevelConfig } from "./audio-level-config";
import { AudioVisualizationConfig } from "./audio-visualization-config";
import { SoundDetectionEngine } from "./audio-detection-state";
import type { DetectionSensitivity } from "./audio-detection-config";
import { flatWaveform, sampleFromTimeDomain } from "./audio-level-analyser";
import type { TrackKind } from "./types";

export interface AudioLevelUpdate {
  type: "AUDIO_LEVEL_UPDATE";
  sessionId: string;
  trackId: TrackKind | "test";
  sourceLabel: string;
  /** Instantaneous / analysis RMS — not for direct DOM display. */
  rms: number;
  smoothedRms?: number;
  peak: number;
  hasSound: boolean;
  isClipping: boolean;
  isNearClipping: boolean;
  soundState: string;
  soundLabel: string;
  badge?: string;
  liveText?: string;
  detail?: string;
  waveform: number[];
  timestamp: number;
  /** Hint only; dashboard DisplaySmoother owns final shown % */
  volumePercent: number;
  peakPercent: number;
  analyserOk: boolean;
}

type Listener = (update: AudioLevelUpdate) => void;

function uiIntervalMs(): number {
  const hidden = typeof document !== "undefined" && document.hidden;
  const hz = hidden
    ? AudioVisualizationConfig.backgroundUiUpdateRateHz
    : AudioVisualizationConfig.uiUpdateRateHz;
  return Math.max(50, Math.floor(1000 / hz));
}

/** Analyse an existing MediaStream without opening another capture device. */
export class StreamLevelMonitor {
  private ctx?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private timer?: ReturnType<typeof setInterval>;
  private detector = new SoundDetectionEngine("standard");
  private listeners = new Set<Listener>();
  private paused = false;
  private disconnected = false;
  private unavailable = false;
  private timeDomain?: Uint8Array<ArrayBuffer>;
  private freqDomain?: Uint8Array<ArrayBuffer>;
  private lastUiEmit = 0;
  private latestDetected?: ReturnType<SoundDetectionEngine["tick"]>;
  private latestSample?: {
    rms: number;
    peak: number;
    waveform: number[];
    isClipping: boolean;
    isNearClipping: boolean;
  };

  constructor(
    private sessionId: string,
    private trackId: TrackKind | "test",
    private sourceLabel: string,
    private stream: MediaStream,
    private hz = AudioVisualizationConfig.audioAnalysisRateHz
  ) {}

  onUpdate(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setPaused(v: boolean) {
    this.paused = v;
  }

  setDisconnected(v: boolean) {
    this.disconnected = v;
  }

  setSensitivity(sensitivity: DetectionSensitivity | string) {
    this.detector.setSensitivity(sensitivity);
  }

  resetDetection() {
    this.detector.reset();
  }

  start() {
    try {
      this.detector.reset();
      this.lastUiEmit = 0;
      this.ctx = new AudioContext();
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = AudioLevelConfig.fftSize;
      this.analyser.smoothingTimeConstant = AudioVisualizationConfig.analyserSmoothingTimeConstant;
      this.source.connect(this.analyser);
      this.timeDomain = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.freqDomain = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        this.disconnected = true;
        this.emitSnapshot(true);
      });
      const interval = Math.max(16, Math.floor(1000 / this.hz));
      this.timer = setInterval(() => this.tick(), interval);
      this.unavailable = false;
    } catch (e) {
      console.error("[StreamLevelMonitor] analyser failed", e);
      this.unavailable = true;
      this.emitSnapshot(true);
    }
  }

  private tick() {
    if (!this.analyser || !this.timeDomain || !this.freqDomain) {
      this.emitSnapshot(false);
      return;
    }
    this.analyser.getByteTimeDomainData(this.timeDomain);
    this.analyser.getByteFrequencyData(this.freqDomain);
    const sample = sampleFromTimeDomain(
      this.timeDomain,
      AudioVisualizationConfig.waveformPoints,
      this.freqDomain
    );
    this.latestSample = {
      rms: sample.rms,
      peak: sample.peak,
      waveform: sample.waveform,
      isClipping: sample.isClipping,
      isNearClipping: sample.isNearClipping
    };
    this.latestDetected = this.detector.tick({
      rms: sample.rms,
      peak: sample.peak,
      paused: this.paused,
      disconnected: this.disconnected,
      unavailable: this.unavailable
    });
    this.maybeEmitToUi(false);
  }

  private emitSnapshot(force: boolean) {
    this.latestSample = {
      rms: 0,
      peak: 0,
      waveform: flatWaveform(AudioVisualizationConfig.waveformPoints),
      isClipping: false,
      isNearClipping: false
    };
    this.latestDetected = this.detector.tick({
      rms: 0,
      peak: 0,
      paused: this.paused,
      disconnected: this.disconnected,
      unavailable: this.unavailable
    });
    this.maybeEmitToUi(force);
  }

  private maybeEmitToUi(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastUiEmit < uiIntervalMs()) return;
    this.lastUiEmit = now;
    if (!this.latestSample || !this.latestDetected) return;

    const detected = this.latestDetected;
    const sample = this.latestSample;
    const update: AudioLevelUpdate = {
      type: "AUDIO_LEVEL_UPDATE",
      sessionId: this.sessionId,
      trackId: this.trackId,
      sourceLabel: this.sourceLabel,
      rms: sample.rms,
      smoothedRms: detected.smoothedRms,
      peak: sample.peak,
      hasSound: detected.hasSound,
      isClipping: detected.isClipping,
      isNearClipping: detected.isNearClipping,
      soundState: detected.soundState,
      soundLabel: detected.soundLabel,
      badge: detected.badge,
      liveText: detected.liveText,
      detail: detected.detail,
      waveform: this.paused || this.disconnected ? flatWaveform(AudioVisualizationConfig.waveformPoints) : sample.waveform,
      timestamp: now,
      // Hints only — dashboard smoother owns final numbers.
      volumePercent: Math.min(100, Math.round(detected.smoothedRms * AudioVisualizationConfig.volumePercentScale)),
      peakPercent: Math.min(100, Math.round(sample.peak * 100)),
      analyserOk: !this.unavailable
    };
    for (const fn of this.listeners) {
      try {
        fn(update);
      } catch (e) {
        console.error("[StreamLevelMonitor] listener error", e);
      }
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    void this.ctx?.close();
    this.listeners.clear();
    this.detector.reset();
  }
}
