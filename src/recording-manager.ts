import { openInput } from "./device-manager";
import { canContinueRecording } from "./recording-continue";
import { storage } from "./storage-manager";
import { StreamLevelMonitor, type AudioLevelUpdate } from "./stream-level-monitor";
import { captureAudioBitsPerSecond, resolveBitrate } from "./bitrate-presets";
import { clearLiveSession, getSettings, mirrorLiveSession } from "./extension-storage";
import { id, type Part, type Session, type SourceMode, type TrackKind } from "./types";

type Active = {
  session: Session;
  recorders: MediaRecorder[];
  streams: MediaStream[];
  parts: Part[];
  monitors: StreamLevelMonitor[];
  latestLevels: Map<string, AudioLevelUpdate>;
  playbackCtx?: AudioContext;
  wallClockStarted: number;
  /** In-flight IndexedDB chunk writes; stop waits for these. */
  pendingWrites: Set<Promise<void>>;
};

const mime = () => ["audio/webm;codecs=opus", "audio/webm"].find(MediaRecorder.isTypeSupported) || "";

export type LevelBroadcaster = (update: AudioLevelUpdate) => void;

export class RecordingManager {
  active = new Map<string, Active>();
  private broadcast: LevelBroadcaster = () => undefined;
  private subscribers = 0;

  setBroadcaster(fn: LevelBroadcaster) {
    this.broadcast = fn;
  }
  setSubscriberCount(n: number) {
    this.subscribers = Math.max(0, n);
  }

  async start(input: {
    mode?: SourceMode;
    deviceId?: string;
    deviceLabel?: string;
    tabStreamId?: string;
    tabTitle?: string;
    bitrate: number;
    mixed?: boolean;
    sessionId?: string;
    displayName?: string;
    continue?: boolean;
  }) {
    if (input.continue && input.sessionId) {
      return this.continueRecording({
        sessionId: input.sessionId,
        deviceId: input.deviceId || "",
        deviceLabel: input.deviceLabel,
        bitrate: input.bitrate
      });
    }

    const mode: SourceMode = "device";
    if (!input.deviceId) throw new Error("请选择声音设备");

    const displayName = input.displayName ?? "";
    const targetBitrate = resolveBitrate(input.bitrate);
    const title = displayName !== "" ? displayName : "未命名录音";
    const session: Session = {
      id: input.sessionId || id(),
      name: title,
      mode,
      status: "starting",
      recordingStatus: "starting",
      originalStatus: "pending",
      mp3Status: "idle",
      historyStatus: "recording",
      startedAt: Date.now(),
      selectedDeviceId: input.deviceId,
      selectedDeviceLabel: input.deviceLabel,
      safeDurationMs: 0,
      recoveryCount: 0,
      bitrate: targetBitrate,
      mixed: false
    };
    await storage.saveSession(session);
    const streams: MediaStream[] = [];
    try {
      return await this.beginCapture(session, input.deviceId, input.deviceLabel || "声音设备", streams);
    } catch (e) {
      session.status = "error";
      session.recordingStatus = "error";
      session.historyStatus = "interrupted";
      session.interruptionReason = e instanceof Error ? e.message : String(e);
      await storage.saveSession(session);
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      this.active.delete(session.id);
      throw e;
    }
  }

  async continueRecording(input: {
    sessionId: string;
    deviceId: string;
    deviceLabel?: string;
    bitrate?: number;
  }) {
    if (!input.deviceId) throw new Error("请选择声音设备");
    const session = await storage.getSession(input.sessionId);
    if (!session) throw new Error("找不到该录音");
    if (!canContinueRecording(session)) {
      throw new Error("该录音无法继续，需要已有保存内容且当前不在录音中");
    }

    await storage.deleteMp3ForSession(input.sessionId);

    session.status = "starting";
    session.recordingStatus = "starting";
    session.historyStatus = "recording";
    session.originalStatus = "available";
    session.mp3Status = "idle";
    session.hasMp3 = false;
    session.mp3Error = undefined;
    session.originalError = undefined;
    session.interruptionReason = undefined;
    session.endedAt = undefined;
    session.durationMs = undefined;
    session.fileSize = undefined;
    session.recoveryCount = (session.recoveryCount || 0) + 1;
    session.selectedDeviceId = input.deviceId;
    session.selectedDeviceLabel = input.deviceLabel;
    if (input.bitrate != null) session.bitrate = resolveBitrate(input.bitrate);

    await storage.saveSession(session);
    const streams: MediaStream[] = [];
    try {
      return await this.beginCapture(session, input.deviceId, input.deviceLabel || "声音设备", streams);
    } catch (e) {
      session.status = "interrupted";
      session.recordingStatus = "interrupted";
      session.historyStatus = session.safeDurationMs > 0 ? "partial" : "interrupted";
      session.interruptionReason = e instanceof Error ? e.message : String(e);
      await storage.saveSession(session);
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      this.active.delete(session.id);
      throw e;
    }
  }

  private async beginCapture(session: Session, deviceId: string, deviceLabel: string, streams: MediaStream[]) {
    const d = await openInput(deviceId);
    streams.push(d);
    const active: Active = {
      session,
      recorders: [],
      streams,
      parts: [],
      monitors: [],
      latestLevels: new Map(),
      wallClockStarted: Date.now() - (session.safeDurationMs || 0),
      pendingWrites: new Set()
    };
    this.active.set(session.id, active);
    await this.recordTrack(active, "selected_device", d, deviceLabel);
    session.status = "recording";
    session.recordingStatus = "recording";
    session.historyStatus = "recording";
    await storage.saveSession(session);
    mirrorLiveSession(session.id, session);
    return session;
  }

  private async recordTrack(
    active: Active,
    trackId: TrackKind,
    stream: MediaStream,
    sourceLabel: string,
    context?: AudioContext
  ) {
    const part: Part = {
      id: id(),
      sessionId: active.session.id,
      trackId,
      startedAt: Date.now(),
      mimeType: mime(),
      completed: false
    };
    await storage.savePart(part);
    active.parts.push(part);
    const rec = new MediaRecorder(stream, {
      mimeType: part.mimeType || undefined,
      audioBitsPerSecond: captureAudioBitsPerSecond(active.session.bitrate)
    });
    let index = 0;
    let previous = Date.now();
    rec.ondataavailable = (e) => {
      const end = Date.now();
      if (!e.data.size) return;
      const chunk = {
        id: id(),
        sessionId: active.session.id,
        partId: part.id,
        trackId,
        index: index++,
        startedAt: previous,
        endedAt: end,
        durationMs: end - previous,
        size: e.data.size,
        mimeType: e.data.type || part.mimeType,
        blob: e.data
      };
      previous = end;
      const write = (async () => {
        try {
          await storage.saveChunk(chunk);
          active.session.safeDurationMs += chunk.durationMs;
          active.session.lastSavedAt = Date.now();
          await storage.saveSession(active.session);
          mirrorLiveSession(active.session.id, active.session);
        } catch {
          active.session.status = "error";
          active.session.recordingStatus = "error";
          active.session.interruptionReason = "自动保存失败，请检查本地存储空间。";
          await storage.saveSession(active.session);
          try {
            rec.stop();
          } catch {
            /* ignore */
          }
        }
      })();
      active.pendingWrites.add(write);
      void write.finally(() => active.pendingWrites.delete(write));
    };
    rec.onstop = async () => {
      part.endedAt = Date.now();
      part.completed = true;
      await storage.savePart(part);
      void context?.close();
    };
    stream.getAudioTracks()[0]?.addEventListener("ended", () =>
      this.interrupt(active.session.id, "device_disconnected")
    );

    const monitor = new StreamLevelMonitor(active.session.id, trackId, sourceLabel, stream);
    try {
      const settings = await getSettings();
      monitor.setSensitivity(settings.detectionSensitivity || "standard");
    } catch {
      monitor.setSensitivity("standard");
    }
    monitor.onUpdate((update) => {
      active.latestLevels.set(`${update.trackId}`, update);
      if (this.subscribers > 0) this.broadcast(update);
    });
    try {
      monitor.start();
    } catch (e) {
      console.error("[RecordingManager] level monitor failed; recording continues", e);
    }
    active.monitors.push(monitor);
    rec.start(1500);
    active.recorders.push(rec);
  }

  async pause(sessionId: string) {
    const a = this.active.get(sessionId);
    if (!a) return;
    a.recorders.forEach((r) => r.state === "recording" && r.pause());
    a.monitors.forEach((m) => m.setPaused(true));
    a.session.status = "paused";
    await storage.saveSession(a.session);
  }

  async resume(sessionId: string) {
    const a = this.active.get(sessionId);
    if (!a) return;
    a.recorders.forEach((r) => r.state === "paused" && r.resume());
    a.monitors.forEach((m) => m.setPaused(false));
    a.session.status = "recording";
    await storage.saveSession(a.session);
  }

  async stop(sessionId: string, reason?: string) {
    const a = this.active.get(sessionId);
    if (!a) return undefined;
    a.monitors.forEach((m) => m.stop());
    for (const r of a.recorders) {
      try {
        if (r.state === "recording" || r.state === "paused") r.requestData();
      } catch {
        /* ignore */
      }
    }
    await new Promise((r) => setTimeout(r, 80));
    await Promise.all(
      a.recorders.map(
        (r) =>
          new Promise<void>((ok) => {
            if (r.state === "inactive") return ok();
            r.addEventListener("stop", () => ok(), { once: true });
            try {
              r.stop();
            } catch {
              ok();
            }
          })
      )
    );
    if (a.pendingWrites.size) {
      await Promise.allSettled([...a.pendingWrites]);
    }
    a.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void a.playbackCtx?.close();
    a.session.endedAt = Date.now();
    a.session.durationMs = a.session.endedAt - a.session.startedAt;
    a.session.interruptionReason = reason;
    if (reason) {
      a.session.status = "interrupted";
      a.session.recordingStatus = "interrupted";
      a.session.historyStatus = a.session.safeDurationMs > 0 ? "partial" : "interrupted";
      a.session.originalStatus = a.session.safeDurationMs > 0 ? "available" : "missing";
      a.session.mp3Status = "idle";
    } else {
      a.session.status = "completed";
      a.session.recordingStatus = "completed";
      a.session.originalStatus = "available";
      a.session.mp3Status = "idle";
      a.session.historyStatus = "completed";
    }
    await storage.saveSession(a.session);
    clearLiveSession(sessionId);
    this.active.delete(sessionId);
    return a.session;
  }

  interrupt(sessionId: string, reason: string) {
    const a = this.active.get(sessionId);
    if (a) a.monitors.forEach((m) => m.setDisconnected(true));
    return this.stop(sessionId, reason);
  }

  status() {
    return [...this.active.values()].map((a) => {
      const levels = [...a.latestLevels.values()];
      const maxRms = levels.reduce((n, l) => Math.max(n, l.rms), 0);
      return {
        ...a.session,
        level: maxRms,
        levels,
        elapsedMs: Date.now() - a.wallClockStarted
      };
    });
  }

  currentLevels() {
    const out: AudioLevelUpdate[] = [];
    for (const a of this.active.values()) out.push(...a.latestLevels.values());
    return out;
  }
}

export const recordings = new RecordingManager();
