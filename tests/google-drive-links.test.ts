import { describe, expect, it } from "vitest";
import { buildDriveFileViewUrl, driveLinkLabel, resolveSessionDriveWebUrl } from "../src/google-drive/drive-links";
import type { Session } from "../src/types";

function session(partial: Partial<Session>): Session {
  return {
    id: "s1",
    name: "test",
    mode: "device",
    status: "completed",
    startedAt: 0,
    safeDurationMs: 1000,
    recoveryCount: 0,
    bitrate: 64000,
    mixed: false,
    ...partial
  };
}

describe("drive-links", () => {
  it("builds a Drive view URL from file id", () => {
    expect(buildDriveFileViewUrl("abc123")).toBe("https://drive.google.com/file/d/abc123/view");
  });

  it("prefers saved web URL on session", () => {
    const s = session({
      driveMp3Status: "uploaded",
      driveMp3FileId: "abc123",
      driveMp3WebUrl: "https://drive.google.com/file/d/custom/view"
    });
    expect(resolveSessionDriveWebUrl(s)).toBe("https://drive.google.com/file/d/custom/view");
  });

  it("falls back to file id when web URL missing", () => {
    const s = session({
      driveMp3Status: "uploaded",
      driveMp3FileId: "abc123"
    });
    expect(resolveSessionDriveWebUrl(s)).toBe("https://drive.google.com/file/d/abc123/view");
  });

  it("returns undefined when not uploaded", () => {
    expect(resolveSessionDriveWebUrl(session({ driveMp3Status: "failed" }))).toBeUndefined();
  });

  it("uses file name as link label", () => {
    expect(driveLinkLabel(session({ driveMp3FileName: "会议_001.mp3" }))).toBe("会议_001.mp3");
    expect(driveLinkLabel(session({}))).toBe("打开云端音频");
  });
});
