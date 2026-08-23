/**
 * MediaRecorder WebM has no Duration / Cues, so players show no total time or seek bar.
 * Rewrite Info.Duration and append Cues from Cluster timestamps.
 */

const ID_EBML = [0x1a, 0x45, 0xdf, 0xa3];
const ID_SEGMENT = [0x18, 0x53, 0x80, 0x67];
const ID_SEEK_HEAD = [0x11, 0x4d, 0x9b, 0x74];
const ID_INFO = [0x15, 0x49, 0xa9, 0x66];
const ID_TIMESTAMP_SCALE = [0x2a, 0xd7, 0xb1];
const ID_DURATION = [0x44, 0x89];
const ID_TRACKS = [0x16, 0x54, 0xae, 0x6b];
const ID_CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const ID_TIMECODE = [0xe7];
const ID_CUES = [0x1c, 0x53, 0xbb, 0x6b];
const ID_CUE_POINT = [0xbb];
const ID_CUE_TIME = [0xb3];
const ID_CUE_TRACK_POSITIONS = [0xb7];
const ID_CUE_TRACK = [0xf7];
const ID_CUE_CLUSTER_POSITION = [0xf1];
const ID_VOID = [0xec];

const DEFAULT_TIMESTAMP_SCALE = 1_000_000;

type EbmlEl = {
  id: Uint8Array;
  idOffset: number;
  dataOffset: number;
  dataSize: number;
  end: number;
  unknownSize: boolean;
};

function idsEqual(id: Uint8Array, want: number[]): boolean {
  if (id.length !== want.length) return false;
  for (let i = 0; i < want.length; i++) if (id[i] !== want[i]) return false;
  return true;
}

function vintLength(first: number): number {
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }
  return length > 8 ? 0 : length;
}

function readVint(data: Uint8Array, offset: number): { value: number; length: number; unknown: boolean } | null {
  if (offset >= data.length) return null;
  const first = data[offset]!;
  const length = vintLength(first);
  if (!length || offset + length > data.length) return null;
  const mask = 1 << (8 - length);
  let value = first & (mask - 1);
  let unknown = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) {
    const b = data[offset + i]!;
    value = value * 256 + b;
    if (b !== 0xff) unknown = false;
  }
  return { value, length, unknown };
}

function writeVint(value: number): Uint8Array {
  const n = Math.max(0, Math.floor(value));
  let length = 1;
  while (length < 8 && n >= 2 ** (7 * length) - 1) length += 1;
  const out = new Uint8Array(length);
  let v = n;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  out[0] = (out[0]! & ((1 << (8 - length)) - 1)) | (1 << (8 - length));
  return out;
}

function writeUint(value: number): Uint8Array {
  const n = Math.max(0, Math.floor(value));
  if (n === 0) return new Uint8Array([0]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array(bytes);
}

function writeFloat64(value: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false);
  return new Uint8Array(buf);
}

function encodeElement(id: number[], body: Uint8Array): Uint8Array {
  const size = writeVint(body.length);
  const out = new Uint8Array(id.length + size.length + body.length);
  out.set(id, 0);
  out.set(size, id.length);
  out.set(body, id.length + size.length);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function parseElement(data: Uint8Array, offset: number, limit: number): EbmlEl | null {
  if (offset >= limit) return null;
  const idLen = vintLength(data[offset]!);
  if (!idLen || offset + idLen >= limit) return null;
  const id = data.subarray(offset, offset + idLen);
  const size = readVint(data, offset + idLen);
  if (!size) return null;
  const dataOffset = offset + idLen + size.length;
  if (size.unknown) {
    return { id, idOffset: offset, dataOffset, dataSize: limit - dataOffset, end: limit, unknownSize: true };
  }
  const end = Math.min(limit, dataOffset + size.value);
  return { id, idOffset: offset, dataOffset, dataSize: size.value, end, unknownSize: false };
}

function parseChildren(data: Uint8Array, start: number, end: number): EbmlEl[] {
  const out: EbmlEl[] = [];
  let offset = start;
  while (offset < end) {
    const el = parseElement(data, offset, end);
    if (!el) break;
    out.push(el);
    offset = el.end;
    if (el.unknownSize) break;
  }
  return out;
}

function readUintData(data: Uint8Array, start: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + data[start + i]!;
  return value;
}

function readDurationValue(data: Uint8Array, start: number, size: number): number {
  if (size === 4) return new DataView(data.buffer, data.byteOffset + start, 4).getFloat32(0, false);
  if (size === 8) return new DataView(data.buffer, data.byteOffset + start, 8).getFloat64(0, false);
  return readUintData(data, start, size);
}

function sliceEl(data: Uint8Array, el: EbmlEl): Uint8Array {
  return data.subarray(el.idOffset, el.end);
}

function findTopLevel(data: Uint8Array): { ebml?: EbmlEl; segment?: EbmlEl } {
  const kids = parseChildren(data, 0, data.length);
  return {
    ebml: kids.find((el) => idsEqual(el.id, ID_EBML)),
    segment: kids.find((el) => idsEqual(el.id, ID_SEGMENT))
  };
}

export function webmHasSeekMetadata(data: Uint8Array): boolean {
  const { segment } = findTopLevel(data);
  if (!segment) return false;
  const kids = parseChildren(data, segment.dataOffset, segment.end);
  const info = kids.find((el) => idsEqual(el.id, ID_INFO));
  const cues = kids.find((el) => idsEqual(el.id, ID_CUES));
  if (!info || !cues) return false;
  return parseChildren(data, info.dataOffset, info.end).some((el) => idsEqual(el.id, ID_DURATION));
}

export function inferWebmDurationMs(data: Uint8Array): number {
  const parsed = inspectWebm(data);
  if (!parsed) return 0;
  return ticksToMs(parsed.durationTicks, parsed.timestampScale);
}

function ticksToMs(ticks: number, scale: number): number {
  return Math.max(0, (ticks * scale) / 1_000_000);
}

function msToTicks(ms: number, scale: number): number {
  return Math.max(0, (ms * 1_000_000) / scale);
}

function inspectWebm(data: Uint8Array): {
  ebml?: EbmlEl;
  segment: EbmlEl;
  info?: EbmlEl;
  tracks?: EbmlEl;
  clusters: Array<{ el: EbmlEl; timecode: number }>;
  extras: EbmlEl[];
  timestampScale: number;
  durationTicks: number;
  hasDuration: boolean;
  hasCues: boolean;
} | null {
  const { ebml, segment } = findTopLevel(data);
  if (!segment) return null;
  const kids = parseChildren(data, segment.dataOffset, segment.end);
  const info = kids.find((el) => idsEqual(el.id, ID_INFO));
  const tracks = kids.find((el) => idsEqual(el.id, ID_TRACKS));
  let timestampScale = DEFAULT_TIMESTAMP_SCALE;
  let hasDuration = false;
  let existingDuration = 0;
  if (info) {
    for (const child of parseChildren(data, info.dataOffset, info.end)) {
      if (idsEqual(child.id, ID_TIMESTAMP_SCALE)) {
        timestampScale = readUintData(data, child.dataOffset, child.dataSize) || DEFAULT_TIMESTAMP_SCALE;
      } else if (idsEqual(child.id, ID_DURATION)) {
        hasDuration = true;
        existingDuration = readDurationValue(data, child.dataOffset, child.dataSize);
      }
    }
  }
  const clusters: Array<{ el: EbmlEl; timecode: number }> = [];
  for (const el of kids) {
    if (!idsEqual(el.id, ID_CLUSTER)) continue;
    let timecode = 0;
    for (const child of parseChildren(data, el.dataOffset, el.end)) {
      if (idsEqual(child.id, ID_TIMECODE)) {
        timecode = readUintData(data, child.dataOffset, child.dataSize);
        break;
      }
    }
    clusters.push({ el, timecode });
  }
  let durationTicks = existingDuration;
  if (clusters.length) {
    const last = clusters[clusters.length - 1]!.timecode;
    const prev = clusters.length > 1 ? clusters[clusters.length - 2]!.timecode : 0;
    const gap = clusters.length > 1 ? Math.max(1, last - prev) : 1;
    durationTicks = Math.max(durationTicks, last + gap);
  }
  const extras = kids.filter(
    (el) =>
      !idsEqual(el.id, ID_INFO) &&
      !idsEqual(el.id, ID_TRACKS) &&
      !idsEqual(el.id, ID_CLUSTER) &&
      !idsEqual(el.id, ID_CUES) &&
      !idsEqual(el.id, ID_SEEK_HEAD) &&
      !idsEqual(el.id, ID_VOID)
  );
  return {
    ebml,
    segment,
    info,
    tracks,
    clusters,
    extras,
    timestampScale,
    durationTicks,
    hasDuration,
    hasCues: kids.some((el) => idsEqual(el.id, ID_CUES))
  };
}

function rebuildInfo(data: Uint8Array, info: EbmlEl | undefined, timestampScale: number, durationTicks: number): Uint8Array {
  const kept: Uint8Array[] = [encodeElement(ID_TIMESTAMP_SCALE, writeUint(timestampScale))];
  kept.push(encodeElement(ID_DURATION, writeFloat64(durationTicks)));
  if (info) {
    for (const child of parseChildren(data, info.dataOffset, info.end)) {
      if (idsEqual(child.id, ID_TIMESTAMP_SCALE) || idsEqual(child.id, ID_DURATION)) continue;
      kept.push(sliceEl(data, child));
    }
  }
  return encodeElement(ID_INFO, concatBytes(kept));
}

function buildCues(clusters: Array<{ position: number; timecode: number }>): Uint8Array {
  const points = clusters.map((c) => {
    const positions = concatBytes([
      encodeElement(ID_CUE_TRACK, writeUint(1)),
      encodeElement(ID_CUE_CLUSTER_POSITION, writeUint(c.position))
    ]);
    return encodeElement(
      ID_CUE_POINT,
      concatBytes([encodeElement(ID_CUE_TIME, writeUint(c.timecode)), encodeElement(ID_CUE_TRACK_POSITIONS, positions)])
    );
  });
  return encodeElement(ID_CUES, concatBytes(points));
}

export function finalizeWebmDuration(data: Uint8Array, durationMs = 0): Uint8Array {
  if (data.length < 16) return data;
  const parsed = inspectWebm(data);
  if (!parsed || !parsed.clusters.length) return data;
  const hinted = durationMs > 0 ? msToTicks(durationMs, parsed.timestampScale) : 0;
  const durationTicks = Math.max(parsed.durationTicks, hinted);
  if (parsed.hasDuration && parsed.hasCues && hinted <= parsed.durationTicks + 1) return data;

  const infoBytes = rebuildInfo(data, parsed.info, parsed.timestampScale, durationTicks);
  const tracksBytes = parsed.tracks ? sliceEl(data, parsed.tracks) : new Uint8Array(0);
  const extraBytes = parsed.extras.map((el) => sliceEl(data, el));
  const clusterBytes = parsed.clusters.map((c) => sliceEl(data, c.el));

  const beforeClusters = concatBytes([infoBytes, tracksBytes, ...extraBytes]);
  let position = beforeClusters.length;
  const cueClusters = parsed.clusters.map((c, i) => {
    const item = { position, timecode: c.timecode };
    position += clusterBytes[i]!.length;
    return item;
  });
  const cuesBytes = buildCues(cueClusters);
  const payload = concatBytes([beforeClusters, ...clusterBytes, cuesBytes]);
  const segment = encodeElement(ID_SEGMENT, payload);
  const header = parsed.ebml ? sliceEl(data, parsed.ebml) : new Uint8Array();
  return concatBytes([header, segment]);
}

export async function finalizeWebmDurationBlob(blob: Blob, durationMs = 0): Promise<Blob> {
  if (blob.size < 16) return blob;
  const data = new Uint8Array(await blob.arrayBuffer());
  if (data[0] !== 0x1a || data[1] !== 0x45) return blob;
  const fixed = finalizeWebmDuration(data, durationMs);
  if (fixed === data) return blob;
  const copy = new Uint8Array(fixed.byteLength);
  copy.set(fixed);
  return new Blob([copy], { type: blob.type || "audio/webm" });
}

/** @internal */
export const __webmDurationTestUtils = {
  encodeElement,
  writeVint,
  writeUint,
  writeFloat64,
  ID_EBML,
  ID_SEGMENT,
  ID_INFO,
  ID_TIMESTAMP_SCALE,
  ID_DURATION,
  ID_TRACKS,
  ID_CLUSTER,
  ID_TIMECODE,
  ID_CUES
};
