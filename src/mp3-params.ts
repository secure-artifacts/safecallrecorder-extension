export function toMp3Kbps(audioBitsPerSecond: number): number {
  const kbps = Math.round(audioBitsPerSecond / 1000);
  if (!Number.isFinite(kbps) || kbps < 8 || kbps > 320) {
    throw new Error(`不支持的 MP3 比特率参数：${audioBitsPerSecond} bps`);
  }
  return kbps;
}

/** 16 kbps is voice-oriented; force mono for compatibility and intelligibility. */
export function shouldExportMono(audioBitsPerSecond: number): boolean {
  return toMp3Kbps(audioBitsPerSecond) <= 16;
}

export function mixToMono(left: Float32Array, right?: Float32Array): Float32Array {
  if (!right) return left;
  const n = Math.min(left.length, right.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = (left[i]! + right[i]!) * 0.5;
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return out;
}
