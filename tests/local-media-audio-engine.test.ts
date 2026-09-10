import { describe, expect, it, vi, afterEach } from "vitest";
import { LocalMediaAudioEngine, getSharedLocalMediaAudioContext } from "../src/local-media-audio-engine";

describe("LocalMediaAudioEngine", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and plays decoded audio without HTML media element", async () => {
    const onEnded = vi.fn();
    const onPlaying = vi.fn();
    const engine = new LocalMediaAudioEngine({ onEnded, onPlaying });

    const decodeAudioData = vi.fn(async () => ({
      duration: 2,
      getChannelData: () => new Float32Array(0)
    })) as unknown as AudioContext["decodeAudioData"];
    const source = {
      buffer: null as AudioBuffer | null,
      onended: null as (() => void) | null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      stop: vi.fn(),
      start: vi.fn()
    };
    const analyser = {
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const ctx = {
      state: "running",
      currentTime: 0,
      resume: vi.fn(),
      decodeAudioData,
      createBufferSource: vi.fn(() => source),
      createAnalyser: vi.fn(() => analyser),
      destination: {}
    };
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function MockAudioContext(this: typeof ctx) {
        Object.assign(this, ctx);
      })
    );

    await engine.load(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }));
    expect(decodeAudioData).toHaveBeenCalled();
    expect(engine.hasBuffer).toBe(true);
    expect(engine.duration).toBe(2);

    await engine.play();
    expect(onPlaying).toHaveBeenCalled();
    expect(source.start).toHaveBeenCalledWith(0, 0);

    source.onended?.();
    expect(onEnded).toHaveBeenCalled();

    expect(engine.getCurrentTime()).toBeGreaterThanOrEqual(0);
    engine.seek(1);
    expect(engine.getCurrentTime()).toBe(1);
    engine.dispose();
    expect(getSharedLocalMediaAudioContext()).toBeTruthy();
  });

  it("seek restart does not fire onEnded from the stopped source", async () => {
    const onEnded = vi.fn();
    const source = {
      buffer: null as AudioBuffer | null,
      onended: null as (() => void) | null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      stop: vi.fn(function (this: typeof source) {
        queueMicrotask(() => this.onended?.());
      }),
      start: vi.fn()
    };
    const analyser = {
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const ctx = {
      state: "running",
      currentTime: 0,
      resume: vi.fn(),
      decodeAudioData: vi.fn(async () => ({
        duration: 10,
        getChannelData: () => new Float32Array(0)
      })),
      createBufferSource: vi.fn(() => source),
      createAnalyser: vi.fn(() => analyser),
      destination: {}
    };
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function MockAudioContext(this: typeof ctx) {
        Object.assign(this, ctx);
      })
    );

    const engine = new LocalMediaAudioEngine({ onEnded });
    await engine.load(new Blob([new Uint8Array([1])], { type: "audio/mpeg" }));
    await engine.play();
    onEnded.mockClear();
    await engine.seekAndResume(3);
    await Promise.resolve();
    expect(onEnded).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("does not resume when user paused or playback not wanted", async () => {
    const engine = new LocalMediaAudioEngine();
    const play = vi.spyOn(engine, "play").mockResolvedValue(undefined);
    Object.defineProperty(engine, "hasBuffer", { get: () => true });

    await engine.resumeIfShouldPlay(false, false);
    await engine.resumeIfShouldPlay(true, true);
    expect(play).not.toHaveBeenCalled();
    play.mockRestore();
  });
});
