import { describe, expect, it } from "vitest";
import {
  compareSelectedWithBrowser,
  formatChannels,
  normalizeLabel
} from "../src/device-verify";
import { readFileSync } from "node:fs";

describe("device verification", () => {
  it("formats channel counts", () => {
    expect(formatChannels(1)).toBe("单声道 (1)");
    expect(formatChannels(2)).toBe("立体声 (2)");
    expect(formatChannels(undefined)).toBe("未知");
  });

  it("matches same device id", () => {
    const selected = {
      deviceId: "abc",
      label: "VoiceMeeter Out B1",
      hint: "VoiceMeeter 虚拟输出",
      channelCount: 2
    };
    const browser = {
      deviceId: "abc",
      label: "VoiceMeeter Out B1 (VB-Audio VoiceMeeter VAIO)",
      hint: "VoiceMeeter 虚拟输出",
      channelCount: 2
    };
    const cmp = compareSelectedWithBrowser(selected, browser);
    expect(cmp.ok).toBe(true);
    expect(cmp.status).toBe("match_id");
  });

  it("flags mismatch between plugin and browser default", () => {
    const cmp = compareSelectedWithBrowser(
      {
        deviceId: "a",
        label: "VoiceMeeter Out B1",
        hint: "VoiceMeeter 虚拟输出",
        channelCount: 2
      },
      {
        deviceId: "b",
        label: "Microphone Array",
        hint: "普通麦克风",
        channelCount: 2
      }
    );
    expect(cmp.ok).toBe(false);
    expect(cmp.status).toBe("mismatch");
    expect(cmp.title).toContain("不一致");
  });

  it("normalizes labels for comparison", () => {
    expect(normalizeLabel("VoiceMeeter Out B1 (VB-Audio)")).toBe(normalizeLabel("VoiceMeeter Out B1"));
  });

  it("dashboard exposes device verify UI", () => {
    const html = readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf8");
    expect(html).toContain('id="deviceVerifyCard"');
    expect(html).toContain("插件当前选择");
    expect(html).toContain("浏览器默认输入");
    expect(html).toContain('id="verifyDeviceBtn"');
  });
});
