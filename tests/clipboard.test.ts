import { describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "../src/google-drive/clipboard";

describe("clipboard", () => {
  it("returns false for empty text", async () => {
    await expect(copyTextToClipboard("   ")).resolves.toBe(false);
  });

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyTextToClipboard("https://example.com/a.mp3")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.com/a.mp3");
    vi.unstubAllGlobals();
  });
});
