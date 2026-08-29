import { describe, expect, it } from "vitest";
import { buildStoreZip } from "../src/zip-store";
import { readStoreZip } from "../src/zip-read";

describe("readStoreZip", () => {
  it("round-trips entries built by buildStoreZip", async () => {
    const entries = buildStoreZip([
      { name: "manifest.json", data: new TextEncoder().encode('{"ok":true}') },
      { name: "blobs/chunks/a.bin", data: new Uint8Array([1, 2, 3]) },
      { name: "blobs/mp3/m.mp3", data: new Uint8Array([9, 8, 7, 6]) }
    ]);
    const parsed = readStoreZip(await entries.arrayBuffer());
    expect(parsed.size).toBe(3);
    expect(new TextDecoder().decode(parsed.get("manifest.json"))).toBe('{"ok":true}');
    expect([...parsed.get("blobs/chunks/a.bin")!]).toEqual([1, 2, 3]);
    expect([...parsed.get("blobs/mp3/m.mp3")!]).toEqual([9, 8, 7, 6]);
  });

  it("rejects invalid zip", () => {
    expect(() => readStoreZip(new Uint8Array([0, 1, 2]).buffer)).toThrow(/无效的 ZIP/);
  });
});
