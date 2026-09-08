import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("build output", () => {
  it("does not delete dist root (avoids Chrome dropping unpacked extension)", async () => {
    const build = await readFile(new URL("../build.mjs", import.meta.url), "utf8");
    expect(build).not.toMatch(/await rm\(\s*["']dist["']/);
    expect(build).toContain("syncDirectory");
  });
});
