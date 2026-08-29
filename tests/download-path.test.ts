import { describe, expect, it } from "vitest";
import {
  buildDownloadPath,
  DEFAULT_DOWNLOAD_FOLDER,
  downloadFolderHint,
  friendlyProtectedFolderPickError,
  isProtectedFolderPickError,
  sanitizeDownloadFolder
} from "../src/download-path";

describe("download path", () => {
  it("sanitizes folder segments", () => {
    expect(sanitizeDownloadFolder(undefined)).toBe(DEFAULT_DOWNLOAD_FOLDER);
    expect(sanitizeDownloadFolder("  会议录音/2026  ")).toBe("会议录音/2026");
    expect(sanitizeDownloadFolder("..\\evil/../ok")).toBe("evil/ok");
    expect(sanitizeDownloadFolder("D:\\绝对路径")).toBe("D/绝对路径");
    expect(sanitizeDownloadFolder("", true)).toBe("");
    expect(sanitizeDownloadFolder("   ", true)).toBe("");
  });

  it("builds download paths under configured folder", () => {
    expect(buildDownloadPath("测试.mp3", "SafeCallRecorder")).toBe("SafeCallRecorder/测试.mp3");
    expect(buildDownloadPath("测试.mp3", "会议/2026")).toBe("会议/2026/测试.mp3");
    expect(buildDownloadPath("测试.mp3", "")).toBe("测试.mp3");
    expect(buildDownloadPath("测试.mp3", undefined)).toBe("测试.mp3");
  });

  it("describes folder hint for UI", () => {
    expect(downloadFolderHint("SafeCallRecorder/会议")).toContain("SafeCallRecorder");
    expect(downloadFolderHint("")).toContain("浏览器下载文件夹");
  });

  it("detects protected folder picker errors", () => {
    expect(isProtectedFolderPickError(new Error("无法打开此文件夹，因为它中含有系统文件"))).toBe(true);
    expect(isProtectedFolderPickError(new Error("permission denied"))).toBe(false);
    expect(friendlyProtectedFolderPickError()).toContain("使用下载文件夹");
  });
});
