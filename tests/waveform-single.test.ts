/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyLevelUpdate,
  countWaveformCards,
  ensureMeterHost,
  resetWaveform,
  setWaveformMode,
  __waveformTestState
} from "../src/waveform-ui";
import type { AudioLevelUpdate } from "../src/stream-level-monitor";

function level(partial: Partial<AudioLevelUpdate> & Pick<AudioLevelUpdate, "sessionId" | "trackId">): AudioLevelUpdate {
  return {
    type: "AUDIO_LEVEL_UPDATE",
    sourceLabel: "Voicemeeter Out B1",
    rms: 0.05,
    peak: 0.1,
    hasSound: true,
    isClipping: false,
    isNearClipping: false,
    soundState: "has_sound",
    soundLabel: "检测到声音",
    waveform: Array.from({ length: 72 }, () => 0.4),
    timestamp: Date.now(),
    volumePercent: 40,
    peakPercent: 50,
    analyserOk: true,
    ...partial
  };
}

describe("single main waveform", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<div id="liveMonitor"></div>`;
    host = document.getElementById("liveMonitor")!;
    resetWaveform(host);
    setWaveformMode("idle");
  });

  it("mounts exactly one meter card", () => {
    ensureMeterHost(host);
    expect(countWaveformCards(host)).toBe(1);
    expect(host.querySelectorAll("#main-waveform")).toHaveLength(1);
  });

  it("preview then recording updates reuse the same card", () => {
    setWaveformMode("preview");
    applyLevelUpdate(host, level({ sessionId: "preview", trackId: "test" }));
    expect(countWaveformCards(host)).toBe(1);

    setWaveformMode("recording", "session-1");
    applyLevelUpdate(host, level({ sessionId: "session-1", trackId: "selected_device" }));
    expect(countWaveformCards(host)).toBe(1);
    expect(host.querySelectorAll(".meter-card")).toHaveLength(1);
  });

  it("ignores preview packets while recording", () => {
    setWaveformMode("recording", "session-1");
    applyLevelUpdate(
      host,
      level({ sessionId: "session-1", trackId: "selected_device", sourceLabel: "Recording Device" })
    );
    applyLevelUpdate(host, level({ sessionId: "preview", trackId: "test", sourceLabel: "Stale Preview" }));
    expect(host.querySelector(".meter-title")!.textContent).toBe("Recording Device");
    expect(countWaveformCards(host)).toBe(1);
  });

  it("device switch / reset does not accumulate cards", () => {
    for (let i = 0; i < 5; i++) {
      resetWaveform(host);
      setWaveformMode("preview");
      applyLevelUpdate(host, level({ sessionId: "preview", trackId: "test", sourceLabel: `Device ${i}` }));
    }
    expect(countWaveformCards(host)).toBe(1);
    expect(host.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("exposes waveform instance for diagnostics", () => {
    ensureMeterHost(host);
    expect(__waveformTestState().hasView).toBe(true);
    expect(__waveformTestState().instanceId).toMatch(/^wf_/);
  });
});
