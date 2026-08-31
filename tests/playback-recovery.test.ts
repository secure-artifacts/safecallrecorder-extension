import { describe, expect, it, vi } from "vitest";
import { attachPlaybackRecovery, isPrematureMediaEnd, waitForMediaReady } from "../src/playback-recovery";

describe("playback recovery", () => {
  it("waitForMediaReady resolves when canplaythrough fires", async () => {
    const el = {
      readyState: 0,
      src: "blob:test",
      load: vi.fn(),
      addEventListener: vi.fn((type: string, cb: () => void) => {
        if (type === "canplaythrough") setTimeout(cb, 0);
      }),
      removeEventListener: vi.fn()
    } as unknown as HTMLMediaElement;
    await waitForMediaReady(el, 1000);
    expect(el.load).toHaveBeenCalled();
  });

  it("detects premature ended events", () => {
    const el = { duration: 180, currentTime: 5 } as HTMLMediaElement;
    expect(isPrematureMediaEnd(el)).toBe(true);
    const done = { duration: 180, currentTime: 179.5 } as HTMLMediaElement;
    expect(isPrematureMediaEnd(done)).toBe(false);
  });

  it("detach removes stall listeners", () => {
    const remove = vi.fn();
    const el = {
      paused: true,
      ended: false,
      currentTime: 0,
      duration: 10,
      readyState: 4,
      play: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
      removeEventListener: remove
    } as unknown as HTMLMediaElement;
    const detach = attachPlaybackRecovery(el, { shouldRecover: () => false });
    detach();
    expect(remove).toHaveBeenCalled();
  });
});
