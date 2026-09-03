import { describe, expect, it } from "vitest";
import {
  formatGoogleAuthExpiryHint,
  isGoogleAuthExpiryWarning
} from "../src/google-drive/auth-expiry";

describe("google drive auth expiry hint", () => {
  const now = 1_700_000_000_000;

  it("returns null when expiry unknown", () => {
    expect(formatGoogleAuthExpiryHint(null, now)).toBeNull();
    expect(formatGoogleAuthExpiryHint(undefined, now)).toBeNull();
  });

  it("shows expired message", () => {
    expect(formatGoogleAuthExpiryHint(now - 1, now)).toContain("已过期");
  });

  it("warns when under 15 minutes", () => {
    const hint = formatGoogleAuthExpiryHint(now + 10 * 60_000, now);
    expect(hint).toContain("10 分钟");
    expect(hint).toContain("自动刷新");
    expect(isGoogleAuthExpiryWarning(now + 10 * 60_000, now)).toBe(true);
  });

  it("shows hours and minutes when long-lived", () => {
    const hint = formatGoogleAuthExpiryHint(now + 90 * 60_000, now);
    expect(hint).toContain("1 小时 30 分钟");
    expect(isGoogleAuthExpiryWarning(now + 90 * 60_000, now)).toBe(false);
  });
});
