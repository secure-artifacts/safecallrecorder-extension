import { describe, expect, it } from "vitest";
import {
  resolveSessionExportName,
  resolveExportNameForSession,
  updateSessionDisplayName
} from "../src/session-display-name";
import type { Session } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";
import { createRecordingNameProfile } from "../src/recording-name-profiles";
describe("session display name", () => {
  it("prefers custom displayName for export", () => {
    const session = { displayName: "我的通话", name: "0823" } as Session;
    expect(resolveSessionExportName(session, "08231")).toBe("我的通话");
  });

  it("falls back to scheme name when displayName empty", () => {
    const session = { name: "0823", startedAt: Date.parse("2026-08-23T10:00:00") } as Session;
    expect(resolveSessionExportName(session, "08231")).toBe("08231");
  });

  it("uses active naming profile at export time", () => {
    const session = { name: "方案A", startedAt: Date.parse("2026-08-23T10:00:00") } as Session;
    const profileA = createRecordingNameProfile("A", {
      useDate: false,
      useCustom: true,
      customText: "方案A",
      partOrder: ["custom"]
    });
    const profileB = createRecordingNameProfile("B", {
      useDate: false,
      useCustom: true,
      customText: "方案B",
      partOrder: ["custom"]
    });
    const settingsA = {
      ...DEFAULT_SETTINGS,
      recordingNameProfiles: [profileA, profileB],
      activeRecordingNameProfileId: profileA.id
    };
    const settingsB = { ...settingsA, activeRecordingNameProfileId: profileB.id };
    expect(resolveExportNameForSession(session, settingsA)).toBe("方案A");
    expect(resolveExportNameForSession(session, settingsB)).toBe("方案B");
  });
});

describe("updateSessionDisplayName", () => {
  it("is exported", () => {
    expect(typeof updateSessionDisplayName).toBe("function");
  });
});
