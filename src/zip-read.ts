/** Parse store-only ZIP files produced by buildStoreZip (compression method 0). */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function readStoreZip(input: ArrayBuffer | ArrayBufferView): Map<string, Uint8Array> {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input instanceof ArrayBuffer ? input : input.buffer, input.byteOffset, input.byteLength);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const view = new DataView(buffer);
  const len = bytes.length;
  if (len < 22) throw new Error("无效的 ZIP 文件");

  let eocdOffset = -1;
  const searchStart = Math.max(0, len - 65557);
  for (let i = len - 22; i >= searchStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("无效的 ZIP 文件");

  const cdCount = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map<string, Uint8Array>();

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (pos + 46 > len || view.getUint32(pos, true) !== CD_SIG) {
      throw new Error("ZIP 中央目录损坏");
    }
    const compMethod = view.getUint16(pos + 10, true);
    const uncompSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const nameStart = pos + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > len) throw new Error("ZIP 中央目录损坏");
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameEnd));
    pos = nameEnd + extraLen + commentLen;

    if (localOffset + 30 > len || view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new Error(`ZIP 本地头损坏: ${name}`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + uncompSize;
    if (dataEnd > len) throw new Error(`ZIP 数据损坏: ${name}`);
    if (compMethod !== 0) throw new Error(`不支持的压缩方式 (${name})`);

    entries.set(name, bytes.slice(dataStart, dataEnd));
  }

  return entries;
}
