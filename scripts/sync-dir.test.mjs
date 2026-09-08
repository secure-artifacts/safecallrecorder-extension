import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFilesRecursive, syncDirectory } from "./sync-dir.mjs";

describe("syncDirectory", () => {
  it("overwrites files and removes obsolete entries without deleting dest root", async () => {
    const base = await mkdtemp(join(tmpdir(), "scr-sync-"));
    const src = join(base, "src");
    const dest = join(base, "dest");
    await mkdir(src, { recursive: true });
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, "keep-until-prune.txt"), "old", "utf8");

    await mkdir(join(src, "help"), { recursive: true });
    await writeFile(join(src, "manifest.json"), '{"version":"1"}', "utf8");
    await writeFile(join(src, "help", "help.css"), "body{}", "utf8");

    await syncDirectory(src, dest);

    expect(await readFile(join(dest, "manifest.json"), "utf8")).toBe('{"version":"1"}');
    expect(await listFilesRecursive(dest)).toEqual(["help/help.css", "manifest.json"]);

    await rm(base, { recursive: true, force: true });
  });
});
