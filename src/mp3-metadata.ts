/**
 * Post-process lamejs CBR MP3 output so players can seek and show duration.
 * lamejs Mp3Encoder disables VBR/Info tags (bWriteVbrTag=false).
 */

const BITRATE_MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATE_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLERATE_MPEG1 = [44100, 48000, 32000];
const SAMPLERATE_MPEG2 = [22050, 24000, 16000];
const SAMPLERATE_MPEG25 = [11025, 12000, 8000];

const FRAMES_FLAG = 1;
const BYTES_FLAG = 2;
const TOC_FLAG = 4;
const VBR_SCALE_FLAG = 8;

export type Mp3FrameInfo = {
  offset: number;
  frameLength: number;
  sideInfoLen: number;
  mpegVersion: 1 | 2 | 25;
  channelMode: number;
  bitrateKbps: number;
  sampleRate: number;
};

function writeUint32BE(out: Uint8Array, offset: number, value: number) {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function syncSafeSize(n: number): [number, number, number, number] {
  return [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
}

function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function utf16leBytesWithBom(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = (code >>> 8) & 0xff;
  }
  return out;
}

function buildId3Frame(frameId: string, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(10 + payload.length);
  frame[0] = frameId.charCodeAt(0);
  frame[1] = frameId.charCodeAt(1);
  frame[2] = frameId.charCodeAt(2);
  frame[3] = frameId.charCodeAt(3);
  const size = payload.length;
  frame[4] = (size >>> 24) & 0xff;
  frame[5] = (size >>> 16) & 0xff;
  frame[6] = (size >>> 8) & 0xff;
  frame[7] = size & 0xff;
  frame.set(payload, 10);
  return frame;
}

function buildId3Latin1Frame(frameId: string, text: string): Uint8Array {
  const payload = new Uint8Array(1 + text.length);
  payload[0] = 0;
  payload.set(latin1Bytes(text), 1);
  return buildId3Frame(frameId, payload);
}

function buildId3Utf16Frame(frameId: string, text: string): Uint8Array {
  const encoded = utf16leBytesWithBom(text);
  const payload = new Uint8Array(1 + encoded.length);
  payload[0] = 1;
  payload.set(encoded, 1);
  return buildId3Frame(frameId, payload);
}

/** Build ID3v2.3 tag with TLEN (duration ms) and optional TIT2. */
export function buildId3v2Tag(options: { durationMs: number; title?: string }): Uint8Array {
  const frames: Uint8Array[] = [buildId3Latin1Frame("TLEN", String(Math.max(0, Math.round(options.durationMs))))];
  if (options.title != null && options.title !== "") frames.push(buildId3Utf16Frame("TIT2", options.title));
  const bodySize = frames.reduce((n, f) => n + f.length, 0);
  const tag = new Uint8Array(10 + bodySize);
  tag[0] = 0x49; // ID3
  tag[1] = 0x44;
  tag[2] = 0x33;
  tag[3] = 3; // v2.3
  tag[4] = 0;
  tag[5] = 0;
  const [a, b, c, d] = syncSafeSize(bodySize);
  tag[6] = a;
  tag[7] = b;
  tag[8] = c;
  tag[9] = d;
  let off = 10;
  for (const f of frames) {
    tag.set(f, off);
    off += f.length;
  }
  return tag;
}

export function skipId3v2(data: Uint8Array): number {
  if (data.length < 10) return 0;
  if (data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) return 0;
  const size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f);
  return 10 + size;
}

export function parseMp3FrameHeader(data: Uint8Array, offset: number): Mp3FrameInfo | null {
  if (offset + 4 > data.length) return null;
  if (data[offset] !== 0xff || (data[offset + 1] & 0xe0) !== 0xe0) return null;

  const verBits = (data[offset + 1] >> 3) & 3;
  const layer = (data[offset + 1] >> 1) & 3;
  if (layer !== 1) return null;

  const bitrateIdx = (data[offset + 2] >> 4) & 0x0f;
  const srIdx = (data[offset + 2] >> 2) & 3;
  const padding = (data[offset + 2] >> 1) & 1;
  const channelMode = (data[offset + 3] >> 6) & 3;
  if (bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) return null;

  let mpegVersion: 1 | 2 | 25;
  let bitrateKbps: number;
  let sampleRate: number;
  let sideInfoLen: number;
  let frameLength: number;

  if (verBits === 3) {
    mpegVersion = 1;
    bitrateKbps = BITRATE_MPEG1[bitrateIdx]!;
    sampleRate = SAMPLERATE_MPEG1[srIdx]!;
    sideInfoLen = channelMode === 3 ? 17 : 32;
    frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding;
  } else {
    mpegVersion = verBits === 2 ? 2 : 25;
    bitrateKbps = BITRATE_MPEG2[bitrateIdx]!;
    sampleRate = (verBits === 2 ? SAMPLERATE_MPEG2 : SAMPLERATE_MPEG25)[srIdx]!;
    sideInfoLen = channelMode === 3 ? 9 : 17;
    frameLength = Math.floor((72 * bitrateKbps * 1000) / sampleRate) + padding;
  }

  if (frameLength <= 0 || offset + frameLength > data.length) return null;

  return {
    offset,
    frameLength,
    sideInfoLen,
    mpegVersion,
    channelMode,
    bitrateKbps,
    sampleRate
  };
}

export function scanMp3Frames(data: Uint8Array, start = 0): { frames: Mp3FrameInfo[]; audioBytes: number } {
  const frames: Mp3FrameInfo[] = [];
  let offset = start;
  let audioBytes = 0;
  let guard = 0;

  while (offset + 4 < data.length && guard++ < 2_000_000) {
    const hdr = parseMp3FrameHeader(data, offset);
    if (!hdr) {
      offset += 1;
      continue;
    }
    frames.push(hdr);
    audioBytes += hdr.frameLength;
    offset += hdr.frameLength;
  }

  return { frames, audioBytes };
}

function infoFrameSize(info: Mp3FrameInfo): number {
  const versionFactor = info.mpegVersion === 1 ? 2 : 1;
  return Math.floor((versionFactor * 72000 * info.bitrateKbps) / info.sampleRate);
}

function writeInfoTagFrame(template: Mp3FrameInfo, frameCount: number, streamBytes: number): Uint8Array {
  const size = infoFrameSize(template);
  const frame = new Uint8Array(size);
  // Copy first 4 bytes from real stream so version/layer/mode/sr match.
  // Caller must set template from first audio frame.
  const verBits = template.mpegVersion === 1 ? 3 : template.mpegVersion === 2 ? 2 : 0;
  frame[0] = 0xff;
  frame[1] = 0xe0 | (verBits << 3) | 0x02; // layer III, no CRC
  // Bitrate + samplerate from template first frame — filled by caller via subarray copy when possible.
  const tagOffset = 4 + template.sideInfoLen;
  frame[tagOffset] = 0x49;
  frame[tagOffset + 1] = 0x6e;
  frame[tagOffset + 2] = 0x66;
  frame[tagOffset + 3] = 0x6f;
  writeUint32BE(frame, tagOffset + 4, FRAMES_FLAG | BYTES_FLAG | TOC_FLAG | VBR_SCALE_FLAG);
  writeUint32BE(frame, tagOffset + 8, frameCount);
  writeUint32BE(frame, tagOffset + 12, streamBytes);
  for (let i = 0; i < 100; i++) {
    frame[tagOffset + 16 + i] = Math.floor((255 * i) / 100) & 0xff;
  }
  return frame;
}

function cloneInfoFrameFromFirst(firstFrameBytes: Uint8Array, info: Mp3FrameInfo, frameCount: number, streamBytes: number): Uint8Array {
  const size = infoFrameSize(info);
  const frame = new Uint8Array(size);
  const copyLen = Math.min(firstFrameBytes.length, size);
  frame.set(firstFrameBytes.subarray(0, copyLen));
  // Clear audio data — keep header + side info, zero the rest.
  const dataStart = 4 + info.sideInfoLen;
  frame.fill(0, dataStart, size);
  const tagOffset = dataStart;
  frame[tagOffset] = 0x49;
  frame[tagOffset + 1] = 0x6e;
  frame[tagOffset + 2] = 0x66;
  frame[tagOffset + 3] = 0x6f;
  writeUint32BE(frame, tagOffset + 4, FRAMES_FLAG | BYTES_FLAG | TOC_FLAG | VBR_SCALE_FLAG);
  writeUint32BE(frame, tagOffset + 8, frameCount);
  writeUint32BE(frame, tagOffset + 12, streamBytes);
  for (let i = 0; i < 100; i++) {
    frame[tagOffset + 16 + i] = Math.floor((255 * i) / 100) & 0xff;
  }
  return frame;
}

function hasInfoOrXingTag(data: Uint8Array, start: number, info: Mp3FrameInfo): boolean {
  const off = start + 4 + info.sideInfoLen;
  if (off + 4 > data.length) return false;
  const tag = String.fromCharCode(data[off]!, data[off + 1]!, data[off + 2]!, data[off + 3]!);
  return tag === "Info" || tag === "Xing";
}

/** True when file already has seek/duration metadata. */
export function mp3HasSeekMetadata(data: Uint8Array): boolean {
  let pos = skipId3v2(data);
  if (pos + 10 > data.length) return false;
  if (data[pos] === 0x49 && data[pos + 1] === 0x44 && data[pos + 2] === 0x33) {
    // ID3 with TLEN is enough for many players.
    const size = ((data[pos + 6] & 0x7f) << 21) | ((data[pos + 7] & 0x7f) << 14) | ((data[pos + 8] & 0x7f) << 7) | (data[pos + 9] & 0x7f);
    const body = data.subarray(pos + 10, pos + 10 + size);
    const bodyText = String.fromCharCode(...body.subarray(0, Math.min(body.length, 64)));
    if (bodyText.includes("TLEN")) return true;
  }
  const hdr = parseMp3FrameHeader(data, pos);
  if (hdr && hasInfoOrXingTag(data, pos, hdr)) return true;
  return false;
}

export type FinalizeMp3Options = {
  durationMs: number;
  title?: string;
};

/**
 * Prepend ID3v2 (TLEN) and a dedicated Info frame so players can seek CBR MP3.
 */
export function finalizeMp3Buffer(rawMp3: Uint8Array, options: FinalizeMp3Options): Uint8Array {
  if (rawMp3.length < 64) return rawMp3;
  if (mp3HasSeekMetadata(rawMp3)) return rawMp3;

  const audioStart = skipId3v2(rawMp3);
  const { frames, audioBytes } = scanMp3Frames(rawMp3, audioStart);
  if (!frames.length || audioBytes <= 0) {
    const id3Only = buildId3v2Tag(options);
    const out = new Uint8Array(id3Only.length + rawMp3.length);
    out.set(id3Only, 0);
    out.set(rawMp3, id3Only.length);
    return out;
  }

  const first = frames[0]!;
  if (hasInfoOrXingTag(rawMp3, first.offset, first)) return rawMp3;

  const id3 = buildId3v2Tag(options);
  const firstFrameBytes = rawMp3.subarray(first.offset, first.offset + first.frameLength);
  const infoFrame = cloneInfoFrameFromFirst(firstFrameBytes, first, frames.length + 1, 0);
  const streamBytes = id3.length + infoFrame.length + audioBytes;
  // Rewrite stream size in Info tag.
  writeUint32BE(infoFrame, 4 + first.sideInfoLen + 12, streamBytes);

  const out = new Uint8Array(streamBytes);
  let w = 0;
  out.set(id3, w);
  w += id3.length;
  out.set(infoFrame, w);
  w += infoFrame.length;
  out.set(rawMp3.subarray(audioStart), w);
  return out;
}

export function finalizeMp3Blob(blob: Blob, options: FinalizeMp3Options): Promise<Blob> {
  return blob.arrayBuffer().then((buf) => {
    const finalized = finalizeMp3Buffer(new Uint8Array(buf), options);
    const copy = new Uint8Array(finalized.byteLength);
    copy.set(finalized);
    return new Blob([copy], { type: "audio/mpeg" });
  });
}

/** @internal test helper */
export const __mp3MetadataTestUtils = {
  writeInfoTagFrame,
  parseMp3FrameHeader,
  scanMp3Frames
};
