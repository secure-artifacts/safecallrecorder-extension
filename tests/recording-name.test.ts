import { describe, expect, it } from "vitest";
import {
  buildRecordingName,
  daysBetweenLocal,
  formatDateOnly,
  formatRecordingDate,
  normalizePartOrder,
  normalizeRecordingNameConfig,
  resolveDailyNumber,
  sessionDisplayTitle
} from "../src/recording-name";
import { buildMp3FileName, sanitizeFileBase } from "../src/filename";

describe("recording name builder", () => {
  const day = new Date(2026, 7, 23, 15, 30, 0);

  it("combines date, number, and custom without separators", () => {
    const name = buildRecordingName(
      {
        useDate: true,
        dateIncludeYear: false,
        useNumber: true,
        useCustom: true,
        customText: "VK通话",
        numberSeed: 1,
        numberSeedDate: "2026-08-23",
        partOrder: ["date", "number", "custom"]
      },
      day
    );
    expect(name).toBe("08231VK通话");
  });

  it("respects custom part order", () => {
    const name = buildRecordingName(
      {
        useDate: true,
        dateIncludeYear: false,
        useNumber: true,
        useCustom: true,
        customText: "VK通话",
        numberSeed: 1,
        numberSeedDate: "2026-08-23",
        partOrder: ["custom", "number", "date"]
      },
      day
    );
    expect(name).toBe("VK通话10823");
  });

  it("normalizes incomplete part order", () => {
    expect(normalizePartOrder(["custom", "date"])).toEqual(["custom", "date", "number"]);
  });

  it("increments daily number across calendar days", () => {
    const config = normalizeRecordingNameConfig({
      useNumber: true,
      numberSeed: 1,
      numberSeedDate: "2026-08-23"
    });
    expect(resolveDailyNumber(config, day)).toBe(1);
    expect(resolveDailyNumber(config, new Date(2026, 7, 24))).toBe(2);
    expect(daysBetweenLocal("2026-08-23", "2026-08-25")).toBe(2);
  });

  it("wraps daily number when numberCycleMax is set", () => {
    const item = {
      id: "n1",
      kind: "number" as const,
      numberSeed: 1,
      numberSeedDate: "2026-08-23",
      numberCycleMax: 8
    };
    expect(
      buildRecordingName(
        { dateIncludeYear: false, items: [{ id: "d1", kind: "date" }, item] },
        day
      )
    ).toBe("08231");
    expect(
      buildRecordingName(
        { dateIncludeYear: false, items: [{ id: "d1", kind: "date" }, item] },
        new Date(2026, 7, 30)
      )
    ).toBe("08308");
    expect(
      buildRecordingName(
        { dateIncludeYear: false, items: [{ id: "d1", kind: "date" }, item] },
        new Date(2026, 7, 31)
      )
    ).toBe("08311");
  });

  it("uses custom only without auto timestamp", () => {
    expect(
      buildRecordingName(
        { useDate: false, useNumber: false, useCustom: true, customText: "会议", numberSeed: 1, partOrder: ["custom"] },
        day
      )
    ).toBe("会议");
    expect(buildMp3FileName("会议")).toBe("会议.mp3");
  });

  it("falls back when no parts enabled", () => {
    expect(
      buildRecordingName(
        { useDate: false, useNumber: false, useCustom: false, customText: "", numberSeed: 1, partOrder: ["date", "number", "custom"] },
        day
      )
    ).toBe("未命名录音");
  });

  it("defaults to month-day digits without year", () => {
    expect(buildRecordingName({ useDate: true }, day)).toBe("0823");
  });

  it("formats local date only", () => {
    expect(formatDateOnly(day)).toBe("2026-08-23");
    expect(formatRecordingDate(day, false)).toBe("0823");
    expect(formatRecordingDate(day, true)).toBe("20260823");
  });

  it("uses compact year digits when dateIncludeYear is on", () => {
    expect(
      buildRecordingName(
        {
          useDate: true,
          dateIncludeYear: true,
          useNumber: false,
          useCustom: false,
          customText: "",
          numberSeed: 1,
          partOrder: ["date", "number", "custom"]
        },
        day
      )
    ).toBe("20260823");
  });

  it("allows repeating date, number, and custom parts", () => {
    const name = buildRecordingName(
      {
        dateIncludeYear: false,
        items: [
          { id: "d1", kind: "date" },
          { id: "c1", kind: "custom", text: "VK" },
          { id: "d2", kind: "date" },
          { id: "n1", kind: "number", numberSeed: 3, numberSeedDate: "2026-08-23" },
          { id: "c2", kind: "custom", text: "№12" }
        ]
      },
      day
    );
    expect(name).toBe("0823VK08233№12");
  });

  it("inserts a space only when a space part is added", () => {
    const name = buildRecordingName(
      {
        dateIncludeYear: false,
        items: [
          { id: "d1", kind: "date" },
          { id: "s1", kind: "space" },
          { id: "c1", kind: "custom", text: "VK" },
          { id: "s2", kind: "space" },
          { id: "n1", kind: "number", numberSeed: 3, numberSeedDate: "2026-08-23" }
        ]
      },
      day
    );
    expect(name).toBe("0823 VK 3");
  });

  it("session title prefers displayName", () => {
    expect(sessionDisplayTitle("2026-08-23_1", "旧名称")).toBe("2026-08-23_1");
  });
});

describe("filename without timestamp", () => {
  it("builds exact display name for mp3", () => {
    expect(buildMp3FileName("VK通话")).toBe("VK通话.mp3");
    expect(buildMp3FileName(undefined)).toBe("未命名录音.mp3");
  });

  it("keeps custom text exactly as typed", () => {
    expect(
      buildRecordingName({
        useDate: false,
        useNumber: false,
        useCustom: true,
        customText: "VK  №12  A...B"
      })
    ).toBe("VK  №12  A...B");
    expect(sessionDisplayTitle("VK  №12  A...B")).toBe("VK  №12  A...B");
  });

  it("strips illegal path characters", () => {
    expect(sanitizeFileBase("../a\\b:c*?.txt")).not.toMatch(/[<>:"/\\|?*]/);
  });

  it("keeps numero sign instead of expanding it to No", () => {
    expect(sanitizeFileBase("VK №12")).toBe("VK №12");
    expect(buildMp3FileName("VK №12")).toBe("VK №12.mp3");
    expect(
      buildRecordingName({
        useDate: false,
        useNumber: false,
        useCustom: true,
        customText: "VK №12"
      })
    ).toBe("VK №12");
  });

  it("does not rewrite display names when building download filenames", () => {
    expect(buildRecordingName({ useDate: false, useCustom: true, customText: "会议:上" })).toBe("会议:上");
    expect(buildMp3FileName("会议:上")).toBe("会议_上.mp3");
  });

  it("adds numeric suffix for collisions only", () => {
    expect(buildMp3FileName("会议", 2)).toBe("会议_2.mp3");
    expect(buildMp3FileName("会议", 0)).toBe("会议.mp3");
  });
});
