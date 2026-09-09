import { finalizeWebmDurationBlob } from "./webm-duration";

/** Normalize local blobs (e.g. webm duration) before decode or video preload. */
export async function preparePlayableLocalMediaBlob(file: File): Promise<Blob> {
  if (/webm/i.test(file.type) || /\.webm$/i.test(file.name)) {
    try {
      return await finalizeWebmDurationBlob(file, 0);
    } catch {
      return file;
    }
  }
  return file;
}
