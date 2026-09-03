import { saveDownloadBlob, saveDownloadUrl } from "../download-save";
import { browserDownloadSettingsHint } from "../download-path";
import { buildMp3FileName } from "../filename";
import { finalizeMp3Blob, mp3HasSeekMetadata } from "../mp3-metadata";
import { storage } from "../storage-manager";
import type { Mp3File, Session } from "../types";

export type DownloadTrigger = "auto" | "manual" | "retry";

export type Mp3BlobResult =
  | {
      ok: true;
      blob: Blob;
      filename: string;
      mimeType: string;
      size: number;
      sessionId: string;
      mp3Id: string;
    }
  | {
      ok: false;
      error: { code: string; message: string; details?: string };
    };

export type DownloadResult =
  | { ok: true; downloadId: number; filename: string; method: "chrome.downloads" | "anchor" | "filesystem"; pathLabel?: string }
  | { ok: false; error: { code: string; message: string; details?: string } };

export class DownloadError extends Error {
  code: string;
  details?: string;
  constructor(code: string, message: string, details?: string) {
    super(message);
    this.name = "DownloadError";
    this.code = code;
    this.details = details;
  }
}

const sessionLocks = new Map<string, Promise<DownloadResult>>();
const objectUrlByDownloadId = new Map<number, string>();
const orphanObjectUrls = new Set<string>();
let listenersInstalled = false;

function log(stage: string, data: Record<string, unknown> = {}) {
  console.info("[Mp3Download]", { stage, ...data, timestamp: Date.now() });
}

function hasDownloadsApi(): boolean {
  return Boolean(chrome?.downloads?.download);
}

export async function getMp3BlobForSession(
  sessionId: string,
  options?: { filenameOverride?: string }
): Promise<Mp3BlobResult> {
  try {
    const sessions = await storage.all<Session>("sessions");
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      return { ok: false, error: { code: "SESSION_NOT_FOUND", message: "找不到录音记录" } };
    }

    const file = await storage.getMp3(sessionId);
    if (!file?.blob) {
      return {
        ok: false,
        error: {
          code: "MP3_BLOB_NOT_FOUND",
          message: "找不到已生成的MP3文件，可以重新生成。",
          details: `sessionId=${sessionId}; hasMp3=${session.hasMp3}`
        }
      };
    }

    if (!(file.blob instanceof Blob) || file.blob.size <= 0) {
      return {
        ok: false,
        error: {
          code: "MP3_BLOB_INVALID",
          message: "MP3文件为空或已损坏，请重新生成。",
          details: `size=${file.blob?.size ?? 0}`
        }
      };
    }

    const mimeType = file.mimeType || file.blob.type || "audio/mpeg";
    if (mimeType && !/mpeg|mp3/i.test(mimeType) && file.blob.type && !/mpeg|mp3/i.test(file.blob.type)) {
      return {
        ok: false,
        error: {
          code: "MP3_MIME_INVALID",
          message: "MP3文件类型不正确，请重新生成。",
          details: `mimeType=${mimeType}`
        }
      };
    }

    const storedName = (file.fileName || `${sessionId}.mp3`).endsWith(".mp3")
      ? file.fileName || `${sessionId}.mp3`
      : `${file.fileName || sessionId}.mp3`;
    const override = options?.filenameOverride?.trim();
    const filename =
      override != null && override !== ""
        ? override.endsWith(".mp3")
          ? override
          : buildMp3FileName(override)
        : storedName;

    let blob = file.blob;
    const raw = new Uint8Array(await blob.arrayBuffer());
    if (!mp3HasSeekMetadata(raw)) {
      const durationMs =
        session.durationMs ||
        session.safeDurationMs ||
        (session.endedAt && session.startedAt ? session.endedAt - session.startedAt : 0);
      blob = await finalizeMp3Blob(blob, {
        durationMs,
        title: session.displayName || session.name
      });
      log("mp3_metadata_patched", { sessionId, durationMs, patchedSize: blob.size });
    }

    log("blob_loaded", {
      sessionId,
      mp3Id: file.id,
      actualSize: blob.size,
      expectedSize: file.size,
      mimeType,
      filename
    });

    return {
      ok: true,
      blob,
      filename,
      mimeType: "audio/mpeg",
      size: blob.size,
      sessionId,
      mp3Id: file.id
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: "MP3_READ_FAILED",
        message: "无法读取本地MP3文件，原始录音仍然保留。",
        details: e instanceof Error ? e.message : String(e)
      }
    };
  }
}

/** Re-read after save; used when marking session completed. */
export async function verifyMp3Persisted(sessionId: string): Promise<boolean> {
  const result = await getMp3BlobForSession(sessionId);
  return result.ok && result.size > 64;
}

export async function reconcileSessionMp3Status(
  session: Session,
  livingIds?: ReadonlySet<string>
): Promise<Session> {
  // Only flag missing MP3 when we previously claimed success.
  if (!session.hasMp3) return session;
  // Never resurrect a session that was already deleted from IndexedDB.
  const living =
    livingIds != null ? livingIds.has(session.id) : (await storage.all<Session>("sessions")).some((s) => s.id === session.id);
  if (!living) return session;
  const file = await storage.getMp3(session.id);
  if (!file?.blob || file.blob.size <= 0) {
    session.hasMp3 = false;
    session.mp3Status = "failed";
    session.historyStatus = "mp3_missing";
    session.mp3Error = "MP3文件不存在，但原始录音可能仍然保留。";
    // Keep recording completed — original may still be available.
    if (session.recordingStatus !== "interrupted" && session.recordingStatus !== "error") {
      session.recordingStatus = "completed";
      session.status = "completed";
    }
    if (!session.originalStatus) session.originalStatus = "available";
    await storage.saveSession(session);
  }
  return session;
}

function revokeUrl(url: string) {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
  orphanObjectUrls.delete(url);
}

function registerDownloadObjectUrl(downloadId: number, objectUrl: string) {
  objectUrlByDownloadId.set(downloadId, objectUrl);
  orphanObjectUrls.delete(objectUrl);
}

function releaseDownloadObjectUrl(downloadId: number) {
  const url = objectUrlByDownloadId.get(downloadId);
  if (!url) return;
  objectUrlByDownloadId.delete(downloadId);
  revokeUrl(url);
}

export function installDownloadLifecycleListeners() {
  if (listenersInstalled) return;
  if (!chrome?.downloads?.onChanged) return;
  listenersInstalled = true;
  chrome.downloads.onChanged.addListener((delta) => {
    if (!objectUrlByDownloadId.has(delta.id)) return;
    const state = delta.state?.current;
    if (state === "complete") {
      log("download_completed", { downloadId: delta.id });
      releaseDownloadObjectUrl(delta.id);
      return;
    }
    if (state === "interrupted" || delta.error?.current) {
      log("download_interrupted", {
        downloadId: delta.id,
        error: delta.error?.current,
        state
      });
      releaseDownloadObjectUrl(delta.id);
    }
  });
  // Safety net: revoke orphan URLs after 10 minutes
  setInterval(() => {
    for (const url of [...orphanObjectUrls]) {
      revokeUrl(url);
    }
  }, 10 * 60 * 1000);
}

function fallbackAnchorDownload(objectUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function normalizeDownloadError(e: unknown): { code: string; message: string; details?: string } {
  if (e instanceof DownloadError) {
    return { code: e.code, message: e.message, details: e.details };
  }
  const msg = e instanceof Error ? e.message : String(e);
  const last = chrome.runtime?.lastError?.message;
  if (/permission|downloads/i.test(msg) || /permission|downloads/i.test(last || "")) {
    return { code: "DOWNLOAD_PERMISSION", message: "插件没有下载权限，请重新加载扩展。", details: msg };
  }
  if (/Extension context|chrome\.downloads|not available/i.test(msg)) {
    return { code: "DOWNLOAD_API_UNAVAILABLE", message: "浏览器下载功能不可用，请确认当前页面由扩展打开。", details: msg };
  }
  if (/USER_CANCELED|CANCELED/i.test(msg)) {
    return { code: "DOWNLOAD_CANCELED", message: "下载被取消。", details: msg };
  }
  if (/INTERRUPT|blocked|NETWORK/i.test(msg)) {
    return { code: "DOWNLOAD_INTERRUPTED", message: "下载被中断，请重新尝试。", details: msg };
  }
  return { code: "DOWNLOAD_FAILED", message: msg || "下载失败", details: last };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:audio/mpeg;base64,${btoa(binary)}`;
}

/**
 * Unified MP3 download used by auto-stop, history manual click, and retry.
 */
export async function downloadRecordingMp3(
  sessionId: string,
  trigger: DownloadTrigger,
  options?: { saveAs?: boolean; filenameOverride?: string }
): Promise<DownloadResult> {
  installDownloadLifecycleListeners();

  const existing = sessionLocks.get(sessionId);
  if (existing) {
    log("download_deduped", { sessionId, trigger });
    return existing;
  }

  const run = (async (): Promise<DownloadResult> => {
    try {
      log("button_clicked", { sessionId, trigger });

      const loaded = await getMp3BlobForSession(sessionId, {
        filenameOverride: options?.filenameOverride
      });
      if (!loaded.ok) {
        throw new DownloadError(loaded.error.code, loaded.error.message, loaded.error.details);
      }

      log("metadata_loaded", {
        sessionId,
        blobId: loaded.mp3Id,
        expectedSize: loaded.size,
        filename: loaded.filename,
        trigger
      });

      const saveAs = !!options?.saveAs;
      const saveOpts = { saveAs, requestDirectoryPermission: saveAs || trigger !== "auto" };
      log("download_requested", { sessionId, filename: loaded.filename, trigger, urlKind: "blob" });
      const saved = await saveDownloadBlob(loaded.blob, loaded.filename, saveOpts);
      if (saved.ok) {
        log("download_started", {
          sessionId,
          downloadId: saved.downloadId,
          filename: saved.filename,
          method: saved.method,
          pathLabel: saved.pathLabel
        });
        return {
          ok: true,
          downloadId: saved.downloadId ?? -1,
          filename: saved.filename,
          method: saved.method,
          pathLabel: saved.pathLabel
        };
      }

      if (loaded.size > 0 && loaded.size <= 12 * 1024 * 1024) {
        try {
          const dataUrl = await blobToDataUrl(loaded.blob);
          log("download_requested", { sessionId, filename: loaded.filename, trigger, urlKind: "data" });
          const urlSaved = await saveDownloadUrl(dataUrl, loaded.filename, saveOpts);
          if (urlSaved.ok) {
            log("download_started", {
              sessionId,
              downloadId: urlSaved.downloadId,
              filename: urlSaved.filename,
              method: urlSaved.method,
              urlKind: "data"
            });
            return {
              ok: true,
              downloadId: urlSaved.downloadId ?? -1,
              filename: urlSaved.filename,
              method: urlSaved.method
            };
          }
        } catch (dataErr) {
          log("data_url_download_failed", {
            sessionId,
            error: dataErr instanceof Error ? dataErr.message : String(dataErr)
          });
        }
      }

      throw new DownloadError(saved.error.code, saved.error.message);
    } catch (e) {
      const err = normalizeDownloadError(e);
      log("download_failed", {
        sessionId,
        trigger,
        failureStage: err.code,
        ...err,
        stack: e instanceof Error ? e.stack : undefined
      });
      return { ok: false, error: err };
    } finally {
      sessionLocks.delete(sessionId);
    }
  })();

  sessionLocks.set(sessionId, run);
  return run;
}

export function friendlyDownloadError(code: string, message: string): string {
  switch (code) {
    case "MP3_BLOB_NOT_FOUND":
      return "找不到已生成的MP3文件，可以重新生成。";
    case "MP3_BLOB_INVALID":
      return "MP3文件为空或已损坏，请重新生成。";
    case "DOWNLOAD_PERMISSION":
      return "插件没有下载权限，请重新加载扩展。";
    case "DOWNLOAD_API_UNAVAILABLE":
      return "浏览器下载功能不可用，请确认当前页面由扩展打开。";
    case "DOWNLOAD_FAILED":
    case "DOWNLOAD_PROXY_FAILED":
    case "SILENT_DOWNLOAD_UNAVAILABLE":
      return browserDownloadSettingsHint();
    case "DOWNLOAD_INTERRUPTED":
      return "下载被中断，请重新尝试。";
    case "MP3_READ_FAILED":
      return "无法读取本地MP3文件，原始录音仍然保留。";
    default:
      return message;
  }
}

/** Exported for tests */
export const __downloadTestUtils = {
  sessionLocks,
  objectUrlByDownloadId,
  registerDownloadObjectUrl,
  releaseDownloadObjectUrl,
  normalizeDownloadError,
  hasDownloadsApi
};

export type { Mp3File };
