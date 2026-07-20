import {
  resolveDetectionPreset,
  type DetectionPreset,
  type DetectionSensitivity
} from "./audio-detection-config";
import type { SoundUiState } from "./audio-level-config";

export type DetectionMachineState = "silent" | "maybeSound" | "sound" | "maybeSilent";

export type DetectionTickInput = {
  rms: number;
  peak: number;
  now?: number;
  paused?: boolean;
  disconnected?: boolean;
  unavailable?: boolean;
};

export type DetectionTickResult = {
  /** User-visible state (stable). */
  soundState: SoundUiState;
  soundLabel: string;
  badge: string;
  liveText: string;
  detail: string;
  /** Stable: true while visible state is sound / low_volume / clipping. */
  hasSound: boolean;
  instantaneousRms: number;
  smoothedRms: number;
  peak: number;
  isClipping: boolean;
  isNearClipping: boolean;
  machineState: DetectionMachineState | "disconnected" | "paused" | "unavailable" | "clipping";
  enterThreshold: number;
  exitThreshold: number;
  candidateDurationMs: number;
};

let lastLogAt = 0;

function logDetection(payload: Record<string, unknown>) {
  const now = Date.now();
  if (now - lastLogAt < 500 && payload.event !== "state_change") return;
  lastLogAt = now;
  console.info("[AudioDetection]", payload);
}

export function soundStateLabel(state: SoundUiState): string {
  switch (state) {
    case "has_sound":
      return "设备中有声音，可以开始录音。";
    case "low_volume":
      return "可以录制，但音量偏低。";
    case "silent":
      return "请检查 VoiceMeeter 路由或设备音量。";
    case "clipping":
      return "检测到削波，请降低设备音量。";
    case "paused":
      return "已暂停";
    case "disconnected":
      return "正在尝试重新连接设备。";
    case "unavailable":
      return "录音正在进行，但实时音浪暂时不可用。";
  }
}

function visibleParts(state: SoundUiState): Pick<DetectionTickResult, "badge" | "liveText" | "detail" | "soundLabel"> {
  switch (state) {
    case "has_sound":
      return {
        badge: "声音正常",
        liveText: "检测到声音",
        detail: "设备中有声音，可以开始录音。",
        soundLabel: soundStateLabel(state)
      };
    case "low_volume":
      return {
        badge: "声音较小",
        liveText: "检测到声音",
        detail: "可以录制，但音量偏低。",
        soundLabel: soundStateLabel(state)
      };
    case "silent":
      return {
        badge: "无声音",
        liveText: "当前没有声音",
        detail: "请检查 VoiceMeeter 路由或设备音量。",
        soundLabel: soundStateLabel(state)
      };
    case "clipping":
      return {
        badge: "音量过大",
        liveText: "检测到声音",
        detail: "检测到削波，请降低设备音量。",
        soundLabel: soundStateLabel(state)
      };
    case "disconnected":
      return {
        badge: "设备断开",
        liveText: "监测已断开",
        detail: "正在尝试重新连接设备。",
        soundLabel: soundStateLabel(state)
      };
    case "paused":
      return {
        badge: "已暂停",
        liveText: "已暂停",
        detail: "已暂停",
        soundLabel: soundStateLabel(state)
      };
    case "unavailable":
      return {
        badge: "不可用",
        liveText: "监测异常",
        detail: soundStateLabel(state),
        soundLabel: soundStateLabel(state)
      };
  }
}

/**
 * Hysteresis + debounce sound detector.
 * Instantaneous RMS drives waveform elsewhere; this class owns stable UI state.
 */
export class SoundDetectionEngine {
  private preset: DetectionPreset;
  private machine: DetectionMachineState = "silent";
  private smoothedRms = 0;
  private candidateSince: number | null = null;
  private visibleState: SoundUiState = "silent";
  private visibleSince = 0;
  private clippingSince: number | null = null;
  private noiseSamples: number[] = [];
  private noiseFloor = 0;
  private startedAt = 0;
  private lastLogState = "";

  constructor(sensitivity: DetectionSensitivity | string = "standard") {
    this.preset = resolveDetectionPreset(sensitivity);
  }

  setSensitivity(sensitivity: DetectionSensitivity | string) {
    this.preset = resolveDetectionPreset(sensitivity);
  }

  reset() {
    this.machine = "silent";
    this.smoothedRms = 0;
    this.candidateSince = null;
    this.visibleState = "silent";
    this.visibleSince = 0;
    this.clippingSince = null;
    this.noiseSamples = [];
    this.noiseFloor = 0;
    this.startedAt = 0;
    this.lastLogState = "";
  }

  private thresholds() {
    const enter = Math.min(
      this.preset.maxEnterThresholdRms,
      Math.max(this.preset.soundEnterThresholdRms, this.noiseFloor * this.preset.noiseFloorEnterMultiplier)
    );
    const exit = Math.min(
      this.preset.maxExitThresholdRms,
      Math.max(this.preset.soundExitThresholdRms, this.noiseFloor * this.preset.noiseFloorExitMultiplier)
    );
    // Keep hysteresis: enter must stay above exit.
    return {
      enter: Math.max(enter, exit + 0.004),
      exit
    };
  }

  private updateNoiseFloor(rms: number, now: number) {
    if (!this.startedAt) this.startedAt = now;
    if (now - this.startedAt > this.preset.noiseFloorWarmupMs) return;
    // Only learn floor while truly quiet — never treat speech as noise.
    if (this.machine !== "silent") return;
    if (rms > this.preset.soundExitThresholdRms * 1.5) return;
    this.noiseSamples.push(rms);
    if (this.noiseSamples.length > 40) this.noiseSamples.shift();
    if (this.noiseSamples.length >= 8) {
      const sorted = [...this.noiseSamples].sort((a, b) => a - b);
      this.noiseFloor = sorted[Math.floor(sorted.length * 0.3)] ?? 0;
    }
  }

  private setVisible(next: SoundUiState, now: number, force = false): SoundUiState {
    if (next === this.visibleState) return this.visibleState;
    const elapsed = this.visibleSince ? now - this.visibleSince : Infinity;
    const canChange =
      force ||
      next === "disconnected" ||
      next === "unavailable" ||
      next === "clipping" ||
      this.visibleState === "disconnected" ||
      this.visibleState === "unavailable" ||
      elapsed >= this.preset.minVisibleStateDurationMs;
    if (!canChange) return this.visibleState;
    this.visibleState = next;
    this.visibleSince = now;
    return this.visibleState;
  }

  private toSoundVisible(smoothed: number, now: number, force = false): SoundUiState {
    if (smoothed > 0 && smoothed < this.preset.lowVolumeThresholdRms) {
      return this.setVisible("low_volume", now, force);
    }
    return this.setVisible("has_sound", now, force);
  }

  tick(input: DetectionTickInput): DetectionTickResult {
    const now = input.now ?? Date.now();
    const instantaneousRms = Math.max(0, input.rms);
    const peak = Math.max(0, input.peak);
    const isClipping = peak >= this.preset.clippingThreshold;
    const isNearClipping = peak >= this.preset.clippingThreshold * 0.85;

    if (input.unavailable) {
      const state = this.setVisible("unavailable", now, true);
      return this.pack(state, "unavailable", instantaneousRms, peak, isClipping, isNearClipping, 0);
    }
    if (input.disconnected) {
      const state = this.setVisible("disconnected", now, true);
      return this.pack(state, "disconnected", instantaneousRms, peak, isClipping, isNearClipping, 0);
    }
    if (input.paused) {
      const state = this.setVisible("paused", now, true);
      return this.pack(state, "paused", instantaneousRms, peak, isClipping, isNearClipping, 0);
    }

    const alpha = this.preset.rmsSmoothingAlpha;
    this.smoothedRms = alpha * instantaneousRms + (1 - alpha) * this.smoothedRms;
    this.updateNoiseFloor(instantaneousRms, now);
    const { enter, exit } = this.thresholds();

    if (isClipping) {
      if (this.clippingSince == null) this.clippingSince = now;
    } else {
      this.clippingSince = null;
    }
    if (this.clippingSince != null && now - this.clippingSince >= this.preset.clippingDurationMs) {
      this.machine = "sound";
      this.candidateSince = null;
      const state = this.setVisible("clipping", now, true);
      return this.pack(state, "clipping", instantaneousRms, peak, isClipping, isNearClipping, 0, enter, exit);
    }

    let candidateDurationMs = 0;
    const belowExit = this.smoothedRms < exit || instantaneousRms < exit;
    const aboveExit = this.smoothedRms >= exit && instantaneousRms >= exit * 0.9;
    const aboveEnter = this.smoothedRms >= enter;

    switch (this.machine) {
      case "silent": {
        if (aboveEnter) {
          this.machine = "maybeSound";
          this.candidateSince = now;
        }
        break;
      }
      case "maybeSound": {
        if (aboveEnter) {
          candidateDurationMs = this.candidateSince ? now - this.candidateSince : 0;
          if (candidateDurationMs >= this.preset.soundConfirmMs) {
            this.machine = "sound";
            this.candidateSince = null;
            this.toSoundVisible(this.smoothedRms, now, true);
          }
        } else {
          this.machine = "silent";
          this.candidateSince = null;
        }
        break;
      }
      case "sound": {
        if (belowExit) {
          this.machine = "maybeSilent";
          this.candidateSince = now;
        } else {
          this.toSoundVisible(this.smoothedRms, now);
        }
        break;
      }
      case "maybeSilent": {
        if (aboveExit) {
          // Speech pause ended — stay in sound without UI flicker.
          this.machine = "sound";
          this.candidateSince = null;
          this.toSoundVisible(this.smoothedRms, now);
        } else {
          candidateDurationMs = this.candidateSince ? now - this.candidateSince : 0;
          if (candidateDurationMs >= this.preset.silenceHoldMs) {
            this.machine = "silent";
            this.candidateSince = null;
            // Force visible silent after confirmed hold (bypass minVisible duration).
            this.setVisible("silent", now, true);
          } else {
            // Hold previous visible sound state during short pauses.
            this.toSoundVisible(this.smoothedRms, now);
          }
        }
        break;
      }
    }

    // Ensure visible follows machine for long-term silent.
    if (this.machine === "silent" && this.visibleState !== "silent") {
      this.setVisible("silent", now, true);
    }

    const result = this.pack(
      this.visibleState,
      this.machine,
      instantaneousRms,
      peak,
      isClipping,
      isNearClipping,
      candidateDurationMs,
      enter,
      exit
    );

    const key = `${result.soundState}|${this.machine}`;
    if (key !== this.lastLogState) {
      this.lastLogState = key;
      logDetection({
        event: "state_change",
        rawRms: Number(instantaneousRms.toFixed(4)),
        smoothedRms: Number(this.smoothedRms.toFixed(4)),
        peak: Number(peak.toFixed(4)),
        state: result.soundState,
        machineState: this.machine,
        candidateDurationMs,
        enterThreshold: Number(enter.toFixed(4)),
        exitThreshold: Number(exit.toFixed(4)),
        silenceHoldMs: this.preset.silenceHoldMs
      });
    } else {
      logDetection({
        event: "sample",
        rawRms: Number(instantaneousRms.toFixed(4)),
        smoothedRms: Number(this.smoothedRms.toFixed(4)),
        state: result.soundState,
        machineState: this.machine,
        candidateDurationMs
      });
    }

    return result;
  }

  private pack(
    soundState: SoundUiState,
    machineState: DetectionTickResult["machineState"],
    instantaneousRms: number,
    peak: number,
    isClipping: boolean,
    isNearClipping: boolean,
    candidateDurationMs: number,
    enter = this.thresholds().enter,
    exit = this.thresholds().exit
  ): DetectionTickResult {
    const parts = visibleParts(soundState);
    const hasSound = soundState === "has_sound" || soundState === "low_volume" || soundState === "clipping";
    return {
      soundState,
      ...parts,
      hasSound,
      instantaneousRms,
      smoothedRms: this.smoothedRms,
      peak,
      isClipping,
      isNearClipping,
      machineState,
      enterThreshold: enter,
      exitThreshold: exit,
      candidateDurationMs
    };
  }

  /** Test helpers */
  getMachineState() {
    return this.machine;
  }
  getSmoothedRms() {
    return this.smoothedRms;
  }
  getPreset() {
    return this.preset;
  }
}
