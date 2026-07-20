import { buildMp3FileName } from "./filename";
import { resolveBitrate } from "./bitrate-presets";
import { downloadRecordingMp3, verifyMp3Persisted } from "./download/mp3-download-service";
import {
  assemblePartWebm,
  downloadOriginalRecording,
  partsForSession
} from "./download/original-download-service";
import { mixToMono, shouldExportMono, toMp3Kbps } from "./mp3-params";
import { storage } from "./storage-manager";
import { id, type Mp3File, type Session } from "./types";

/** Soft cap per assembled WebM part before decode attempt (still try; fail gracefully). */
const WARN_DECODE_BYTES = 60 * 1024 * 1024;
/** PCM slice for streaming encode (~30s at 48kHz mono samples). */
const PCM_SLICE_SAMPLES = 48_000 * 30;
const encodingSessions = new Set<string>();

export type Mp3Stage =
  | "read_session"
  | "read_parts"
  | "read_chunks"
  | "assemble_webm"
  | "decode_webm"
  | "channel_prepare"
  | "init_worker"
  | "encode_mp3"
  | "validate_mp3"
  | "save_mp3"
  | "done";

export class Mp3ConversionError extends Error {
  stage: Mp3Stage;
  code: string;
  details: Record<string, unknown>;
  constructor(stage: Mp3Stage, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "Mp3ConversionError";
    this.stage = stage;
    this.code = code;
    this.details = details;
  }
}

function workerUrl() {
  return chrome.runtime.getURL("mp3-worker.js");
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

function userFacingMp3Error(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const stage = e instanceof Mp3ConversionError ? e.stage : "";
  const code = e instanceof Mp3ConversionError ? e.code : "";
  if (/未加载|lamejs|Worker|importScripts/i.test(msg) || code === "WORKER_LOAD_FAILED") {
    return "MP3编码组件加载失败，原始录音仍然安全保存，可以重新生成。";
  }
  if (/decode|解码|EncodingError|Unable to decode/i.test(msg) || stage === "decode_webm") {
    return "无法解码部分原始录音，原始数据仍然保留，可以下载原始文件或重新尝试。";
  }
  if (/16 kbps|比特率|bitrate|kbps/i.test(msg) || code === "BITRATE_INCOMPATIBLE") {
    return "当前音频格式无法直接生成 16 kbps MP3，可使用兼容模式（单声道）或改用 32 kbps。";
  }
  if (/内存|memory|allocation|OOM|Array buffer/i.test(msg)) {
    return "生成MP3时内存不足（长录音请使用已下载的原始录音），原始录音仍然安全保存。";
  }
  if (/Chunk|数据不完整|没有可转换|TOO_LARGE/i.test(msg) || code === "TOO_LARGE") {
    return "录音过长，无法一次性转换为MP3。原始录音已保留，请下载原始文件。";
  }
  if (/Worker|后台/i.test(msg)) {
    return "MP3后台处理组件发生错误，可以重新加载插件后再次生成。";
  }
  return `生成MP3失败：${msg}。原始录音仍然安全保存，可以重新生成或下载原始录音。`;
}

async function updateMp3Progress(
  session: Session,
  status: Session["mp3Status"],
  progress?: number,
  label?: string
) {
  session.mp3Status = status;
  if (progress != null) session.mp3Progress = progress;
  if (label != null) session.mp3ProgressLabel = label;
  if (status === "decoding" || status === "encoding" || status === "validating" || status === "queued") {
    session.historyStatus = "processing_mp3";
  }
  await storage.saveSession(session);
}

/** Stream PCM slices into a persistent lamejs worker session. */
async function encodeMp3Streaming(
  left: Float32Array,
  right: Float32Array | undefined,
  sampleRate: number,
  channels: number,
  bitrateBps: number,
  onSlice?: (doneSamples: number, totalSamples: number) => void
): Promise<{ blob: Blob; kbps: number; channels: number }> {
  let worker: Worker;
  try {
    worker = new Worker(workerUrl());
  } catch (e) {
    throw new Mp3ConversionError("init_worker", "WORKER_LOAD_FAILED", "无法创建 MP3 Worker", {
      error: e instanceof Error ? e.message : String(e)
    });
  }

  const requestId = id();

  const nextMessage = () =>
    new Promise<{
      ok: boolean;
      mp3?: ArrayBuffer;
      error?: string;
      stage?: string;
      kbps?: number;
      channels?: number;
    }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MP3转换超时")), 30 * 60 * 1000);
      const onMsg = (ev: MessageEvent) => {
        const data = ev.data as {
          requestId: string;
          ok: boolean;
          mp3?: ArrayBuffer;
          error?: string;
          stage?: string;
          kbps?: number;
          channels?: number;
        };
        if (data.requestId !== requestId) return;
        clearTimeout(timer);
        worker.removeEventListener("message", onMsg);
        resolve(data);
      };
      worker.addEventListener("message", onMsg);
      worker.onerror = (e) => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMsg);
        reject(
          new Mp3ConversionError("init_worker", "WORKER_LOAD_FAILED", e.message || "Worker 错误", {
            filename: e.filename,
            lineno: e.lineno
          })
        );
      };
    });

  try {
    worker.postMessage({
      type: "start",
      requestId,
      sampleRate,
      channels,
      bitrate: bitrateBps
    });
    const started = await nextMessage();
    if (!started.ok) {
      throw new Mp3ConversionError("init_worker", "WORKER_LOAD_FAILED", started.error || "编码器启动失败");
    }

    const total = left.length;
    for (let i = 0; i < total; i += PCM_SLICE_SAMPLES) {
      const end = Math.min(i + PCM_SLICE_SAMPLES, total);
      const leftSlice = left.slice(i, end);
      const rightSlice = right ? right.slice(i, end) : undefined;
      const transfer: Transferable[] = [leftSlice.buffer];
      if (rightSlice) transfer.push(rightSlice.buffer);
      const pending = nextMessage();
      worker.postMessage({ type: "pcm", requestId, left: leftSlice, right: rightSlice }, transfer);
      const ack = await pending;
      if (!ack.ok) {
        throw new Mp3ConversionError("encode_mp3", "ENCODE_FAILED", ack.error || "PCM 编码失败", {
          workerStage: ack.stage
        });
      }
      onSlice?.(end, total);
    }

    const pendingFinish = nextMessage();
    worker.postMessage({ type: "finish", requestId });
    const result = await pendingFinish;
    if (!result.ok || !result.mp3) {
      throw new Mp3ConversionError("encode_mp3", "ENCODE_FAILED", result.error || "MP3 无输出", {
        workerStage: result.stage
      });
    }
    return {
      blob: new Blob([result.mp3], { type: "audio/mpeg" }),
      kbps: result.kbps || toMp3Kbps(bitrateBps),
      channels: result.channels || channels
    };
  } finally {
    worker.terminate();
  }
}

async function decodeWebmToBuffer(blob: Blob): Promise<AudioBuffer> {
  const ac = new AudioContext();
  try {
    const raw = await blob.arrayBuffer();
    return await ac.decodeAudioData(raw.slice(0));
  } catch (e) {
    throw new Mp3ConversionError("decode_webm", "DECODE_FAILED", e instanceof Error ? e.message : String(e), {
      mimeType: blob.type,
      size: blob.size
    });
  } finally {
    await ac.close().catch(() => undefined);
  }
}

async function uniqueFileName(displayName: string | undefined, startedAt: number): Promise<string> {
  const existing = await storage.all<Session>("sessions");
  const names = new Set(existing.map((s) => s.mp3FileName).filter(Boolean) as string[]);
  let n = 0;
  while (n < 100) {
    const tryName = n === 0 ? buildMp3FileName(displayName, startedAt) : buildMp3FileName(displayName, startedAt, n + 1);
    if (!names.has(tryName)) return tryName;
    n += 1;
  }
  return buildMp3FileName(displayName, startedAt, Date.now() % 10000);
}

function looksLikeMp3(blob: Blob): boolean {
  return blob.size > 64 && (blob.type === "audio/mpeg" || blob.type === "audio/mp3" || !blob.type);
}

/**
 * Background MP3 conversion. Does not change recordingStatus.
 * On failure, keeps recording completed + original available.
 */
export async function convertSessionToMp3(
  sessionId: string,
  onProgress?: (msg: string) => void,
  options?: { forceMono?: boolean; overrideBitrate?: number }
): Promise<Mp3File> {
  if (encodingSessions.has(sessionId)) {
    throw new Mp3ConversionError("read_session", "BUSY", "该录音正在生成 MP3，请稍候");
  }
  encodingSessions.add(sessionId);
  let stage: Mp3Stage = "read_session";
  const sessions = await storage.all<Session>("sessions");
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    encodingSessions.delete(sessionId);
    throw new Mp3ConversionError("read_session", "NOT_FOUND", "找不到录音记录");
  }

  // Never flip recordingStatus away from completed for MP3 work.
  if (session.recordingStatus !== "interrupted" && session.recordingStatus !== "error") {
    session.recordingStatus = session.recordingStatus || "completed";
    if (session.status === "exporting" || session.status === "recording") {
      session.status = "completed";
    }
  }
  session.mp3Error = undefined;
  session.hasMp3 = false;
  await updateMp3Progress(session, "queued", 0, "MP3等待生成");
  onProgress?.("正在整理录音数据…");

  const logBase: Record<string, unknown> = {
    sessionId,
    bitrate: session.bitrate,
    library: "lamejs",
    libraryVersion: "1.2.1 (streaming worker)"
  };

  const mp3Parts: Blob[] = [];
  let sampleRate = 48000;
  let outChannels = 1;
  let totalDurationMs = session.durationMs || session.safeDurationMs || 0;
  let processedMs = 0;

  try {
    stage = "read_parts";
    const parts = await partsForSession(sessionId);
    logBase.partCount = parts.length;
    if (!parts.length) throw new Mp3ConversionError("read_parts", "NO_PARTS", "没有可转换的录音分段");

    const targetBitrate = resolveBitrate(options?.overrideBitrate ?? session.bitrate);
    const forceMono = options?.forceMono || shouldExportMono(targetBitrate);

    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi]!;
      stage = "read_chunks";
      await updateMp3Progress(
        session,
        "decoding",
        Math.round((pi / parts.length) * 40),
        `正在解码分段 ${pi + 1}/${parts.length}`
      );
      onProgress?.(`正在解码音频分段 ${pi + 1}/${parts.length}…`);

      const assembled = await assemblePartWebm(part);
      if (!assembled || assembled.size <= 0) continue;

      if (assembled.size > WARN_DECODE_BYTES) {
        console.warn("[MP3] large part", { partId: part.id, size: assembled.size });
      }

      stage = "decode_webm";
      let buffer: AudioBuffer;
      try {
        buffer = await decodeWebmToBuffer(assembled.blob);
      } catch (e) {
        // Skip damaged part; continue others.
        console.error("[MP3] part decode failed, skipping", part.id, e);
        continue;
      }

      sampleRate = buffer.sampleRate;
      stage = "channel_prepare";
      let left = new Float32Array(buffer.getChannelData(0));
      let right =
        buffer.numberOfChannels > 1 ? new Float32Array(buffer.getChannelData(1)) : undefined;
      // Release AudioBuffer references ASAP
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (buffer as any) = null;

      outChannels = right ? 2 : 1;
      if (forceMono) {
        left = new Float32Array(mixToMono(left, right));
        right = undefined;
        outChannels = 1;
      }

      const partDurationMs = (left.length / sampleRate) * 1000;
      stage = "encode_mp3";
      await updateMp3Progress(
        session,
        "encoding",
        Math.round(40 + (pi / parts.length) * 50),
        `正在生成MP3：已处理${fmtDur(processedMs)} / ${fmtDur(totalDurationMs || processedMs + partDurationMs)}`
      );
      onProgress?.("正在生成 MP3…");

      const encoded = await encodeMp3Streaming(
        left,
        right,
        sampleRate,
        outChannels,
        targetBitrate,
        (done, total) => {
          const sliceMs = (done / sampleRate) * 1000;
          void updateMp3Progress(
            session,
            "encoding",
            Math.min(95, Math.round(40 + ((pi + done / total) / parts.length) * 50)),
            `正在生成MP3：已处理${fmtDur(processedMs + sliceMs)} / ${fmtDur(totalDurationMs || processedMs + partDurationMs)}`
          );
        }
      );
      mp3Parts.push(encoded.blob);
      processedMs += partDurationMs;
      // Drop PCM
      left = new Float32Array(0);
      right = undefined;
    }

    if (!mp3Parts.length) {
      throw new Mp3ConversionError("assemble_webm", "NO_AUDIO", "没有可转换的录音数据");
    }

    stage = "validate_mp3";
    await updateMp3Progress(session, "validating", 96, "正在校验 MP3…");
    const blob = mp3Parts.length === 1 ? mp3Parts[0]! : new Blob(mp3Parts, { type: "audio/mpeg" });
    if (!looksLikeMp3(blob) || blob.size < 64) {
      throw new Mp3ConversionError("validate_mp3", "INVALID_OUTPUT", "生成的 MP3 无效或过小");
    }

    stage = "save_mp3";
    session.bitrate = targetBitrate;
    const fileName = await uniqueFileName(session.displayName || session.name, session.startedAt);
    const file: Mp3File = {
      id: id(),
      sessionId,
      fileName,
      mimeType: "audio/mpeg",
      size: blob.size,
      createdAt: Date.now(),
      blob
    };
    await storage.saveMp3(file);
    const persisted = await verifyMp3Persisted(sessionId);
    if (!persisted) {
      throw new Mp3ConversionError("save_mp3", "PERSIST_FAILED", "MP3 已生成但未能写入本地存储");
    }
    session.hasMp3 = true;
    session.mp3FileName = fileName;
    session.fileSize = blob.size;
    session.mp3MimeType = "audio/mpeg";
    session.mp3Error = undefined;
    session.mp3Status = "completed";
    session.mp3Progress = 100;
    session.mp3ProgressLabel = "MP3已完成";
    session.historyStatus = "completed";
    // Keep recordingStatus completed
    if (session.recordingStatus !== "interrupted") {
      session.recordingStatus = "completed";
      session.status = "completed";
    }
    session.durationMs = session.endedAt ? session.endedAt - session.startedAt : session.safeDurationMs;
    await storage.saveSession(session);
    stage = "done";
    onProgress?.("MP3 已生成");
    console.info("[MP3] success", { ...logBase, mp3Bytes: blob.size });
    return file;
  } catch (e) {
    const friendly = userFacingMp3Error(e);
    session.hasMp3 = false;
    session.mp3Error = friendly;
    session.mp3Status = "failed";
    session.mp3ProgressLabel = "MP3生成失败";
    session.historyStatus = "mp3_failed";
    // CRITICAL: do not mark whole recording as failed
    if (session.recordingStatus !== "interrupted" && session.recordingStatus !== "error") {
      session.recordingStatus = "completed";
      session.status = "completed";
    }
    if (!session.originalStatus || session.originalStatus === "pending") {
      session.originalStatus = "available";
    }
    await storage.saveSession(session);
    console.error("[MP3] failed", {
      ...logBase,
      stage: e instanceof Mp3ConversionError ? e.stage : stage,
      code: e instanceof Mp3ConversionError ? e.code : "UNKNOWN",
      message: e instanceof Error ? e.message : String(e),
      details: e instanceof Mp3ConversionError ? e.details : undefined
    });
    const err = e instanceof Mp3ConversionError ? e : new Mp3ConversionError(stage, "UNKNOWN", friendly);
    err.message = friendly;
    throw err;
  } finally {
    encodingSessions.delete(sessionId);
  }
}

/** Queue MP3 without blocking the caller. Returns immediately. */
export function queueMp3GenerationInBackground(
  sessionId: string,
  options?: {
    autoDownloadMp3?: boolean;
    forceMono?: boolean;
    overrideBitrate?: number;
    onProgress?: (msg: string) => void;
  }
): void {
  void (async () => {
    try {
      const sessions = await storage.all<Session>("sessions");
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        session.mp3Status = "queued";
        session.historyStatus = "processing_mp3";
        await storage.saveSession(session);
      }
      await convertSessionToMp3(sessionId, options?.onProgress, {
        forceMono: options?.forceMono,
        overrideBitrate: options?.overrideBitrate
      });
      if (options?.autoDownloadMp3) {
        try {
          await downloadMp3(sessionId, false, "auto");
        } catch (e) {
          console.error("[download mp3 auto]", e);
        }
      }
    } catch (e) {
      console.error("[mp3 background]", e);
    }
  })();
}

export async function downloadMp3(sessionId: string, saveAs = false, trigger: "auto" | "manual" | "retry" = "manual") {
  const result = await downloadRecordingMp3(sessionId, trigger, { saveAs });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result;
}

export async function downloadRecoverableWebm(sessionId: string) {
  const result = await downloadOriginalRecording(sessionId, { saveAs: true, trigger: "manual" });
  if (!result.ok) throw new Error(result.error?.message || "下载原始录音失败");
  return result;
}

export async function exportSession(sessionId: string) {
  const file = await convertSessionToMp3(sessionId);
  await downloadMp3(sessionId, false, "manual");
  return file;
}

export function isMp3Encoding(sessionId: string) {
  return encodingSessions.has(sessionId);
}

export { downloadOriginalRecording, partsForSession, assemblePartWebm };
