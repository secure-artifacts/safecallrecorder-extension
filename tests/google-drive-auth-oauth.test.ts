import { describe, expect, it } from "vitest";
import { parseOAuthTokenFromResponseUrl } from "../src/google-drive/auth";

describe("google oauth response parsing", () => {
  it("parses access_token from hash fragment", () => {
    const result = parseOAuthTokenFromResponseUrl(
      "https://abc.chromiumapp.org/#access_token=token123&expires_in=3600&token_type=Bearer"
    );
    expect(result.token).toBe("token123");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws on oauth error instead of missing token message", () => {
    expect(() =>
      parseOAuthTokenFromResponseUrl("https://abc.chromiumapp.org/#error=login_required")
    ).toThrow(/login_required/);
  });

  it("throws when token missing and no oauth error", () => {
    expect(() => parseOAuthTokenFromResponseUrl("https://abc.chromiumapp.org/#state=abc")).toThrow(
      /access_token/
    );
  });
});
