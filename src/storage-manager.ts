import type { Chunk, Mp3File, Part, Session } from "./types";

const DB = "SafeCallRecorder";
const VERSION = 2;

export class StorageManager {
  private db?: Promise<IDBDatabase>;

  /** Test helper: drop cached connection so a fresh IndexedDB can be opened. */
  resetForTests() {
    this.db = undefined;
  }

  open() {
    return (this.db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" });
        if (!d.objectStoreNames.contains("parts")) {
          d.createObjectStore("parts", { keyPath: "id" }).createIndex("sessionId", "sessionId");
        }
        if (!d.objectStoreNames.contains("chunks")) {
          d.createObjectStore("chunks", { keyPath: "id" }).createIndex("partId", "partId");
        }
        if (!d.objectStoreNames.contains("mp3Files")) {
          d.createObjectStore("mp3Files", { keyPath: "id" }).createIndex("sessionId", "sessionId");
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  private async put(store: string, value: unknown) {
    const d = await this.open();
    await new Promise<void>((ok, no) => {
      const t = d.transaction(store, "readwrite");
      t.objectStore(store).put(value);
      t.oncomplete = () => ok();
      t.onerror = () => no(t.error);
    });
  }

  saveSession(s: Session) {
    return this.put("sessions", s);
  }
  savePart(p: Part) {
    return this.put("parts", p);
  }
  saveChunk(c: Chunk) {
    return this.put("chunks", c);
  }
  saveMp3(f: Mp3File) {
    return this.put("mp3Files", f);
  }

  async all<T>(store: string): Promise<T[]> {
    const d = await this.open();
    return new Promise((ok, no) => {
      const r = d.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
  }

  async byIndex<T>(store: string, index: string, value: string): Promise<T[]> {
    const d = await this.open();
    return new Promise((ok, no) => {
      const r = d.transaction(store).objectStore(store).index(index).getAll(value);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
  }

  async getMp3(sessionId: string): Promise<Mp3File | undefined> {
    const files = await this.byIndex<Mp3File>("mp3Files", "sessionId", sessionId);
    return files[0];
  }

  async estimateSessionBytes(sessionId: string): Promise<number> {
    let bytes = 0;
    const parts = await this.byIndex<Part>("parts", "sessionId", sessionId);
    for (const part of parts) {
      const chunks = await this.byIndex<Chunk>("chunks", "partId", part.id);
      bytes += chunks.reduce((n, c) => n + (c.size || 0), 0);
    }
    const mp3s = await this.byIndex<Mp3File>("mp3Files", "sessionId", sessionId);
    bytes += mp3s.reduce((n, m) => n + (m.size || 0), 0);
    return bytes;
  }

  /**
   * Transactional delete order:
   * 1) MP3 cache  2) chunks  3) parts  4) session metadata/index last
   * Never remove the session index before underlying blobs succeed.
   */
  async deleteMp3ForSession(sessionId: string) {
    const mp3s = await this.byIndex<Mp3File>("mp3Files", "sessionId", sessionId);
    if (!mp3s.length) return;
    const d = await this.open();
    await new Promise<void>((ok, no) => {
      const t = d.transaction("mp3Files", "readwrite");
      for (const m of mp3s) t.objectStore("mp3Files").delete(m.id);
      t.oncomplete = () => ok();
      t.onerror = () => no(t.error);
    });
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const sessions = await this.all<Session>("sessions");
    return sessions.find((s) => s.id === sessionId);
  }

  async removeSession(id: string) {
    const d = await this.open();
    const parts = await this.byIndex<Part>("parts", "sessionId", id);
    const mp3s = await this.byIndex<Mp3File>("mp3Files", "sessionId", id);
    const chunkIds: string[] = [];
    const partIds = parts.map((p) => p.id);
    for (const part of parts) {
      const chunks = await this.byIndex<Chunk>("chunks", "partId", part.id);
      chunkIds.push(...chunks.map((c) => c.id));
    }

    await new Promise<void>((ok, no) => {
      const t = d.transaction(["mp3Files", "chunks", "parts", "sessions"], "readwrite");
      for (const m of mp3s) t.objectStore("mp3Files").delete(m.id);
      for (const cid of chunkIds) t.objectStore("chunks").delete(cid);
      for (const pid of partIds) t.objectStore("parts").delete(pid);
      t.objectStore("sessions").delete(id);
      t.oncomplete = () => ok();
      t.onerror = () => no(t.error);
      t.onabort = () => no(t.error || new Error("删除事务中止"));
    });
  }

  async clearAll() {
    const sessions = await this.all<Session>("sessions");
    for (const s of sessions) await this.removeSession(s.id);
  }
}

export const storage = new StorageManager();
