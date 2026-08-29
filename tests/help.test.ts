import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HELP_CONTENT_VERSION } from "../src/help-nav";

const helpImgDir = join(dirname(fileURLToPath(import.meta.url)), "../public/help");

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
    expect(html).toContain('id="helpNameLink"');
    expect(html.indexOf('id="helpBtn"')).toBeLessThan(html.indexOf('id="settingsBtn"'));
  });

  it("help page contains required sections, anchors, and offline illustrations", () => {
    const html = readFileSync(new URL("../public/help.html", import.meta.url), "utf8");
    for (const id of [
      "overview",
      "quickstart",
      "device-verify",
      "devices",
      "voicemeeter",
      "local-media",
      "auto-start",
      "waveform",
      "recording",
      "name",
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
    expect(html).toContain("3 步开始录音");
    expect(html).toContain("设备核对");
    expect(html).toContain("插件内播放本地媒体");
    expect(html).toContain("插件内播放结束后自动开始");
    expect(html).toContain("data-help-src=\"help/img-dashboard.svg\"");
    expect(html).toContain("help/img-local-media.svg");
    expect(html).toContain("VoiceMeeter");
    expect(html).toContain("本地保存，不会上传");
    expect(html).toContain("64 kbps");
    expect(html).toContain("已安全保存");
    expect(html).toContain("录音名称怎么拼");
    expect(html).toContain("不会自动加横线");
    expect(html).toContain("一轮最大值");
    expect(html).toContain("img-rec-name.svg");
    expect(html).toContain("使用下载文件夹");
    expect(html).toContain("导出备份");
    expect(html).toContain("导入备份");
    expect(html).toContain("播放列表");
    expect(html).toContain("导出MP3");
    expect(html).toContain("help.css");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://cdn");

    for (const img of [
      "img-dashboard.svg",
      "img-rec-name.svg",
      "img-device-verify.svg",
      "img-local-media.svg",
      "img-auto-start.svg",
      "img-waveform.svg"
    ]) {
      const path = join(helpImgDir, img);
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path);
      expect(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf).toBe(false);
      const text = raw.toString("utf8");
      expect(text.startsWith("<svg")).toBe(true);
      expect(text.endsWith("</svg>\n") || text.endsWith("</svg>")).toBe(true);
      expect(text).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    }
  });

  it("help script resolves extension image URLs", () => {
    const js = readFileSync(new URL("../src/help.ts", import.meta.url), "utf8");
    expect(js).toContain("setupHelpImages");
    expect(js).toContain("chrome.runtime.getURL");
  });

  it("exports help content version", () => {
    expect(HELP_CONTENT_VERSION).toBe("1.3.0");
  });

  it("manifest does not add network host permissions for help", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
    expect(manifest.host_permissions || []).toEqual([]);
    expect(JSON.stringify(manifest)).not.toContain("https://");
  });
});
