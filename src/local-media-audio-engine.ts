import { AudioLevelConfig } from "./audio-level-config";
import { AudioVisualizationConfig } from "./audio-visualization-config";

/** Decode local audio into memory and play via Web Audio (no HTMLMediaElement buffering). */

export type LocalMediaAudioEngineCallbacks = {
  onPlaying?: () => void;
  onPaused?: () => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
};

let sharedAudioContext: AudioContext | null = null;

export function getSharedLocalMediaAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext({ latencyHint: "playback" });
  }
  return sharedAudioContext;
}

export async function decodeLocalAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const ctx = getSharedLocalMediaAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  const data = await blob.arrayBuffer();
  try {
    return await ctx.decodeAudioData(data.slice(0));
  } catch {
    throw new Error("无法解码该音频文件");
  }
}

export class LocalMediaAudioEngine {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private startedAt = 0;
  private offsetSec = 0;
  private intentionalStop = false;
  private playing = false;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private readonly callbacks: LocalMediaAudioEngineCallbacks;

  constructor(callbacks: LocalMediaAudioEngineCallbacks = {}) {
    this.callbacks = callbacks;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isPaused(): boolean {
    if (!this.buffer || this.playing) return false;
    return this.offsetSec > 0 && this.offsetSec < this.buffer.duration - 0.05;
  }

  get hasBuffer(): boolean {
    return this.buffer !== null;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get playbackAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  getCurrentTime(): number {
    if (!this.buffer) return 0;
    const ctx = sharedAudioContext;
    if (this.playing && ctx) {
      return Math.min(this.offsetSec + (ctx.currentTime - this.startedAt), this.buffer.duration);
    }
    return this.offsetSec;
  }

  async loadBuffer(buffer: AudioBuffer): Promise<void> {
    this.stopSource();
    this.buffer = buffer;
    this.offsetSec = 0;
  }

  async load(blob: Blob): Promise<void> {
    this.stopSource();
    this.buffer = null;
    this.buffer = await decodeLocalAudioBlob(blob);
    this.offsetSec = 0;
  }

  async play(): Promise<void> {
    if (!this.buffer) throw new Error("未加载音频");
    const ctx = await this.ensureContextRunning();
    this.stopSource();
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = AudioLevelConfig.fftSize;
    analyser.smoothingTimeConstant = AudioVisualizationConfig.analyserSmoothingTimeConstant;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    this.analyser = analyser;
    source.onended = () => {
      if (this.intentionalStop) return;
      this.playing = false;
      this.source = null;
      this.offsetSec = 0;
      this.stopWatchdog();
      this.callbacks.onEnded?.();
    };
    source.start(0, this.offsetSec);
    this.source = source;
    this.intentionalStop = false;
    this.startedAt = ctx.currentTime;
    this.playing = true;
    this.startWatchdog();
    this.callbacks.onPlaying?.();
  }

  pause(): void {
    if (!this.playing || !this.buffer) return;
    this.offsetSec = this.getCurrentTime();
    this.stopSource();
    this.playing = false;
    this.stopWatchdog();
    this.callbacks.onPaused?.();
  }

  stop(): void {
    this.offsetSec = 0;
    if (this.playing) this.stopSource();
    this.playing = false;
    this.stopWatchdog();
  }

  seek(seconds: number): void {
    if (!this.buffer) return;
    this.offsetSec = Math.max(0, Math.min(seconds, this.buffer.duration));
  }

  async seekAndResume(seconds: number): Promise<void> {
    this.seek(seconds);
    if (this.playing || this.isPaused) await this.play();
  }

  /** Resume after tab visibility or user pause at mid-track offset. */
  async resumeIfShouldPlay(wantsPlay: boolean, userPaused: boolean): Promise<void> {
    if (!wantsPlay || userPaused || !this.buffer || this.playing) return;
    if (this.offsetSec <= 0 || this.offsetSec >= this.buffer.duration - 0.05) return;
    await this.play();
  }

  dispose(): void {
    this.stop();
    this.buffer = null;
  }

  private async ensureContextRunning(): Promise<AudioContext> {
    const ctx = getSharedLocalMediaAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    return ctx;
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      if (!this.playing) return;
      const ctx = sharedAudioContext;
      if (ctx?.state === "suspended") {
        void ctx.resume().catch(() => undefined);
      }
    }, 400);
  }

  private stopWatchdog(): void {
    if (!this.watchdog) return;
    clearInterval(this.watchdog);
    this.watchdog = undefined;
  }

  private stopSource(): void {
    if (!this.source) return;
    this.intentionalStop = true;
    const oldSource = this.source;
    this.source = null;
    this.analyser = null;
    oldSource.onended = null;
    try {
      oldSource.stop();
    } catch {
      /* ignore */
    }
    try {
      oldSource.disconnect();
    } catch {
      /* ignore */
    }
  }
}
