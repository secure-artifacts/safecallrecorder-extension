import { buildMp3FileName } from "./filename";
import { resolveBitrate } from "./bitrate-presets";
import { downloadRecordingMp3, verifyMp3Persisted } from "./download/mp3-download-service";
import {
  assemblePartWebm,
  chunksForPart,
  downloadOriginalRecording,
  partsForSession
} from "./download/original-download-service";
import { mixToMono, shouldExportMono, toMp3Kbps } from "./mp3-params";
import { finalizeMp3Blob } from "./mp3-metadata";
import { getSettings } from "./extension-storage";
import { maybeAutoUploadMp3AfterEncode, uploadSessionMp3ToDrive } from "./google-drive/upload-service";
import { shouldAutoDownloadMp3Locally } from "./google-drive/settings";
import { storage } from "./storage-manager";
import { id, type Chunk, type Mp3File, type Session } from "./types";
import {
  groupChunksIntoWindows,
  looksLikeWebm,
  MAX_DECODE_WINDOW_BYTES,
  MAX_DECODE_WINDOW_MS,
  mediaClusterSlices,
  splitWebmInitAndMedia,
  type DecodeWindow
} from "./webm-decode-windows";

/** PCM slice for streaming encode (~30s at 48kHz mono samples). */
const PCM_SLICE_SAMPLES = 48_000 * 30;

function bytesAsBlobPart(bytes: Uint8Array): BlobPart {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
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
  if (/数据不完整|没有可转换|TOO_LARGE/i.test(msg) || code === "TOO_LARGE") {
    return "无法转换这段录音为MP3。原始录音已保留，请重试生成或下载原始文件。";
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

type Mp3WorkerReply = {
  ok: boolean;
  mp3?: ArrayBuffer;
  mp3Slice?: ArrayBuffer;
  error?: string;
  stage?: string;
  kbps?: number;
  channels?: number;
};

type Mp3WorkerSession = {
  worker: Worker;
  requestId: string;
  nextMessage: () => Promise<Mp3WorkerReply>;
  kbps: number;
  channels: number;
  mp3Parts: BlobPart[];
};

function collectWorkerMp3(session: Mp3WorkerSession, reply: Mp3WorkerReply) {
  if (reply.mp3Slice) session.mp3Parts.push(reply.mp3Slice);
  if (reply.mp3) session.mp3Parts.push(reply.mp3);
}

function createMp3WorkerSession(): Mp3WorkerSession {
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
    new Promise<Mp3WorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MP3转换超时")), 30 * 60 * 1000);
      const onMsg = (ev: MessageEvent) => {
        const data = ev.data as Mp3WorkerReply & { requestId: string };
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

  return { worker, requestId, nextMessage, kbps: 0, channels: 1, mp3Parts: [] };
}

async function startMp3WorkerSession(
  session: Mp3WorkerSession,
  sampleRate: number,
  channels: number,
  bitrateBps: number
) {
  session.worker.postMessage({
    type: "start",
    requestId: session.requestId,
    sampleRate,
    channels,
    bitrate: bitrateBps
  });
  const started = await session.nextMessage();
  if (!started.ok) {
    throw new Mp3ConversionError("init_worker", "WORKER_LOAD_FAILED", started.error || "编码器启动失败");
  }
  session.kbps = toMp3Kbps(bitrateBps);
  session.channels = channels;
}

async function feedMp3WorkerSession(
  session: Mp3WorkerSession,
  left: Float32Array,
  right: Float32Array | undefined,
  onSlice?: (doneSamples: number, totalSamples: number) => void
) {
  const total = left.length;
  for (let i = 0; i < total; i += PCM_SLICE_SAMPLES) {
    const end = Math.min(i + PCM_SLICE_SAMPLES, total);
    const leftSlice = left.slice(i, end);
    const rightSlice = right ? right.slice(i, end) : undefined;
    const transfer: Transferable[] = [leftSlice.buffer];
    if (rightSlice) transfer.push(rightSlice.buffer);
    const pending = session.nextMessage();
    session.worker.postMessage(
      { type: "pcm", requestId: session.requestId, left: leftSlice, right: rightSlice },
      transfer
    );
    const ack = await pending;
    if (!ack.ok) {
      throw new Mp3ConversionError("encode_mp3", "ENCODE_FAILED", ack.error || "PCM 编码失败", {
        workerStage: ack.stage
      });
    }
    collectWorkerMp3(session, ack);
    onSlice?.(end, total);
  }
}

async function finishMp3WorkerSession(session: Mp3WorkerSession): Promise<{ blob: Blob; kbps: number; channels: number }> {
  const pendingFinish = session.nextMessage();
  session.worker.postMessage({ type: "finish", requestId: session.requestId });
  const result = await pendingFinish;
  if (!result.ok) {
    throw new Mp3ConversionError("encode_mp3", "ENCODE_FAILED", result.error || "MP3 无输出", {
      workerStage: result.stage
    });
  }
  collectWorkerMp3(session, result);
  if (!session.mp3Parts.length) {
    throw new Mp3ConversionError("encode_mp3", "ENCODE_FAILED", result.error || "MP3 无输出", {
      workerStage: result.stage
    });
  }
  return {
    blob: new Blob(session.mp3Parts, { type: "audio/mpeg" }),
    kbps: result.kbps || session.kbps,
    channels: result.channels || session.channels
  };
}

/** Stream PCM slices into a persistent lamejs worker session (one part). */
async function encodeMp3Streaming(
  left: Float32Array,
  right: Float32Array | undefined,
  sampleRate: number,
  channels: number,
  bitrateBps: number,
  onSlice?: (doneSamples: number, totalSamples: number) => void
): Promise<{ blob: Blob; kbps: number; channels: number }> {
  const session = createMp3WorkerSession();
  try {
    await startMp3WorkerSession(session, sampleRate, channels, bitrateBps);
    await feedMp3WorkerSession(session, left, right, onSlice);
    return await finishMp3WorkerSession(session);
  } finally {
    session.worker.terminate();
  }
}

class ReusableWebmDecoder {
  private ac?: AudioContext;

  async decode(blob: Blob): Promise<AudioBuffer> {
    this.ac ??= new AudioContext();
    if (this.ac.state === "suspended") await this.ac.resume().catch(() => undefined);
    const raw = await blob.arrayBuffer();
    return this.ac.decodeAudioData(raw.slice(0));
  }

  async close() {
    if (!this.ac) return;
    await this.ac.close().catch(() => undefined);
    this.ac = undefined;
  }
}

async function tryDecodeWebm(decoder: ReusableWebmDecoder, blobs: Blob[]): Promise<AudioBuffer | undefined> {
  try {
    const buffer = await decoder.decode(new Blob(blobs, { type: "audio/webm" }));
    return buffer.length > 0 ? buffer : undefined;
  } catch {
    return undefined;
  }
}

async function decodeWindowRecursive(
  decoder: ReusableWebmDecoder,
  init: Uint8Array | undefined,
  window: DecodeWindow
): Promise<AudioBuffer[]> {
  const usesInit = window.startIndex > 0 && init;
  const primary = usesInit ? [new Blob([bytesAsBlobPart(init)]), ...window.blobs] : window.blobs;
  const decoded = await tryDecodeWebm(decoder, primary);
  if (decoded) return [decoded];

  if (window.blobs.length <= 1) {
    if (usesInit) {
      const again = await tryDecodeWebm(decoder, window.blobs);
      if (again) return [again];
    }
    return [];
  }

  const mid = Math.ceil(window.blobs.length / 2);
  const left: DecodeWindow = {
    blobs: window.blobs.slice(0, mid),
    size: 0,
    durationMs: 0,
    startIndex: window.startIndex,
    endIndex: window.startIndex + mid - 1
  };
  const right: DecodeWindow = {
    blobs: window.blobs.slice(mid),
    size: 0,
    durationMs: 0,
    startIndex: window.startIndex + mid,
    endIndex: window.endIndex
  };
  const out = await decodeWindowRecursive(decoder, init, left);
  out.push(...(await decodeWindowRecursive(decoder, init, right)));
  return out;
}

async function expandOversizedChunks(
  chunks: Chunk[]
): Promise<Array<{ blob: Blob; size: number; durationMs: number }>> {
  const out: Array<{ blob: Blob; size: number; durationMs: number }> = [];
  for (const chunk of chunks) {
    if (chunk.size <= MAX_DECODE_WINDOW_BYTES) {
      out.push(chunk);
      continue;
    }
    const bytes = new Uint8Array(await chunk.blob.arrayBuffer());
    const slices = mediaClusterSlices(bytes, MAX_DECODE_WINDOW_BYTES);
    if (slices.length <= 1) {
      out.push(chunk);
      continue;
    }
    const perMs = Math.round((chunk.durationMs || 0) / slices.length);
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i]!;
      const includeHeader = i === 0 && chunk === chunks[0] && looksLikeWebm(bytes);
      const end = slice.byteOffset - bytes.byteOffset + slice.byteLength;
      const payload = includeHeader ? bytes.subarray(0, end) : slice;
      out.push({
        blob: new Blob([bytesAsBlobPart(payload)], { type: chunk.mimeType }),
        size: payload.byteLength,
        durationMs: perMs
      });
    }
  }
  return out;
}

async function decodeWebmWindows(
  decoder: ReusableWebmDecoder,
  chunks: Chunk[],
  onDecoded: (buffer: AudioBuffer, windowIndex: number, windowCount: number) => Promise<void>
): Promise<number> {
  if (!chunks.length) return 0;
  const firstBytes = new Uint8Array(await chunks[0]!.blob.arrayBuffer());
  const split = looksLikeWebm(firstBytes) ? splitWebmInitAndMedia(firstBytes) : null;
  const init = split?.init.slice() ?? (looksLikeWebm(firstBytes) ? firstBytes.slice() : undefined);
  const expanded = await expandOversizedChunks(chunks);
  const windows = groupChunksIntoWindows(expanded, {
    maxBytes: MAX_DECODE_WINDOW_BYTES,
    maxDurationMs: MAX_DECODE_WINDOW_MS
  });
  let decodedCount = 0;
  for (let i = 0; i < windows.length; i++) {
    const buffers = await decodeWindowRecursive(decoder, init, windows[i]!);
    for (const buffer of buffers) {
      await onDecoded(buffer, i + 1, windows.length);
      decodedCount += 1;
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return decodedCount;
}

async function feedMp3WorkerFromBuffer(
  session: Mp3WorkerSession,
  buffer: AudioBuffer,
  forceMono: boolean,
  onSlice?: (doneSamples: number, totalSamples: number) => void
): Promise<{ sampleRate: number; channels: number; durationMs: number }> {
  const leftSrc = buffer.getChannelData(0);
  const rightSrc = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : undefined;
  const total = leftSrc.length;
  const sampleRate = buffer.sampleRate || 48000;
  for (let i = 0; i < total; i += PCM_SLICE_SAMPLES) {
    const end = Math.min(i + PCM_SLICE_SAMPLES, total);
    const leftSlice = forceMono && rightSrc
      ? mixToMono(leftSrc.subarray(i, end), rightSrc.subarray(i, end))
      : leftSrc.slice(i, end);
    const rightSlice = !forceMono && rightSrc ? rightSrc.slice(i, end) : undefined;
    const transfer: Transferable[] = [leftSlice.buffer];
    if (rightSlice) transfer.push(rightSlice.buffer);
    const pending = session.nextMessage();
    session.worker.postMessage(
      { type: "pcm", requestId: session.requestId, left: leftSlice, right: rightSlice },
      transfer
    );
    const ack = await pending;
    if (!ack.ok) {
      throw new Mp3ConversionError("encode_mp3", "ENCODE_FAILED", ack.error || "PCM 编码失败", {
        workerStage: ack.stage
      });
    }
    collectWorkerMp3(session, ack);
    onSlice?.(end, total);
  }
  const channels = forceMono || !rightSrc ? 1 : 2;
  return { sampleRate, channels, durationMs: (total / sampleRate) * 1000 };
}

async function uniqueFileName(displayName: string | undefined): Promise<string> {
  const existing = await storage.all<Session>("sessions");
  const names = new Set(existing.map((s) => s.mp3FileName).filter(Boolean) as string[]);
  let n = 0;
  while (n < 100) {
    const tryName = buildMp3FileName(displayName, n === 0 ? 0 : n + 1);
    if (!names.has(tryName)) return tryName;
    n += 1;
  }
  return buildMp3FileName(displayName, Date.now() % 10000);
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
  options?: { forceMono?: boolean; overrideBitrate?: number; exportDisplayName?: string }
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

  let sampleRate = 48000;
  let outChannels = 1;
  let totalDurationMs = session.durationMs || session.safeDurationMs || 0;
  let processedMs = 0;
  const encoder = { session: null as Mp3WorkerSession | null, started: false };
  const decoder = new ReusableWebmDecoder();

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

      const chunks = await chunksForPart(part.id);
      if (!chunks.length) continue;

      stage = "decode_webm";
      const decodedWindows = await decodeWebmWindows(
        decoder,
        chunks,
        async (buffer, windowIndex, windowCount) => {
          sampleRate = buffer.sampleRate || sampleRate;
          stage = "channel_prepare";
          outChannels = forceMono || buffer.numberOfChannels < 2 ? 1 : 2;

          if (!encoder.session) {
            stage = "init_worker";
            encoder.session = createMp3WorkerSession();
          }
          if (!encoder.started) {
            await startMp3WorkerSession(encoder.session, sampleRate, outChannels, targetBitrate);
            encoder.started = true;
          } else if (encoder.session.channels !== outChannels) {
            throw new Mp3ConversionError(
              "encode_mp3",
              "CHANNEL_MISMATCH",
              "录音分段声道不一致，无法合并为单个 MP3"
            );
          }

          stage = "encode_mp3";
          const fed = await feedMp3WorkerFromBuffer(
            encoder.session,
            buffer,
            forceMono,
            (done, total) => {
              const sliceMs = (done / sampleRate) * 1000;
              void updateMp3Progress(
                session,
                "encoding",
                Math.min(
                  95,
                  Math.round(40 + ((pi + (windowIndex - 1 + done / total) / windowCount) / parts.length) * 50)
                ),
                `正在生成MP3：已处理${fmtDur(processedMs + sliceMs)} / ${fmtDur(totalDurationMs || processedMs + sliceMs)}`
              );
            }
          );
          processedMs += fed.durationMs;
          onProgress?.(
            `正在生成 MP3… ${fmtDur(processedMs)}${totalDurationMs ? ` / ${fmtDur(totalDurationMs)}` : ""}`
          );
        }
      );
      if (!decodedWindows) {
        console.error("[MP3] part decode produced no windows", part.id, { chunkCount: chunks.length });
      }
    }

    if (!encoder.session || !encoder.started) {
      throw new Mp3ConversionError("assemble_webm", "NO_AUDIO", "没有可转换的录音数据");
    }
    if (totalDurationMs > 90_000 && processedMs < totalDurationMs * 0.5) {
      throw new Mp3ConversionError(
        "decode_webm",
        "INCOMPLETE",
        "部分长录音未能解码，请重试生成MP3。原始录音已保留。"
      );
    }

    stage = "encode_mp3";
    const encoded = await finishMp3WorkerSession(encoder.session);
    encoder.session.worker.terminate();
    encoder.session = null;

    stage = "validate_mp3";
    await updateMp3Progress(session, "validating", 96, "正在校验 MP3…");
    let blob = encoded.blob;
    const durationMs =
      totalDurationMs ||
      processedMs ||
      (session.endedAt && session.startedAt ? session.endedAt - session.startedAt : session.safeDurationMs);
    blob = await finalizeMp3Blob(blob, {
      durationMs: durationMs || 0,
      title: options?.exportDisplayName || session.displayName || session.name
    });
    if (!looksLikeMp3(blob) || blob.size < 64) {
      throw new Mp3ConversionError("validate_mp3", "INVALID_OUTPUT", "生成的 MP3 无效或过小");
    }

    stage = "save_mp3";
    session.bitrate = targetBitrate;
    const exportTitle = options?.exportDisplayName || session.displayName || session.name;
    const fileName = await uniqueFileName(exportTitle);
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
    if (encoder.session) encoder.session.worker.terminate();
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
    await decoder.close();
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
    exportDisplayName?: string;
    uploadToCloud?: boolean;
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
        overrideBitrate: options?.overrideBitrate,
        exportDisplayName: options?.exportDisplayName
      });
      const settings = await getSettings();
      try {
        if (options?.uploadToCloud === true) {
          await uploadSessionMp3ToDrive(sessionId, "auto", {
            filenameOverride: options.exportDisplayName
          });
        } else {
          await maybeAutoUploadMp3AfterEncode(sessionId, {
            filenameOverride: options?.exportDisplayName,
            force: false
          });
        }
      } catch (e) {
        console.error("[google drive auto]", e);
      }
      const wantLocalMp3 =
        options?.autoDownloadMp3 !== false && shouldAutoDownloadMp3Locally(settings);
      if (wantLocalMp3) {
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

export async function downloadMp3(
  sessionId: string,
  saveAs = false,
  trigger: "auto" | "manual" | "retry" = "manual",
  options?: { filenameOverride?: string }
) {
  const result = await downloadRecordingMp3(sessionId, trigger, {
    saveAs,
    filenameOverride: options?.filenameOverride
  });
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

export { downloadOriginalRecording, partsForSession, assemblePartWebm, chunksForPart };
