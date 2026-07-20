import { describe, expect, it } from "vitest";
import { SoundDetectionEngine } from "../src/audio-detection-state";
import { DETECTION_PRESETS } from "../src/audio-detection-config";

function runQuiet(engine: SoundDetectionEngine, fromMs: number, durationMs: number, step = 40) {
  let state = engine.tick({ rms: 0.001, peak: 0.005, now: fromMs });
  for (let t = fromMs + step; t <= fromMs + durationMs; t += step) {
    state = engine.tick({ rms: 0.001, peak: 0.005, now: t });
  }
  return state;
}

function runLoud(engine: SoundDetectionEngine, fromMs: number, durationMs: number, rms = 0.08, step = 40) {
  let state = engine.tick({ rms, peak: Math.min(1, rms * 2), now: fromMs });
  for (let t = fromMs + step; t <= fromMs + durationMs; t += step) {
    state = engine.tick({ rms, peak: Math.min(1, rms * 2), now: t });
  }
  return state;
}

describe("SoundDetectionEngine hysteresis", () => {
  it("does not switch to silent after 0.2s / 0.5s / 1s quiet (standard)", () => {
    const engine = new SoundDetectionEngine("standard");
    runLoud(engine, 0, 400);
    expect(runQuiet(engine, 400, 200).soundState).not.toBe("silent");
    expect(runQuiet(engine, 600, 300).soundState).not.toBe("silent");
    expect(runQuiet(engine, 900, 100).hasSound).toBe(true);
  });

  it("switches to silent after continuous 1.8s quiet in standard mode", () => {
    const engine = new SoundDetectionEngine("standard");
    runLoud(engine, 0, 500);
    const after = runQuiet(engine, 500, DETECTION_PRESETS.standard.silenceHoldMs + 400);
    expect(after.soundState).toBe("silent");
    expect(after.hasSound).toBe(false);
    expect(after.badge).toBe("无声音");
    expect(after.liveText).toBe("当前没有声音");
  });

  it("returns to sound if voice resumes before silenceHoldMs", () => {
    const engine = new SoundDetectionEngine("standard");
    runLoud(engine, 0, 400);
    runQuiet(engine, 400, 1500);
    const back = runLoud(engine, 1900, 250);
    expect(back.hasSound).toBe(true);
    expect(back.soundState === "has_sound" || back.soundState === "low_volume").toBe(true);
  });

  it("requires soundConfirmMs before leaving silent", () => {
    const engine = new SoundDetectionEngine("standard");
    // stay silent
    runQuiet(engine, 0, 300);
    // single short burst < confirm
    const spike = engine.tick({ rms: 0.06, peak: 0.2, now: 350 });
    expect(spike.soundState).toBe("silent");
    // sustained
    const confirmed = runLoud(engine, 400, DETECTION_PRESETS.standard.soundConfirmMs + 50);
    expect(confirmed.hasSound).toBe(true);
  });

  it("single peak does not trigger sound", () => {
    const engine = new SoundDetectionEngine("standard");
    runQuiet(engine, 0, 200);
    const one = engine.tick({ rms: 0.2, peak: 0.9, now: 250 });
    expect(one.soundState).toBe("silent");
    expect(engine.getMachineState()).toBe("maybeSound");
  });

  it("uses dual thresholds (enter > exit)", () => {
    const p = DETECTION_PRESETS.standard;
    expect(p.soundEnterThresholdRms).toBeGreaterThan(p.soundExitThresholdRms);
  });

  it("smooths RMS instead of using raw frame only", () => {
    const engine = new SoundDetectionEngine("standard");
    engine.tick({ rms: 0, peak: 0, now: 0 });
    const a = engine.tick({ rms: 0.1, peak: 0.2, now: 20 });
    expect(a.smoothedRms).toBeLessThan(0.1);
    expect(a.smoothedRms).toBeGreaterThan(0);
  });

  it("respects min visible duration for normal flips", () => {
    const engine = new SoundDetectionEngine("standard");
    runLoud(engine, 0, 300);
    // Force long silence to silent
    runQuiet(engine, 300, 2000);
    expect(engine.tick({ rms: 0, peak: 0, now: 2400 }).soundState).toBe("silent");
  });

  it("disconnected is immediate and not silent", () => {
    const engine = new SoundDetectionEngine("standard");
    runLoud(engine, 0, 200);
    const d = engine.tick({ rms: 0.05, peak: 0.1, now: 250, disconnected: true });
    expect(d.soundState).toBe("disconnected");
    expect(d.liveText).toBe("监测已断开");
    expect(d.badge).toBe("设备断开");
  });

  it("sensitive enters silence faster than stable", () => {
    const sensitive = new SoundDetectionEngine("sensitive");
    const stable = new SoundDetectionEngine("stable");
    runLoud(sensitive, 0, 400);
    runLoud(stable, 0, 400);
    const sAt = runQuiet(sensitive, 400, DETECTION_PRESETS.sensitive.silenceHoldMs + 300);
    const stAt = runQuiet(stable, 400, DETECTION_PRESETS.sensitive.silenceHoldMs + 300);
    expect(sAt.soundState).toBe("silent");
    expect(stAt.soundState).not.toBe("silent");
  });

  it("keeps left/badge/detail consistent", () => {
    const engine = new SoundDetectionEngine("standard");
    const loud = runLoud(engine, 0, 400);
    expect(loud.liveText).toBe("检测到声音");
    expect(["声音正常", "声音较小"]).toContain(loud.badge);
    expect(loud.detail.length).toBeGreaterThan(0);
    const silent = runQuiet(engine, 400, DETECTION_PRESETS.standard.silenceHoldMs + 400);
    expect(silent.liveText).toBe("当前没有声音");
    expect(silent.badge).toBe("无声音");
  });

  it("reset clears timers across device switches", () => {
    const engine = new SoundDetectionEngine("standard");
    runLoud(engine, 0, 300);
    runQuiet(engine, 300, 1000);
    engine.reset();
    expect(engine.getMachineState()).toBe("silent");
    expect(engine.getSmoothedRms()).toBe(0);
  });
});
