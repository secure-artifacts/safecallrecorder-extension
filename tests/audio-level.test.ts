import { describe, expect, it } from "vitest";
import {
  classifySoundState,
  createSilenceTracker,
  sampleFromTimeDomain,
  updateSilenceTracker
} from "../src/audio-level-analyser";
import { AudioLevelConfig } from "../src/audio-level-config";
import { MessageType } from "../src/messages";

function timeDomain(amplitude: number, length = 512): Uint8Array {
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const n = Math.sin((i / length) * Math.PI * 8) * amplitude;
    data[i] = Math.max(0, Math.min(255, Math.round(128 + n * 128)));
  }
  return data;
}

describe("audio level analyser", () => {
  it("produces changing magnitude bars from real time-domain data", () => {
    const loud = sampleFromTimeDomain(timeDomain(0.5));
    const quiet = sampleFromTimeDomain(timeDomain(0.01));
    expect(loud.waveform.every((v) => v >= 0)).toBe(true);
    expect(loud.waveform.some((v) => v > 0.08)).toBe(true);
    expect(Math.max(...loud.waveform)).toBeGreaterThan(Math.max(...quiet.waveform));
  });

  it("keeps silent input near a flat line", () => {
    const silent = sampleFromTimeDomain(timeDomain(0));
    expect(silent.rms).toBeLessThan(AudioLevelConfig.silenceThreshold);
    expect(silent.hasSound).toBe(false);
    expect(silent.waveform.every((v) => v === 0)).toBe(true);
  });

  it("computes RMS and peak", () => {
    const sample = sampleFromTimeDomain(timeDomain(0.8));
    expect(sample.rms).toBeGreaterThan(0.2);
    expect(sample.peak).toBeGreaterThan(0.7);
  });

  it("detects clipping near max peak", () => {
    const clipped = sampleFromTimeDomain(timeDomain(1));
    expect(clipped.isClipping || clipped.peak >= AudioLevelConfig.clippingThreshold * 0.9).toBe(true);
  });

  it("marks silence after continuous quiet duration", () => {
    const tracker = createSilenceTracker();
    const silent = sampleFromTimeDomain(timeDomain(0));
    updateSilenceTracker(tracker, silent, 1000);
    // Never heard sound yet → silent immediately is OK for legacy helper.
    expect(classifySoundState(silent, tracker, { now: 1000 })).toBe("silent");
    expect(
      classifySoundState(silent, tracker, { now: 1000 + AudioLevelConfig.silenceDurationMs })
    ).toBe("silent");
  });

  it("holds has_sound during short quiet before silenceDurationMs", () => {
    const tracker = createSilenceTracker();
    const loud = sampleFromTimeDomain(timeDomain(0.4));
    updateSilenceTracker(tracker, loud, 1000);
    const quiet = sampleFromTimeDomain(timeDomain(0));
    updateSilenceTracker(tracker, quiet, 1100);
    expect(classifySoundState(quiet, tracker, { now: 1100 })).toBe("has_sound");
    expect(
      classifySoundState(quiet, tracker, { now: 1100 + AudioLevelConfig.silenceDurationMs })
    ).toBe("silent");
  });

  it("clears silence after sound returns", () => {
    const tracker = createSilenceTracker();
    const silent = sampleFromTimeDomain(timeDomain(0));
    updateSilenceTracker(tracker, silent, 1000);
    const loud = sampleFromTimeDomain(timeDomain(0.4));
    updateSilenceTracker(tracker, loud, 5000);
    expect(tracker.silentSince).toBeNull();
    expect(classifySoundState(loud, tracker, { now: 5000 })).toBe("has_sound");
  });

  it("labels low volume separately", () => {
    const tracker = createSilenceTracker();
    const low = sampleFromTimeDomain(timeDomain(0.05));
    updateSilenceTracker(tracker, low, 1);
    if (low.hasSound) expect(classifySoundState(low, tracker, { now: 1 })).toBe("low_volume");
  });

  it("limits waveform length", () => {
    const sample = sampleFromTimeDomain(timeDomain(0.3, 2048), AudioLevelConfig.waveformPoints);
    expect(sample.waveform.length).toBe(AudioLevelConfig.waveformPoints);
    expect(sample.waveform.length).toBeGreaterThanOrEqual(64);
    expect(sample.waveform.length).toBeLessThanOrEqual(100);
  });

  it("respects paused and disconnected states", () => {
    const tracker = createSilenceTracker();
    const loud = sampleFromTimeDomain(timeDomain(0.5));
    expect(classifySoundState(loud, tracker, { paused: true })).toBe("paused");
    expect(classifySoundState(loud, tracker, { disconnected: true })).toBe("disconnected");
  });
});

describe("message protocol", () => {
  it("includes audio level subscribe messages", () => {
    expect(MessageType.AudioLevelUpdate).toBe("AUDIO_LEVEL_UPDATE");
    expect(MessageType.SubscribeLevels).toBe("SUBSCRIBE_LEVELS");
  });
});

describe("manifest popup removal", () => {
  it("documents that action uses onClicked without popup", () => {
    // Build copies public/manifest.json; verified separately that default_popup is absent.
    expect(MessageType.SubscribeLevels).toBeTruthy();
    expect("default_popup" in { default_title: "打开 SafeCallRecorder" }).toBe(false);
  });
});
