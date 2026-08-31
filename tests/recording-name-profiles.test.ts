import { describe, expect, it } from "vitest";
import {
  addRecordingNameProfile,
  buildSessionRecordingName,
  createRecordingNameProfile,
  normalizeRecordingNameProfiles,
  removeRecordingNameProfile,
  setActiveRecordingNameProfile,
  updateProfileConfig
} from "../src/recording-name-profiles";
import { DEFAULT_SETTINGS } from "../src/types";

describe("recording name profiles", () => {
  it("migrates legacy recordingName into a default profile", () => {
    const { profiles, activeId } = normalizeRecordingNameProfiles({
      recordingName: { useDate: true, useCustom: true, customText: "会议", partOrder: ["date", "custom"] }
    });
    expect(profiles).toHaveLength(1);
    expect(activeId).toBe(profiles[0]!.id);
    expect(buildSessionRecordingName(profiles[0]!, Date.parse("2026-08-23T10:00:00"))).toMatch(/会议/);
  });

  it("adds and removes profiles", () => {
    let settings = { ...DEFAULT_SETTINGS };
    settings = addRecordingNameProfile(settings, "工作");
    const { profiles } = normalizeRecordingNameProfiles(settings);
    expect(profiles.length).toBe(2);
    settings = removeRecordingNameProfile(settings, profiles[1]!.id);
    expect(normalizeRecordingNameProfiles(settings).profiles).toHaveLength(1);
  });

  it("uses session startedAt for export name date parts", () => {
    const profile = createRecordingNameProfile("测试", {
      items: [{ id: "d1", kind: "date" }],
      dateIncludeYear: false
    });
    const name = buildSessionRecordingName(profile, Date.parse("2026-08-23T12:00:00"));
    expect(name).toBe("0823");
  });

  it("updates active profile config", () => {
    const base = createRecordingNameProfile("默认");
    let settings = {
      ...DEFAULT_SETTINGS,
      recordingNameProfiles: [base],
      activeRecordingNameProfileId: base.id
    };
    settings = updateProfileConfig(settings, base.id, {
      items: [{ id: "c1", kind: "custom", text: "VK" }]
    });
    settings = setActiveRecordingNameProfile(settings, base.id);
    expect(buildSessionRecordingName(getActive(settings))).toBe("VK");

    function getActive(s: typeof settings) {
      const { profiles, activeId } = normalizeRecordingNameProfiles(s);
      return profiles.find((p) => p.id === activeId)!;
    }
  });
});
