/** Load entire local video into memory before playback to avoid mid-play stalls. */

import { waitForFullMediaBuffered } from "./playback-recovery";

export type LocalVideoPrepareResult = {
  objectUrl: string;
  revoke: () => void;
};

const MP4_MIMES = [
  'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  'video/mp4; codecs="avc1.4D401E, mp4a.40.2"',
  "video/mp4"
];
const WEBM_MIMES = ['video/webm; codecs="vp9, opus"', 'video/webm; codecs="vp8, vorbis"', "video/webm"];
const MKV_MIMES = ["video/x-matroska"];

function pickVideoMime(blob: Blob, fileName: string): string | null {
  const type = blob.type.trim();
  if (type && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type)) return type;
  const lower = fileName.toLowerCase();
  const candidates = lower.endsWith(".webm")
    ? WEBM_MIMES
    : lower.endsWith(".mkv")
      ? MKV_MIMES
      : MP4_MIMES;
  if (typeof MediaSource === "undefined") return null;
  return candidates.find((mime) => MediaSource.isTypeSupported(mime)) ?? null;
}

async function loadVideoViaMse(
  video: HTMLVideoElement,
  data: ArrayBuffer,
  mime: string,
  timeoutMs: number
): Promise<LocalVideoPrepareResult> {
  return new Promise((resolve, reject) => {
    const ms = new MediaSource();
    const objectUrl = URL.createObjectURL(ms);
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener("canplaythrough", onReady);
      video.removeEventListener("error", onError);
      fn();
    };

    const onReady = () => finish(() => resolve({
      objectUrl,
      revoke: () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* ignore */
        }
        video.removeAttribute("src");
        try {
          video.load();
        } catch {
          /* ignore */
        }
      }
    }));
    const onError = () => finish(() => reject(new Error("无法预加载视频")));

    const timer = setTimeout(() => finish(() => reject(new Error("视频预加载超时"))), timeoutMs);

    ms.addEventListener(
      "sourceopen",
      () => {
        try {
          const sb = ms.addSourceBuffer(mime);
          sb.addEventListener("updateend", () => {
            if (!sb.updating && ms.readyState === "open") {
              try {
                ms.endOfStream();
              } catch {
                /* ignore */
              }
            }
          });
          sb.appendBuffer(data);
        } catch (e) {
          finish(() => reject(e instanceof Error ? e : new Error(String(e))));
        }
      },
      { once: true }
    );

    video.preload = "auto";
    video.src = objectUrl;
    video.addEventListener("canplaythrough", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
    try {
      video.load();
    } catch {
      /* ignore */
    }
  });
}

/** Decode/buffer the full file, then allow smooth playback from memory. */
export async function prepareLocalVideoElement(
  video: HTMLVideoElement,
  blob: Blob,
  fileName: string,
  timeoutMs = 120_000
): Promise<LocalVideoPrepareResult> {
  const data = await blob.arrayBuffer();
  const mime = pickVideoMime(blob, fileName);
  if (mime) {
    try {
      const result = await loadVideoViaMse(video, data, mime, timeoutMs);
      await waitForFullMediaBuffered(video, timeoutMs).catch(() => undefined);
      return result;
    } catch {
      /* fall through to blob URL preload */
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  video.preload = "auto";
  video.src = objectUrl;
  try {
    video.load();
  } catch {
    /* ignore */
  }
  await waitForFullMediaBuffered(video, timeoutMs);
  return {
    objectUrl,
    revoke: () => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
    }
  };
}
