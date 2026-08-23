/** MediaRecorder timeslice WebM: first blob has EBML/Tracks, later blobs are Clusters. */

export const WEBM_EBML_ID = [0x1a, 0x45, 0xdf, 0xa3] as const;
export const WEBM_CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75] as const;

/** ~60s of 48 kHz stereo PCM stays well under typical offscreen memory limits. */
export const MAX_DECODE_WINDOW_MS = 60_000;
/** Encoded window cap (~1 min at 96 kbps, less at higher capture rates). */
export const MAX_DECODE_WINDOW_BYTES = 3 * 1024 * 1024;

export type SizedChunk = {
  blob: Blob;
  size: number;
  durationMs: number;
};

export type DecodeWindow = {
  blobs: Blob[];
  size: number;
  durationMs: number;
  startIndex: number;
  endIndex: number;
};

export function findByteIdOffset(bytes: Uint8Array, id: readonly number[]): number {
  if (id.length === 0 || bytes.length < id.length) return -1;
  const first = id[0]!;
  const last = id.length - 1;
  outer: for (let i = 0; i <= bytes.length - id.length; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j <= last; j++) {
      if (bytes[i + j] !== id[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function looksLikeWebm(bytes: Uint8Array): boolean {
  return findByteIdOffset(bytes.subarray(0, Math.min(bytes.length, 16)), WEBM_EBML_ID) === 0;
}

export type WebmInitSplit = {
  init: Uint8Array;
  firstMedia: Uint8Array;
};

/** Bytes before the first Cluster are the initialization segment (EBML + Tracks). */
export function splitWebmInitAndMedia(firstChunk: Uint8Array): WebmInitSplit | null {
  const cluster = findByteIdOffset(firstChunk, WEBM_CLUSTER_ID);
  if (cluster <= 0) return null;
  return {
    init: firstChunk.subarray(0, cluster),
    firstMedia: firstChunk.subarray(cluster)
  };
}

export function findAllClusterOffsets(bytes: Uint8Array): number[] {
  const offsets: number[] = [];
  let from = 0;
  while (from < bytes.length) {
    const rel = findByteIdOffset(bytes.subarray(from), WEBM_CLUSTER_ID);
    if (rel < 0) break;
    const abs = from + rel;
    offsets.push(abs);
    from = abs + WEBM_CLUSTER_ID.length;
  }
  return offsets;
}

/** Split a WebM buffer into Cluster slices that stay under maxBytes (header is not included). */
export function mediaClusterSlices(bytes: Uint8Array, maxBytes = MAX_DECODE_WINDOW_BYTES): Uint8Array[] {
  const starts = findAllClusterOffsets(bytes);
  if (starts.length <= 1) return starts.length === 1 ? [bytes.subarray(starts[0]!)] : [bytes];
  const slices: Uint8Array[] = [];
  let start = starts[0]!;
  for (let i = 1; i < starts.length; i++) {
    const next = starts[i]!;
    if (next - start >= maxBytes && next > start) {
      slices.push(bytes.subarray(start, next));
      start = next;
    }
  }
  slices.push(bytes.subarray(start));
  return slices;
}

export function groupChunksIntoWindows(
  chunks: SizedChunk[],
  limits: { maxBytes?: number; maxDurationMs?: number } = {}
): DecodeWindow[] {
  const maxBytes = limits.maxBytes ?? MAX_DECODE_WINDOW_BYTES;
  const maxDurationMs = limits.maxDurationMs ?? MAX_DECODE_WINDOW_MS;
  const windows: DecodeWindow[] = [];
  let current: DecodeWindow | undefined;

  const flush = () => {
    if (current) windows.push(current);
    current = undefined;
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const wouldBytes = (current?.size ?? 0) + chunk.size;
    const wouldMs = (current?.durationMs ?? 0) + (chunk.durationMs || 0);
    const wouldOverflow =
      current &&
      current.blobs.length > 0 &&
      (wouldBytes > maxBytes || wouldMs > maxDurationMs);

    if (wouldOverflow) flush();
    if (!current) {
      current = {
        blobs: [chunk.blob],
        size: chunk.size,
        durationMs: chunk.durationMs || 0,
        startIndex: i,
        endIndex: i
      };
    } else {
      current.blobs.push(chunk.blob);
      current.size += chunk.size;
      current.durationMs += chunk.durationMs || 0;
      current.endIndex = i;
    }
  }
  flush();
  return windows;
}
