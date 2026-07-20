import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HELP_CONTENT_VERSION } from "../src/help-nav";

describe("help system", () => {
  it("dashboard shows visible help entry", () => {
    const html = readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf8");
    expect(html).toContain('id="helpBtn"');
    expect(html).toContain("使用说明");
    expect(html).toContain('id="onboardingCard"');
    expect(html).toContain("第一次使用？");
    expect(html).toContain('id="showOnboardingAgain"');
    expect(html).toContain('id="helpDevicesLink"');
    expect(html).toContain('id="helpBitrateLink"');
    expect(html.indexOf('id="helpBtn"')).toBeLessThan(html.indexOf('id="settingsBtn"'));
  });

  it("help page contains required sections and anchors", () => {
    const html = readFileSync(new URL("../public/help.html", import.meta.url), "utf8");
    for (const id of [
      "quickstart",
      "devices",
      "voicemeeter",
      "waveform",
      "recording",
      "bitrate",
      "storage",
      "history",
      "recovery",
      "faq",
      "privacy"
    ]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
    expect(html).toContain("3步开始录音");
    expect(html).toContain("VoiceMeeter");
    expect(html).toContain("本地保存，不会上传");
    expect(html).toContain("64 kbps");
    expect(html).toContain("已安全保存");
    expect(html).toContain("help.css");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://cdn");
  });

  it("exports help content version", () => {
    expect(HELP_CONTENT_VERSION).toBe("1.0");
  });

  it("manifest does not add network host permissions for help", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
    expect(manifest.host_permissions || []).toEqual([]);
    expect(JSON.stringify(manifest)).not.toContain("https://");
  });
});
