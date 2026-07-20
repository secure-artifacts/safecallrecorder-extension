import {
  convertSessionToMp3,
  downloadMp3,
  downloadOriginalRecording,
  downloadRecoverableWebm,
  queueMp3GenerationInBackground
} from "./export-manager";
import { clearRecordingHistory, deleteRecordingSession } from "./recording-deletion-service";
import { recordings } from "./recording-manager";
import { recoverIncomplete } from "./recovery-manager";
import { storage } from "./storage-manager";
import { MessageType, type Request, failure } from "./messages";
import { StreamLevelMonitor, type AudioLevelUpdate } from "./stream-level-monitor";
import { AudioLevelConfig } from "./audio-level-config";
import { openInput } from "./device-manager";
import { DEFAULT_SETTINGS, type AppSettings, type Session, type StopDownloadMode } from "./types";
import { getSettings } from "./extension-storage";

let levelSubscribers = 0;
let stopping = false;

recordings.setBroadcaster((update) => {
  if (levelSubscribers <= 0) return;
  try {
    void chrome.runtime.sendMessage(update);
  } catch {
    /* no dashboard */
  }
});

function normalizeSettings(raw: AppSettings): AppSettings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  const mode = (s.stopDownloadMode || "original_then_mp3") as StopDownloadMode;
  s.stopDownloadMode = mode;
  if (s.autoDownloadOriginal == null) {
    s.autoDownloadOriginal = mode !== "mp3_only";
  }
  if (s.autoDownloadMp3AfterSuccess == null) {
    s.autoDownloadMp3AfterSuccess = s.autoDownloadMp3 !== false && mode !== "original_only";
  }
  if (s.keepOriginalAfterMp3 == null) s.keepOriginalAfterMp3 = true;
  return s;
}

async function loadSettings(): Promise<AppSettings> {
  return normalizeSettings(await getSettings());
}

chrome.runtime.onMessage.addListener((m: Request | AudioLevelUpdate, _sender, reply) => {
  if ("type" in m && m.type === MessageType.AudioLevelUpdate) return;
  const req = m as Request;
  (async () => {
    if (req.target !== "offscreen") return;
    const p = req.payload || {};

    if (req.type === MessageType.StartRecording) {
      if (stopping) throw new Error("请稍候，上一次停止仍在处理");
      if (recordings.active.size > 0) throw new Error("已有录音正在进行");
      const session = await recordings.start(p as never);
      return reply({ ok: true, requestId: req.requestId, data: session });
    }

    if (req.type === MessageType.GetState) {
      const active = recordings.status();
      const sessions = await recoverIncomplete(active.map((s) => s.id));
      const settings = await loadSettings();
      return reply({
        ok: true,
        requestId: req.requestId,
        data: { active, sessions, levels: recordings.currentLevels(), settings }
      });
    }

    if (req.type === MessageType.StopRecording) {
      if (stopping) return reply({ ok: true, requestId: req.requestId });
      stopping = true;
      try {
        const sessionId = String(p.sessionId);
        const settings = await loadSettings();
        const mode = settings.stopDownloadMode || "original_then_mp3";

        // 1) Finalize capture only — do NOT await MP3.
        await recordings.stop(sessionId);

        let originalDownload: Awaited<ReturnType<typeof downloadOriginalRecording>> | null = null;

        if (mode === "mp3_only") {
          // Legacy path: wait for MP3 then download (not recommended).
          try {
            await convertSessionToMp3(sessionId);
            if (settings.autoDownloadMp3AfterSuccess !== false) {
              await downloadMp3(sessionId, false, "auto").catch((e) => console.error("[download]", e));
            }
          } catch (e) {
            console.error("[mp3 sync]", e);
          }
          return reply({
            ok: true,
            requestId: req.requestId,
            data: { mode, originalDownload: null, mp3Queued: false }
          });
        }

        // 2) Immediate original download (WebM or ZIP).
        if (settings.autoDownloadOriginal !== false) {
          originalDownload = await downloadOriginalRecording(sessionId, { trigger: "auto" });
        }

        // 3) Queue MP3 in background — do not await.
        const wantMp3 = mode === "original_then_mp3";
        if (wantMp3) {
          const sessions = await storage.all<Session>("sessions");
          const session = sessions.find((s) => s.id === sessionId);
          if (session) {
            session.mp3Status = "queued";
            session.historyStatus = "processing_mp3";
            await storage.saveSession(session);
          }
          queueMp3GenerationInBackground(sessionId, {
            autoDownloadMp3: settings.autoDownloadMp3AfterSuccess !== false
          });
        } else {
          const sessions = await storage.all<Session>("sessions");
          const session = sessions.find((s) => s.id === sessionId);
          if (session) {
            session.mp3Status = "skipped";
            session.historyStatus = "completed";
            await storage.saveSession(session);
          }
        }

        return reply({
          ok: true,
          requestId: req.requestId,
          data: {
            mode,
            originalDownload,
            mp3Queued: wantMp3
          }
        });
      } finally {
        stopping = false;
      }
    }

    if (req.type === MessageType.ExportSession) {
      const sessionId = String(p.sessionId);
      const existing = await storage.getMp3(sessionId);
      if (!existing || p.force) {
        await convertSessionToMp3(sessionId, undefined, {
          forceMono: !!p.forceMono,
          overrideBitrate: typeof p.overrideBitrate === "number" ? p.overrideBitrate : undefined
        });
      }
      if (p.download !== false) await downloadMp3(sessionId, !!p.saveAs, p.force ? "retry" : "manual");
      return reply({ ok: true, requestId: req.requestId });
    }

    if (req.type === MessageType.DeleteSession) {
      const result = await deleteRecordingSession(String(p.sessionId));
      if (!result.ok) throw new Error(result.error || "删除失败");
      return reply({ ok: true, requestId: req.requestId, data: result });
    }

    if (req.type === MessageType.ClearAllHistory) {
      if (p.confirm !== "DELETE_ALL") throw new Error("需要确认清理");
      const result = await clearRecordingHistory({ onlySafe: p.onlySafe !== false });
      return reply({ ok: true, requestId: req.requestId, data: result });
    }

    if (req.type === MessageType.SubscribeLevels) {
      levelSubscribers += 1;
      recordings.setSubscriberCount(levelSubscribers);
      for (const level of recordings.currentLevels()) {
        try {
          void chrome.runtime.sendMessage(level);
        } catch {
          /* ignore */
        }
      }
      return reply({ ok: true, requestId: req.requestId, data: { subscribers: levelSubscribers } });
    }

    if (req.type === MessageType.UnsubscribeLevels) {
      levelSubscribers = Math.max(0, levelSubscribers - 1);
      recordings.setSubscriberCount(levelSubscribers);
      return reply({ ok: true, requestId: req.requestId });
    }

    if (req.type === MessageType.TestDevice) {
      const stream = await openInput(String(p.deviceId));
      const monitor = new StreamLevelMonitor(
        "test",
        "test",
        String(p.deviceLabel || "设备"),
        stream,
        AudioLevelConfig.maxUpdatesPerSecond
      );
      let heard = false;
      monitor.onUpdate((u) => {
        if (u.hasSound) heard = true;
        if (levelSubscribers > 0) void chrome.runtime.sendMessage(u);
      });
      monitor.start();
      await new Promise((r) => setTimeout(r, 3000));
      monitor.stop();
      stream.getTracks().forEach((t) => t.stop());
      return reply({ ok: true, requestId: req.requestId, data: { silent: !heard } });
    }

    if (req.type === MessageType.PauseRecording) {
      await recordings.pause(String(p.sessionId));
      return reply({ ok: true, requestId: req.requestId });
    }
    if (req.type === MessageType.ResumeRecording) {
      await recordings.resume(String(p.sessionId));
      return reply({ ok: true, requestId: req.requestId });
    }

    if (req.type === MessageType.DownloadRecoverable) {
      await downloadRecoverableWebm(String(p.sessionId));
      return reply({ ok: true, requestId: req.requestId });
    }
    if (req.type === MessageType.GetMp3Url) {
      const file = await storage.getMp3(String(p.sessionId));
      if (!file) throw new Error("没有可播放的 MP3");
      const url = URL.createObjectURL(file.blob);
      return reply({ ok: true, requestId: req.requestId, data: { url, fileName: file.fileName } });
    }

    reply(failure(req, "offscreen", new Error(`Unsupported message. supported=${Object.values(MessageType).join(",")}`)));
  })().catch((e) => reply(failure(req, "offscreen", e)));
  return true;
});

navigator.storage.persist().catch(() => undefined);

void (async () => {
  const sessions = await storage.all<Session>("sessions");
  for (const s of sessions) {
    if (["starting", "recording", "paused", "exporting"].includes(s.status) && !recordings.active.has(s.id)) {
      s.status = "interrupted";
      s.recordingStatus = "interrupted";
      s.historyStatus = s.safeDurationMs > 0 ? "partial" : "interrupted";
      s.originalStatus = s.safeDurationMs > 0 ? "available" : "missing";
      s.interruptionReason = s.interruptionReason || "browser_closed_or_crashed";
      if (s.mp3Status === "queued" || s.mp3Status === "decoding" || s.mp3Status === "encoding") {
        s.mp3Status = "failed";
        s.mp3Error = s.mp3Error || "浏览器关闭时 MP3 尚未完成，可重新生成。";
      }
      await storage.saveSession(s);
    }
  }
})();
