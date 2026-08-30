import { isSessionBusy } from "./recording-deletion-service";
import { storage } from "./storage-manager";
import type { Chunk, Mp3File, Part, Session } from "./types";
import { readStoreZip } from "./zip-read";
import { buildStoreZip, type ZipEntry } from "./zip-store";

export const HISTORY_BACKUP_FORMAT_VERSION = 1;
const MANIFEST_NAME = "manifest.json";
const APP_NAME = "SafeCallRecorder";

export type HistoryBackupManifest = {
  formatVersion: typeof HISTORY_BACKUP_FORMAT_VERSION;
  app: typeof APP_NAME;
  exportedAt: number;
  sessions: Session[];
  parts: Part[];
  chunks: Array<Omit<Chunk, "blob"> & { blobPath: string }>;
  mp3Files: Array<Omit<Mp3File, "blob"> & { blobPath: string }>;
};

export type ExportHistoryResult = {
  blob: Blob;
  exportedSessions: number;
  skippedSessionIds: string[];
  totalBytes: number;
};

export type ImportHistoryResult = {
  importedSessions: number;
  skippedSessions: number;
  errors: string[];
};

export type HistoryBackupProgress = (message: string) => void;

function chunkBlobPath(chunkId: string) {
  return `blobs/chunks/${chunkId}.bin`;
}

function mp3BlobPath(mp3Id: string) {
  return `blobs/mp3/${mp3Id}.bin`;
}

function normalizeImportedSession(session: Session): Session {
  const busyStatuses: Session["status"][] = ["starting", "recording", "paused", "exporting"];
  let status = session.status;
  if (busyStatuses.includes(status)) {
    status = session.endedAt ? "completed" : "interrupted";
  }

  let recordingStatus = session.recordingStatus;
  if (recordingStatus === "starting" || recordingStatus === "recording" || recordingStatus === "paused") {
    recordingStatus = session.endedAt ? "completed" : "interrupted";
  }

  let historyStatus = session.historyStatus;
  if (historyStatus === "recording" || historyStatus === "processing_mp3" || historyStatus === "deleting") {
    historyStatus =
      session.hasMp3 && session.mp3Status === "completed"
        ? "completed"
        : session.mp3Status === "failed"
          ? "mp3_failed"
          : session.endedAt
            ? "completed"
            : "interrupted";
  }

  let mp3Status = session.mp3Status;
  if (mp3Status === "queued" || mp3Status === "decoding" || mp3Status === "encoding" || mp3Status === "validating") {
    mp3Status = session.hasMp3 ? "completed" : "failed";
  }

  return {
    ...session,
    status,
    recordingStatus,
    historyStatus,
    mp3Status,
    mp3Progress: undefined,
    mp3ProgressLabel: undefined
  };
}

async function finalizeImportedSession(sessionId: string): Promise<void> {
  const session = (await storage.all<Session>("sessions")).find((s) => s.id === sessionId);
  if (!session) return;

  const parts = await storage.byIndex<Part>("parts", "sessionId", sessionId);
  let chunkBytes = 0;
  for (const part of parts) {
    const chunks = await storage.byIndex<Chunk>("chunks", "partId", part.id);
    chunkBytes += chunks.reduce((n, c) => n + (c.size || c.blob?.size || 0), 0);
  }

  const mp3 = await storage.getMp3(sessionId);
  const updates: Partial<Session> = {};

  if (chunkBytes > 0) {
    updates.originalStatus = "available";
    if (!session.recordingStatus || session.recordingStatus === "starting") {
      updates.recordingStatus = "completed";
    }
    if (session.status === "interrupted" && session.endedAt) {
      updates.status = "completed";
    }
  }

  if (mp3?.blob && mp3.blob.size > 0) {
    updates.hasMp3 = true;
    updates.mp3Status = "completed";
    updates.mp3FileName = mp3.fileName;
    updates.mp3MimeType = mp3.mimeType;
    updates.mp3Error = undefined;
  }

  const totalSize = chunkBytes + (mp3?.size || mp3?.blob?.size || 0);
  if (totalSize > 0) updates.fileSize = totalSize;

  if (updates.hasMp3 && chunkBytes > 0) {
    updates.historyStatus = "completed";
  } else if (chunkBytes > 0) {
    updates.historyStatus =
      session.mp3Status === "failed" || session.historyStatus === "mp3_failed" ? "mp3_failed" : "completed";
  }

  await storage.saveSession({ ...session, ...updates });
}

export function buildHistoryBackupFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
  return `历史备份_${stamp}.scr.zip`;
}

export async function exportHistoryBackup(onProgress?: HistoryBackupProgress): Promise<ExportHistoryResult> {
  onProgress?.("正在读取录音历史……");
  const sessions = await storage.all<Session>("sessions");
  const skippedSessionIds: string[] = [];
  const exportSessions: Session[] = [];

  for (const session of sessions) {
    if (isSessionBusy(session)) {
      skippedSessionIds.push(session.id);
      continue;
    }
    exportSessions.push(session);
  }

  if (exportSessions.length === 0) {
    throw new Error(
      skippedSessionIds.length > 0
        ? "当前没有可导出的历史记录（正在录音或处理中的条目已跳过）。"
        : "没有可导出的录音历史。"
    );
  }

  const parts: Part[] = [];
  const manifestChunks: HistoryBackupManifest["chunks"] = [];
  const manifestMp3: HistoryBackupManifest["mp3Files"] = [];
  const zipEntries: ZipEntry[] = [];
  let totalBytes = 0;

  for (const session of exportSessions) {
    onProgress?.(`正在打包：${session.displayName || session.name || session.id}`);
    const sessionParts = await storage.byIndex<Part>("parts", "sessionId", session.id);
    parts.push(...sessionParts);

    for (const part of sessionParts) {
      const chunks = await storage.byIndex<Chunk>("chunks", "partId", part.id);
      for (const chunk of chunks) {
        const blobPath = chunkBlobPath(chunk.id);
        const data = new Uint8Array(await chunk.blob.arrayBuffer());
        totalBytes += data.length;
        manifestChunks.push({
          id: chunk.id,
          sessionId: chunk.sessionId,
          partId: chunk.partId,
          trackId: chunk.trackId,
          index: chunk.index,
          startedAt: chunk.startedAt,
          endedAt: chunk.endedAt,
          durationMs: chunk.durationMs,
          size: chunk.size,
          mimeType: chunk.mimeType,
          blobPath
        });
        zipEntries.push({ name: blobPath, data });
      }
    }

    const mp3 = await storage.getMp3(session.id);
    if (mp3) {
      const blobPath = mp3BlobPath(mp3.id);
      const data = new Uint8Array(await mp3.blob.arrayBuffer());
      totalBytes += data.length;
      manifestMp3.push({
        id: mp3.id,
        sessionId: mp3.sessionId,
        fileName: mp3.fileName,
        mimeType: mp3.mimeType,
        size: mp3.size,
        createdAt: mp3.createdAt,
        blobPath
      });
      zipEntries.push({ name: blobPath, data });
    }
  }

  const manifest: HistoryBackupManifest = {
    formatVersion: HISTORY_BACKUP_FORMAT_VERSION,
    app: APP_NAME,
    exportedAt: Date.now(),
    sessions: exportSessions,
    parts,
    chunks: manifestChunks,
    mp3Files: manifestMp3
  };

  zipEntries.unshift({
    name: MANIFEST_NAME,
    data: new TextEncoder().encode(JSON.stringify(manifest))
  });

  onProgress?.("正在生成备份文件……");
  const blob = buildStoreZip(zipEntries);
  totalBytes += blob.size;

  return {
    blob,
    exportedSessions: exportSessions.length,
    skippedSessionIds,
    totalBytes
  };
}

function parseManifest(raw: string): HistoryBackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("备份 manifest 不是有效的 JSON。");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("备份 manifest 格式无效。");
  const m = parsed as Partial<HistoryBackupManifest>;
  if (m.formatVersion !== HISTORY_BACKUP_FORMAT_VERSION) {
    throw new Error(`不支持的备份版本 (${String(m.formatVersion)})。`);
  }
  if (m.app !== APP_NAME) throw new Error("不是 SafeCallRecorder 的历史备份文件。");
  if (!Array.isArray(m.sessions) || !Array.isArray(m.parts) || !Array.isArray(m.chunks) || !Array.isArray(m.mp3Files)) {
    throw new Error("备份 manifest 缺少必要字段。");
  }
  return m as HistoryBackupManifest;
}

export async function importHistoryBackup(file: Blob, onProgress?: HistoryBackupProgress): Promise<ImportHistoryResult> {
  onProgress?.("正在读取备份文件……");
  const entries = readStoreZip(await file.arrayBuffer());
  const manifestBytes = entries.get(MANIFEST_NAME);
  if (!manifestBytes) throw new Error("备份文件中缺少 manifest.json。");
  const manifest = parseManifest(new TextDecoder().decode(manifestBytes));

  const sessionMap = new Map<string, string>();
  const partMap = new Map<string, string>();
  const chunkMap = new Map<string, string>();
  const mp3Map = new Map<string, string>();

  for (const session of manifest.sessions) sessionMap.set(session.id, crypto.randomUUID());
  for (const part of manifest.parts) partMap.set(part.id, crypto.randomUUID());
  for (const chunk of manifest.chunks) chunkMap.set(chunk.id, crypto.randomUUID());
  for (const mp3 of manifest.mp3Files) mp3Map.set(mp3.id, crypto.randomUUID());

  const errors: string[] = [];
  let importedSessions = 0;
  let skippedSessions = 0;

  for (const session of manifest.sessions) {
    const newSessionId = sessionMap.get(session.id);
    if (!newSessionId) {
      skippedSessions += 1;
      errors.push(`会话 ${session.id} 缺少 ID 映射，已跳过。`);
      continue;
    }

    onProgress?.(`正在导入：${session.displayName || session.name || session.id}`);
    try {
      await storage.saveSession(
        normalizeImportedSession({
          ...session,
          id: newSessionId
        })
      );
      importedSessions += 1;
    } catch (e) {
      skippedSessions += 1;
      errors.push(`导入会话 ${session.id} 失败：${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const sessionParts = manifest.parts.filter((part) => part.sessionId === session.id);
    for (const part of sessionParts) {
      const newPartId = partMap.get(part.id);
      if (!newPartId) continue;
      await storage.savePart({
        ...part,
        id: newPartId,
        sessionId: newSessionId
      });
    }

    const sessionChunks = manifest.chunks.filter((chunk) => chunk.sessionId === session.id);
    for (const chunk of sessionChunks) {
      const newChunkId = chunkMap.get(chunk.id);
      const newPartId = partMap.get(chunk.partId);
      if (!newChunkId || !newPartId) continue;
      const blobBytes = entries.get(chunk.blobPath);
      if (!blobBytes) {
        errors.push(`缺少分片数据：${chunk.blobPath}`);
        continue;
      }
      await storage.saveChunk({
        id: newChunkId,
        sessionId: newSessionId,
        partId: newPartId,
        trackId: chunk.trackId,
        index: chunk.index,
        startedAt: chunk.startedAt,
        endedAt: chunk.endedAt,
        durationMs: chunk.durationMs,
        size: chunk.size,
        mimeType: chunk.mimeType,
        blob: new Blob([new Uint8Array(blobBytes)], { type: chunk.mimeType })
      });
    }

    const sessionMp3 = manifest.mp3Files.filter((mp3) => mp3.sessionId === session.id);
    for (const mp3 of sessionMp3) {
      const newMp3Id = mp3Map.get(mp3.id);
      if (!newMp3Id) continue;
      const blobBytes = entries.get(mp3.blobPath);
      if (!blobBytes) {
        errors.push(`缺少 MP3 数据：${mp3.blobPath}`);
        continue;
      }
      await storage.saveMp3({
        id: newMp3Id,
        sessionId: newSessionId,
        fileName: mp3.fileName,
        mimeType: mp3.mimeType,
        size: mp3.size,
        createdAt: mp3.createdAt,
        blob: new Blob([new Uint8Array(blobBytes)], { type: mp3.mimeType })
      });
    }

    await finalizeImportedSession(newSessionId);
  }

  return { importedSessions, skippedSessions, errors };
}
