import { build } from "esbuild";
import { cp, mkdir, rm, copyFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/service-worker.ts"],
    outfile: "dist/service-worker.js",
    bundle: true,
    format: "iife",
    target: "chrome116"
  }),
  build({
    entryPoints: ["src/offscreen.ts"],
    outfile: "dist/offscreen.js",
    bundle: true,
    format: "iife",
    target: "chrome116"
  }),
  build({
    entryPoints: ["src/dashboard.ts"],
    outfile: "dist/dashboard.js",
    bundle: true,
    format: "iife",
    target: "chrome116"
  }),
  build({
    entryPoints: ["src/help.ts"],
    outfile: "dist/help.js",
    bundle: true,
    format: "iife",
    target: "chrome116"
  }),
  build({
    entryPoints: ["src/mp3-worker.ts"],
    outfile: "dist/mp3-worker.js",
    bundle: true,
    format: "iife",
    target: "chrome116",
    // Load local lame.min.js in classic worker scope (avoids MPEGMode bundling bug).
    banner: {
      js: `importScripts(new URL("lame.min.js", self.location.href).toString());`
    }
  })
]);

await cp("public", "dist", { recursive: true });
await copyFile("node_modules/lamejs/lame.min.js", "dist/lame.min.js");
await Promise.all([
  rm("dist/popup.html", { force: true }),
  rm("dist/popup.js", { force: true }),
  rm("dist/icons/icon-source.png", { force: true })
]);
