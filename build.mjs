import { build } from "esbuild";
import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { syncDirectory } from "./scripts/sync-dir.mjs";

const STAGING = ".build-tmp";
const OUT = "dist";

spawnSync(process.execPath, ["scripts/write-help-svgs.mjs"], { stdio: "inherit" });

await rm(STAGING, { recursive: true, force: true });
await mkdir(STAGING, { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/service-worker.ts"],
    outfile: join(STAGING, "service-worker.js"),
    bundle: true,
    format: "iife",
    target: "chrome116"
  }),
  build({
    entryPoints: ["src/offscreen.ts"],
    outfile: join(STAGING, "offscreen.js"),
    bundle: true,
    format: "iife",
    target: "chrome116"
  }),
  build({
    entryPoints: ["src/dashboard.ts"],
    outfile: join(STAGING, "dashboard.js"),
    bundle: true,
    format: "iife",
    target: "chrome116"
  }),
  build({
    entryPoints: ["src/help.ts"],
    outfile: join(STAGING, "help.js"),
    bundle: true,
    format: "iife",
    target: "chrome116"
  }),
  build({
    entryPoints: ["src/mp3-worker.ts"],
    outfile: join(STAGING, "mp3-worker.js"),
    bundle: true,
    format: "iife",
    target: "chrome116",
    banner: {
      js: `importScripts(new URL("lame.min.js", self.location.href).toString());`
    }
  })
]);

await cp("public", STAGING, { recursive: true });
await copyFile("node_modules/lamejs/lame.min.js", join(STAGING, "lame.min.js"));
await Promise.all([
  rm(join(STAGING, "popup.html"), { force: true }),
  rm(join(STAGING, "popup.js"), { force: true }),
  rm(join(STAGING, "icons/icon-source.png"), { force: true })
]);

// Sync into dist without deleting the dist folder — Chrome keeps the unpacked extension loaded.
await syncDirectory(STAGING, OUT);
await rm(STAGING, { recursive: true, force: true });
