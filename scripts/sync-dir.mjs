import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/** List relative file paths under dir (posix slashes). */
export async function listFilesRecursive(dir) {
  /** @type {string[]} */
  const files = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else files.push(relative(dir, abs).split("\\").join("/"));
    }
  }
  await walk(dir);
  return files;
}

/**
 * Copy src into dest without removing dest root (keeps Chrome unpacked extension registered).
 * Overwrites changed files and deletes obsolete files under dest.
 */
export async function syncDirectory(src, dest) {
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true, force: true });

  const srcFiles = new Set(await listFilesRecursive(src));
  const destFiles = await listFilesRecursive(dest);
  for (const rel of destFiles) {
    if (srcFiles.has(rel)) continue;
    await rm(join(dest, rel), { recursive: true, force: true });
  }
}

export async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
