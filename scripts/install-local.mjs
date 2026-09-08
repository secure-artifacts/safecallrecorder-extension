import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { syncDirectory, pathExists } from "./sync-dir.mjs";

const projectRoot = join(import.meta.dirname, "..");
const distDir = join(projectRoot, "dist");

const installDir =
  process.env.SAFECALLRECORDER_INSTALL_DIR?.trim() ||
  join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "SafeCallRecorder", "extension");

const skipBuild = process.argv.includes("--no-build");

if (!skipBuild) {
  const build = spawnSync(process.execPath, ["build.mjs"], {
    cwd: projectRoot,
    stdio: "inherit"
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
} else if (!(await pathExists(join(distDir, "manifest.json")))) {
  console.error("dist/manifest.json 不存在，请先运行 npm run build");
  process.exit(1);
}

await mkdir(installDir, { recursive: true });
await syncDirectory(distDir, installDir);
await writeFile(
  join(projectRoot, ".install-path.txt"),
  `${installDir}\n`,
  "utf8"
);

console.log("");
console.log("SafeCallRecorder 已安装到固定目录（不会因项目 build 而从浏览器消失）：");
console.log(installDir);
console.log("");
console.log("首次或换电脑时只需加载一次：");
console.log("  1. 打开 chrome://extensions 或 edge://extensions");
console.log("  2. 开启「开发者模式」");
console.log("  3. 「加载已解压的扩展程序」→ 选择上面的文件夹");
console.log("  4. 以后更新请运行 npm run install:local，然后在扩展页点「刷新 ↻」");
console.log("     不要重新「加载已解压的扩展程序」，否则会换扩展 ID，Google OAuth 要重配");
console.log("");
