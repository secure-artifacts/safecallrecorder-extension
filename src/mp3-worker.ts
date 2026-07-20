/// <reference lib="webworker" />
/* global lamejs */

declare const lamejs: {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => {
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
  };
};

type StartMsg = {
  type: "start";
  requestId: string;
  sampleRate: number;
  channels: number;
  bitrate: number;
};

type PcmMsg = {
  type: "pcm";
  requestId: string;
  left: Float32Array;
  right?: Float32Array;
};

type FinishMsg = { type: "finish"; requestId: string };

/** Legacy one-shot encode (still supported). */
type OneshootMsg = {
  requestId: string;
  sampleRate: number;
  channels: number;
  bitrate: number;
  left: Float32Array;
  right?: Float32Array;
};

type InMsg = StartMsg | PcmMsg | FinishMsg | OneshootMsg;

type Session = {
  encoder: InstanceType<typeof lamejs.Mp3Encoder>;
  channels: number;
  kbps: number;
  parts: Int8Array[];
};

const sessions = new Map<string, Session>();

function floatTo16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function toKbps(bps: number): number {
  const kbps = Math.round(bps / 1000);
  if (!Number.isFinite(kbps) || kbps < 8 || kbps > 320) {
    throw new Error(`无效的比特率：${bps} bps → ${kbps} kbps`);
  }
  return kbps;
}

function encodeAll(
  encoder: InstanceType<typeof lamejs.Mp3Encoder>,
  channels: number,
  leftF: Float32Array,
  rightF: Float32Array | undefined,
  parts: Int8Array[]
) {
  const left = floatTo16(leftF);
  const right = channels > 1 ? floatTo16(rightF || leftF) : undefined;
  const block = 1152;
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    const buf =
      channels > 1 && right ? encoder.encodeBuffer(l, right.subarray(i, i + block)) : encoder.encodeBuffer(l);
    if (buf.length) parts.push(buf);
  }
}

function assemble(parts: Int8Array[]): ArrayBuffer {
  const total = parts.reduce((n, p) => n + p.length, 0);
  if (total < 32) throw new Error("MP3 输出过小，可能编码失败");
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  if ((out[0] & 0xff) !== 0xff || (out[1] & 0xe0) !== 0xe0) {
    if (out[0] === 0 && out[1] === 0) throw new Error("MP3 文件头无效");
  }
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

function fail(requestId: string, stage: string, error: unknown) {
  (self as DedicatedWorkerGlobalScope).postMessage({
    requestId,
    ok: false,
    stage,
    error: error instanceof Error ? error.message : String(error)
  });
}

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  const requestId = msg.requestId;
  let stage = "init_encoder";
  try {
    if (typeof lamejs === "undefined" || !lamejs.Mp3Encoder) {
      throw new Error("MP3编码组件未加载（lamejs 不可用）");
    }

    // Streaming protocol
    if ("type" in msg && msg.type === "start") {
      stage = "create_encoder";
      const kbps = toKbps(msg.bitrate);
      const channels = msg.channels >= 2 ? 2 : 1;
      sessions.set(requestId, {
        encoder: new lamejs.Mp3Encoder(channels, msg.sampleRate, kbps),
        channels,
        kbps,
        parts: []
      });
      (self as DedicatedWorkerGlobalScope).postMessage({ requestId, ok: true, stage: "started" });
      return;
    }

    if ("type" in msg && msg.type === "pcm") {
      const s = sessions.get(requestId);
      if (!s) throw new Error("编码器未启动");
      stage = "encode_blocks";
      encodeAll(s.encoder, s.channels, msg.left, msg.right, s.parts);
      (self as DedicatedWorkerGlobalScope).postMessage({
        requestId,
        ok: true,
        stage: "pcm_encoded",
        frames: s.parts.length
      });
      return;
    }

    if ("type" in msg && msg.type === "finish") {
      const s = sessions.get(requestId);
      if (!s) throw new Error("编码器未启动");
      stage = "flush_encoder";
      const end = s.encoder.flush();
      if (end.length) s.parts.push(end);
      stage = "assemble_blob";
      const buffer = assemble(s.parts);
      sessions.delete(requestId);
      (self as DedicatedWorkerGlobalScope).postMessage(
        { requestId, ok: true, mp3: buffer, kbps: s.kbps, channels: s.channels },
        [buffer]
      );
      return;
    }

    // Legacy one-shot
    const one = msg as OneshootMsg;
    stage = "create_encoder";
    const kbps = toKbps(one.bitrate);
    const channels = one.channels >= 2 ? 2 : 1;
    const encoder = new lamejs.Mp3Encoder(channels, one.sampleRate, kbps);
    const parts: Int8Array[] = [];
    stage = "encode_blocks";
    encodeAll(encoder, channels, one.left, one.right, parts);
    stage = "flush_encoder";
    const end = encoder.flush();
    if (end.length) parts.push(end);
    stage = "assemble_blob";
    const buffer = assemble(parts);
    (self as DedicatedWorkerGlobalScope).postMessage(
      { requestId, ok: true, mp3: buffer, kbps, channels },
      [buffer]
    );
  } catch (e) {
    sessions.delete(requestId);
    fail(requestId, stage, e);
  }
};
