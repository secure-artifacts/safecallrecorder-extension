import { describe, expect, it } from "vitest";
import { resolveSessionExportName, updateSessionDisplayName } from "../src/session-display-name";
import type { Session } from "../src/types";

describe("session display name", () => {
  it("prefers custom displayName for export", () => {
    const session = { displayName: "我的通话", name: "0823" } as Session;
    expect(resolveSessionExportName(session, "08231")).toBe("我的通话");
  });

  it("falls back to scheme name when displayName empty", () => {
    const session = { name: "0823" } as Session;
    expect(resolveSessionExportName(session, "08231")).toBe("08231");
  });
});

describe("updateSessionDisplayName", () => {
  it("is exported", () => {
    expect(typeof updateSessionDisplayName).toBe("function");
  });
});
