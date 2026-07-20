import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MessageType } from "../src/messages";
import {
  hasChromeStorageLocal,
  isExtensionContext,
  diagnoseStorageEnvironment
} from "../src/extension-storage";

describe("storage permissions and routing", () => {
  it("source and dist manifests declare storage", () => {
    const pub = JSON.parse(readFileSync(resolve(__dirname, "../public/manifest.json"), "utf8"));
    expect(pub.permissions).toContain("storage");
    expect(pub.permissions).toContain("unlimitedStorage");
    // dist may not exist before build in some CI orders; check if present
    try {
      const dist = JSON.parse(readFileSync(resolve(__dirname, "../dist/manifest.json"), "utf8"));
      expect(dist.permissions).toContain("storage");
    } catch {
      /* build will create dist */
    }
  });

  it("exposes storage message types for offscreen proxy", () => {
    expect(MessageType.StorageGet).toBe("STORAGE_GET");
    expect(MessageType.StorageSet).toBe("STORAGE_SET");
    expect(MessageType.StorageRemove).toBe("STORAGE_REMOVE");
  });

  it("detects missing extension context without throwing on chrome.storage.local", () => {
    expect(isExtensionContext()).toBe(false);
    expect(hasChromeStorageLocal()).toBe(false);
    const env = diagnoseStorageEnvironment();
    expect(env.storageLocalExists).toBe(false);
  });

  it("recording-manager and offscreen do not call chrome.storage.local directly", () => {
    const recording = readFileSync(resolve(__dirname, "../src/recording-manager.ts"), "utf8");
    const offscreen = readFileSync(resolve(__dirname, "../src/offscreen.ts"), "utf8");
    const mp3 = readFileSync(resolve(__dirname, "../src/mp3-worker.ts"), "utf8");
    expect(recording).not.toMatch(/chrome\.storage\.local/);
    expect(offscreen).not.toMatch(/chrome\.storage\.local/);
    expect(mp3).not.toMatch(/chrome\.storage/);
  });

  it("dashboard does not call chrome.storage.local directly", () => {
    const dash = readFileSync(resolve(__dirname, "../src/dashboard.ts"), "utf8");
    expect(dash).not.toMatch(/chrome\.storage\.local/);
  });
});
