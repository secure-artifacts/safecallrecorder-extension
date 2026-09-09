/** Recover HTML media elements when decoding/buffering stalls. */

export type PlaybackRecoveryOptions = {
  /** Ms without currentTime advance before attempting recovery. */
  stuckThresholdMs?: number;
  onRecovering?: () => void;
  /** When false, skip auto-recover (e.g. user pressed pause). */
  shouldRecover?: () => boolean;
};

const HAVE_FUTURE_DATA = 3;
const HAVE_ENOUGH_DATA = 4;

function isFullyBuffered(el: HTMLMediaElement): boolean {
  const dur = el.duration;
  if (!Number.isFinite(dur) || dur <= 0) return false;
  if (el.readyState < HAVE_ENOUGH_DATA) return false;
  const ranges = el.buffered;
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= 0.25 && ranges.end(i) >= dur - 0.35) return true;
  }
  return false;
}

/** Wait until the whole local file is buffered (not streaming). */
export function waitForFullMediaBuffered(el: HTMLMediaElement, timeoutMs = 120_000): Promise<void> {
  if (isFullyBuffered(el)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeEventListener("progress", onProgress);
      el.removeEventListener("canplaythrough", onProgress);
      el.removeEventListener("loadeddata", onProgress);
      el.removeEventListener("error", onError);
      fn();
    };
    const onProgress = () => {
      if (isFullyBuffered(el)) finish(resolve);
    };
    const onError = () => finish(() => reject(new Error("无法预加载媒体")));
    const timer = setTimeout(() => finish(() => reject(new Error("媒体预加载超时"))), timeoutMs);
    el.addEventListener("progress", onProgress);
    el.addEventListener("canplaythrough", onProgress);
    el.addEventListener("loadeddata", onProgress);
    el.addEventListener("error", onError, { once: true });
    if (el.readyState === 0 && el.src) {
      try {
        el.load();
      } catch {
        /* ignore */
      }
    }
    onProgress();
  });
}

export function isPrematureMediaEnd(el: HTMLMediaElement): boolean {
  const dur = el.duration;
  return Number.isFinite(dur) && dur > 0.5 && el.currentTime < dur - 0.75;
}

export function waitForMediaReady(el: HTMLMediaElement, timeoutMs = 30_000): Promise<void> {
  if (el.readyState >= HAVE_FUTURE_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeEventListener("canplaythrough", onReady);
      el.removeEventListener("loadeddata", onReady);
      el.removeEventListener("error", onError);
      fn();
    };
    const onReady = () => finish(resolve);
    const onError = () => finish(() => reject(new Error("无法加载音频")));
    const timer = setTimeout(() => finish(() => reject(new Error("加载音频超时"))), timeoutMs);
    el.addEventListener("canplaythrough", onReady, { once: true });
    el.addEventListener("loadeddata", onReady, { once: true });
    el.addEventListener("error", onError, { once: true });
    if (el.readyState === 0 && el.src) {
      try {
        el.load();
      } catch {
        /* ignore */
      }
    }
  });
}

export async function playMediaWithRecovery(el: HTMLMediaElement): Promise<void> {
  await waitForFullMediaBuffered(el).catch(() => waitForMediaReady(el).catch(() => undefined));
  await el.play();
}

export function attachPlaybackRecovery(
  el: HTMLMediaElement,
  options: PlaybackRecoveryOptions = {}
): () => void {
  let recovering = false;

  const tryRecover = async () => {
    if (recovering || el.ended) return;
    if (options.shouldRecover && !options.shouldRecover()) return;
    recovering = true;
    options.onRecovering?.();
    try {
      if (el.paused) {
        await el.play();
        return;
      }
      const t = el.currentTime;
      const duration = Number.isFinite(el.duration) ? el.duration : t + 1;
      if (duration - t > 1) {
        el.currentTime = Math.min(t + 0.05, duration - 0.25);
      }
      await el.play();
    } catch {
      /* ignore */
    } finally {
      recovering = false;
    }
  };

  const onWaiting = () => void tryRecover();
  const onStalled = () => void tryRecover();

  el.addEventListener("waiting", onWaiting);
  el.addEventListener("stalled", onStalled);

  return () => {
    el.removeEventListener("waiting", onWaiting);
    el.removeEventListener("stalled", onStalled);
  };
}

export async function resumeIfShouldPlay(el: HTMLMediaElement): Promise<void> {
  if (isPrematureMediaEnd(el)) {
    try {
      await el.play();
    } catch {
      /* ignore */
    }
    return;
  }
  if (el.ended) return;
  if (!el.paused) return;
  if (el.currentTime <= 0 && el.readyState < 2) return;
  try {
    await el.play();
  } catch {
    /* ignore */
  }
}
