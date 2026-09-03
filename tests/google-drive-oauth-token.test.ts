import { describe, expect, it } from "vitest";
import { parseOAuthCodeFromResponseUrl } from "../src/google-drive/oauth-token";

describe("google oauth code parsing", () => {
  it("parses authorization code from query string", () => {
    expect(
      parseOAuthCodeFromResponseUrl("https://abc.chromiumapp.org/?code=4%2Fabc&scope=email")
    ).toBe("4/abc");
  });

  it("throws on oauth error", () => {
    expect(() =>
      parseOAuthCodeFromResponseUrl("https://abc.chromiumapp.org/?error=access_denied")
    ).toThrow(/access_denied/);
  });
});
