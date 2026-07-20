import { describe, expect, it } from "vitest";
import { AudioDisplaySmoother, quantizeVolumePercent } from "../src/audio-display-smoother";
import { AudioVisualizationConfig } from "../src/audio-visualization-config";

describe("audio display smoother", () => {
  it("does not change shown volume on every tiny rms tick", () => {
    const s = new AudioDisplaySmoother(8);
    const a = s.push({ rms: 0.03, peak: 0.05, waveform: Array(8).fill(0.05), now: 0 });
    const b = s.push({ rms: 0.032, peak: 0.05, waveform: Array(8).fill(0.05), now: 100 });
    const c = s.push({ rms: 0.028, peak: 0.05, waveform: Array(8).fill(0.05), now: 200 });
    // Quantized output should stay stable across small swings.
    expect(Math.abs(a.volumePercent - b.volumePercent)).toBeLessThanOrEqual(2);
    expect(Math.abs(b.volumePercent - c.volumePercent)).toBeLessThanOrEqual(2);
  });

  it("applies deadband so 3-5% flicker collapses", () => {
    const s = new AudioDisplaySmoother(8);
    // Warm into a mid-low display value
    for (let t = 0; t < 800; t += 100) {
      s.push({ rms: 0.04, peak: 0.08, waveform: Array(8).fill(0.08), now: t });
    }
    const base = s.push({ rms: 0.04, peak: 0.08, waveform: Array(8).fill(0.08), now: 900 });
    const wobble = s.push({ rms: 0.036, peak: 0.07, waveform: Array(8).fill(0.07), now: 1000 });
    expect(wobble.volumeChanged === false || wobble.volumePercent === base.volumePercent).toBe(true);
  });

  it("volume rises faster than it falls", () => {
    const s = new AudioDisplaySmoother(8);
    s.push({ rms: 0, peak: 0, waveform: Array(8).fill(0), now: 0 });
    const up = s.push({ rms: 0.2, peak: 0.4, waveform: Array(8).fill(0.4), now: 120 });
    const mid = s.push({ rms: 0.2, peak: 0.4, waveform: Array(8).fill(0.4), now: 240 });
    expect(mid.displayRms).toBeGreaterThan(up.displayRms);
    const afterDrop1 = s.push({ rms: 0, peak: 0, waveform: Array(8).fill(0), now: 360 });
    const afterDrop2 = s.push({ rms: 0, peak: 0, waveform: Array(8).fill(0), now: 480 });
    const fall = mid.displayRms - afterDrop2.displayRms;
    const rise = mid.displayRms - 0;
    // After similar dt, fall should be incomplete vs a jump to target (release slower).
    expect(afterDrop1.displayRms).toBeGreaterThan(0.01);
    expect(fall).toBeLessThan(rise * 0.95);
  });

  it("holds peak then decays slowly", () => {
    const s = new AudioDisplaySmoother(8);
    const hit = s.push({ rms: 0.1, peak: 0.5, waveform: Array(8).fill(0.2), now: 0 });
    expect(hit.peakPercent).toBeGreaterThanOrEqual(40);
    const held = s.push({ rms: 0.02, peak: 0.05, waveform: Array(8).fill(0.05), now: 600 });
    expect(held.peakPercent).toBeGreaterThanOrEqual(hit.peakPercent - 5);
    const decayed = s.push({ rms: 0.02, peak: 0.05, waveform: Array(8).fill(0.05), now: 2000 });
    expect(decayed.peakPercent).toBeLessThan(held.peakPercent);
  });

  it("interpolates bars with slower release", () => {
    const s = new AudioDisplaySmoother(4);
    const current = [0.8, 0.8, 0.8, 0.8];
    const target = [0.1, 0.1, 0.1, 0.1];
    const next = s.interpolateBars(current, target);
    expect(next[0]!).toBeGreaterThan(0.1);
    expect(next[0]!).toBeLessThan(0.8);
    const attack = s.interpolateBars([0.1], [0.9]);
    expect(attack[0]! - 0.1).toBeGreaterThan(0.8 - next[0]!);
  });

  it("gates near-floor waveform to idle height", () => {
    const s = new AudioDisplaySmoother(8);
    for (let t = 0; t < 1600; t += 100) {
      s.push({ rms: 0.005, peak: 0.01, waveform: Array(8).fill(0.02), now: t });
    }
    const snap = s.push({ rms: 0.006, peak: 0.01, waveform: Array(8).fill(0.025), now: 1700 });
    expect(snap.waveformTarget.every((v) => v <= AudioVisualizationConfig.idleBarHeight * 2.5)).toBe(true);
  });

  it("quantizes volume to even percents", () => {
    expect(quantizeVolumePercent(4.3)).toBe(4);
    expect(quantizeVolumePercent(5.1)).toBe(6);
    expect(quantizeVolumePercent(0.4)).toBe(0);
  });

  it("config exposes expected defaults", () => {
    expect(AudioVisualizationConfig.uiUpdateRateHz).toBe(10);
    expect(AudioVisualizationConfig.peakHoldMs).toBe(1200);
    expect(AudioVisualizationConfig.volumeReleaseMs).toBeGreaterThan(AudioVisualizationConfig.volumeAttackMs);
  });
});
