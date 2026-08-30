import { describe, expect, it } from "vitest";
import { canContinueRecording } from "../src/recording-continue";
import type { Session } from "../src/types";

function baseSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    name: "test",
    mode: "device",
    status: "interrupted",
    recordingStatus: "interrupted",
    originalStatus: "available",
    mp3Status: "idle",
    historyStatus: "partial",
    startedAt: Date.now(),
    safeDurationMs: 5000,
    recoveryCount: 0,
    bitrate: 64000,
    mixed: false,
    ...overrides
  };
}

describe("canContinueRecording", () => {
  it("allows partial interrupted sessions with saved audio", () => {
    expect(canContinueRecording(baseSession())).toBe(true);
    expect(canContinueRecording(baseSession({ historyStatus: "interrupted" }))).toBe(true);
  });

  it("allows normally completed sessions with saved audio", () => {
    expect(
      canContinueRecording(
        baseSession({ status: "completed", recordingStatus: "completed", historyStatus: "completed" })
      )
    ).toBe(true);
  });

  it("rejects sessions without saved audio", () => {
    expect(canContinueRecording(baseSession({ safeDurationMs: 0, originalStatus: "missing" }))).toBe(false);
  });

  it("rejects active sessions", () => {
    expect(canContinueRecording(baseSession({ recordingStatus: "recording", historyStatus: "recording" }))).toBe(
      false
    );
    expect(canContinueRecording(baseSession({ status: "paused", recordingStatus: "paused" }))).toBe(false);
  });
});

describe("dashboard continue recording UI", () => {
  it("exposes continue button contract in dashboard source", async () => {
    const dash = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/dashboard.ts", import.meta.url), "utf8")
    );
    expect(dash).toContain("continueRecordingFromHistory");
    expect(dash).toContain("继续录音");
    expect(dash).toContain("canContinueRecording");
  });
});
