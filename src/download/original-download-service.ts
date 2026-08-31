import { saveDownloadBlob } from "../download-save";
import { buildOriginalFileName, buildRecoveryZipName, formatStamp, sanitizeFileBase } from "../filename";
import { storage } from "../storage-manager";
import { type Chunk, type Part, type Session } from "../types";
import { finalizeWebmDurationBlob } from "../webm-duration";
import { buildStoreZip } from "../zip-store";

const pendingOriginal = new Map<string, Promise<OriginalDownloadResult>>();

export type OriginalDownloadResult = {
  ok: boolean;
  kind: "webm" | "zip" | "parts" | "none";
  filename?: string;
  filenames?: string[];
  downloadId?: number;
  partCount: number;
  error?: { code: string; message: string };
};

async function partsForSession(sessionId: string): Promise<Part[]> {
  const parts = (await storage.byIndex<Part>("parts", "sessionId", sessionId))
    .filter((p) => p.trackId === "selected_device" || p.trackId === "tab_audio")
    .sort((a, b) => a.startedAt - b.startedAt);
  const deviceParts = parts.filter((p) => p.trackId === "selected_device");
  return deviceParts.length ? deviceParts : parts;
}

async function chunksForPart(partId: string): Promise<Chunk[]> {
  return (await storage.byIndex<Chunk>("chunks", "partId", partId)).sort((a, b) => a.index - b.index);
}

async function assemblePartWebm(
  part: Part,
  durationHintMs = 0
): Promise<{ blob: Blob; mimeType: string; chunkCount: number; size: number; missingIndex: boolean } | null> {
  const chunks = await chunksForPart(part.id);
  if (!chunks.length) return null;
  let missingIndex = false;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i]!.index !== i && chunks[i]!.index !== chunks[0]!.index + i) {
      // Allow non-zero start; detect gaps
      if (i > 0 && chunks[i]!.index !== chunks[i - 1]!.index + 1) missingIndex = true;
    }
  }
  const blobs = chunks.map((c) => c.blob);
  const rawSize = chunks.reduce((n, c) => n + c.size, 0);
  const mimeType = part.mimeType || chunks[0]!.mimeType || "audio/webm";
  const raw = new Blob(blobs, { type: mimeType });
  const durationMs =
    durationHintMs ||
    (part.endedAt && part.startedAt ? part.endedAt - part.startedAt : 0) ||
    chunks.reduce((n, c) => n + (c.durationMs || 0), 0);
  const blob = /webm/i.test(mimeType) ? await finalizeWebmDurationBlob(raw, durationMs) : raw;
  return {
    blob,
    mimeType,
    chunkCount: chunks.length,
    size: blob.size || rawSize,
    missingIndex
  };
}

function extFromMime(mime: string): string {
  if (/webm/i.test(mime)) return "webm";
  if (/ogg/i.test(mime)) return "ogg";
  if (/mp4|m4a|aac/i.test(mime)) return "m4a";
  if (/wav/i.test(mime)) return "wav";
  return "webm";
}

export async function prepareOriginalExport(
  sessionId: string,
  durationHintMs = 0
): Promise<{
  parts: Part[];
  assembled: Array<{ part: Part; blob: Blob; mimeType: string; ok: boolean; error?: string }>;
}> {
  const parts = await partsForSession(sessionId);
  const assembled: Array<{ part: Part; blob: Blob; mimeType: string; ok: boolean; error?: string }> = [];
  for (const part of parts) {
    try {
      const one = await assemblePartWebm(part, durationHintMs);
      if (!one || one.size <= 0) {
        assembled.push({ part, blob: new Blob(), mimeType: part.mimeType, ok: false, error: "empty" });
        continue;
      }
      assembled.push({ part, blob: one.blob, mimeType: one.mimeType, ok: true });
    } catch (e) {
      assembled.push({
        part,
        blob: new Blob(),
        mimeType: part.mimeType,
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }
  return { parts, assembled };
}

export async function downloadOriginalRecording(
  sessionId: string,
  options?: { saveAs?: boolean; trigger?: "auto" | "manual"; displayNameOverride?: string }
): Promise<OriginalDownloadResult> {
  const existing = pendingOriginal.get(sessionId);
  if (existing) return existing;

  const task = (async (): Promise<OriginalDownloadResult> => {
    const sessions = await storage.all<Session>("sessions");
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      return { ok: false, kind: "none", partCount: 0, error: { code: "NOT_FOUND", message: "找不到录音" } };
    }

    const { assembled } = await prepareOriginalExport(
      sessionId,
      session.durationMs || session.safeDurationMs || 0
    );
    const usable = assembled.filter((a) => a.ok && a.blob.size > 0);
    if (!usable.length) {
      session.originalStatus = "missing";
      session.originalError = "没有可下载的原始录音数据。";
      await storage.saveSession(session);
      return {
        ok: false,
        kind: "none",
        partCount: assembled.length,
        error: { code: "NO_DATA", message: session.originalError }
      };
    }

    const display = options?.displayNameOverride || session.displayName || session.name;
    const startedAt = session.startedAt;

    try {
      if (usable.length === 1) {
        const one = usable[0]!;
        const ext = extFromMime(one.mimeType);
        const filename = buildOriginalFileName(display, ext);
        const saved = await saveDownloadBlob(one.blob, filename, { saveAs: options?.saveAs === true });
        if (!saved.ok) throw new Error(saved.error.message);
        session.originalStatus = "available";
        session.originalFileName = filename;
        session.originalMimeType = one.mimeType;
        session.originalError = undefined;
        await storage.saveSession(session);
        return {
          ok: true,
          kind: "webm",
          filename: saved.filename,
          downloadId: saved.downloadId,
          partCount: 1
        };
      }

      // Multi-part: ZIP with each playable part + session.json
      const zipEntries: { name: string; data: Uint8Array }[] = [];
      const meta = {
        sessionId,
        displayName: display,
        startedAt,
        endedAt: session.endedAt,
        safeDurationMs: session.safeDurationMs,
        parts: usable.map((u, i) => ({
          file: `part_${String(i + 1).padStart(3, "0")}.${extFromMime(u.mimeType)}`,
          partId: u.part.id,
          mimeType: u.mimeType,
          size: u.blob.size,
          startedAt: u.part.startedAt,
          endedAt: u.part.endedAt
        }))
      };
      zipEntries.push({
        name: "session.json",
        data: new TextEncoder().encode(JSON.stringify(meta, null, 2))
      });
      for (let i = 0; i < usable.length; i++) {
        const u = usable[i]!;
        const name = `part_${String(i + 1).padStart(3, "0")}.${extFromMime(u.mimeType)}`;
        zipEntries.push({ name, data: new Uint8Array(await u.blob.arrayBuffer()) });
      }

      const zipBlob = buildStoreZip(zipEntries);
      const filename = buildRecoveryZipName(display);
      const saved = await saveDownloadBlob(zipBlob, filename, { saveAs: options?.saveAs === true });
      if (!saved.ok) throw new Error(saved.error.message);
      session.originalStatus = "available";
      session.originalFileName = filename;
      session.originalMimeType = "application/zip";
      session.originalError = undefined;
      await storage.saveSession(session);
      return { ok: true, kind: "zip", filename: saved.filename, downloadId: saved.downloadId, partCount: usable.length };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      session.originalStatus = "download_failed";
      session.originalError = `自动下载未启动：${message}`;
      await storage.saveSession(session);
      return {
        ok: false,
        kind: usable.length > 1 ? "zip" : "webm",
        partCount: usable.length,
        error: { code: "DOWNLOAD_FAILED", message }
      };
    }
  })().finally(() => {
    pendingOriginal.delete(sessionId);
  });

  pendingOriginal.set(sessionId, task);
  return task;
}

export { assemblePartWebm, chunksForPart, partsForSession, formatStamp, sanitizeFileBase };
