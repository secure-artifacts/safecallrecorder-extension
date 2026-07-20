import {
  BITRATE_PRESETS,
  DEFAULT_BITRATE,
  estimateMp3Mb,
  formatBitrateHistory,
  getBitratePreset,
  resolveBitrate
} from "./bitrate-presets";
import {
  downloadRecordingMp3,
  friendlyDownloadError,
  getMp3BlobForSession,
  installDownloadLifecycleListeners,
  reconcileSessionMp3Status
} from "./download/mp3-download-service";
import { MessageType, requestId, type Request } from "./messages";
import type { AudioLevelUpdate } from "./stream-level-monitor";
import { StreamLevelMonitor } from "./stream-level-monitor";
import { applyLevelUpdate, ensureMeterHost, removeSessionMeters, resetWaveform, setWaveformMode } from "./waveform-ui";
import { DEFAULT_SETTINGS, type AppSettings, type Session, type StopDownloadMode } from "./types";
import {
  diagnoseStorageEnvironment,
  getSettings,
  isExtensionContext
} from "./extension-storage";
import { openHelpPage } from "./help-nav";
import { downloadOriginalRecording } from "./download/original-download-service";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m % 60)}:${pad(s % 60)}`;
};

let devices: MediaDeviceInfo[] = [];
let selectedSession: string | undefined;
let recording = false;
let busy = false;
let settings: AppSettings = { ...DEFAULT_SETTINGS };
let preview: { stream: MediaStream; monitor: StreamLevelMonitor } | undefined;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;
let startedAt = 0;
let lowQualityShown = false;
const regeneratingSessions = new Set<string>();

/** Single in-memory source of truth for history cards (synced from IndexedDB). */
let historyRecords: Session[] = [];
let historyActiveIds: string[] = [];
/** Bumped to discard in-flight GetState / reload results after delete/clear. */
let historyRequestVersion = 0;
let clearingHistory = false;
let deletingSessionIds = new Set<string>();
let playingAudio: { sessionId: string; audio: HTMLAudioElement; url: string } | undefined;

const HISTORY_CHANNEL_NAME = "safe-call-recorder-history";
let historyChannel: BroadcastChannel | undefined;
try {
  historyChannel = new BroadcastChannel(HISTORY_CHANNEL_NAME);
} catch {
  historyChannel = undefined;
}

async function ask(type: Request["type"], payload: Record<string, unknown> = {}) {
  const r = await chrome.runtime.sendMessage({
    type,
    target: "service-worker",
    requestId: requestId(),
    payload
  } satisfies Request);
  if (!r?.ok) throw new Error(friendlyError(r?.error?.message || "操作失败"));
  return r.data;
}

function invalidateHistoryReads(reason: string) {
  historyRequestVersion += 1;
  console.info("[HistorySync]", { stage: "invalidate", reason, version: historyRequestVersion });
  return historyRequestVersion;
}

function stopPlaybackIfSession(sessionId?: string) {
  if (!playingAudio) return;
  if (sessionId && playingAudio.sessionId !== sessionId) return;
  try {
    playingAudio.audio.pause();
  } catch {
    /* ignore */
  }
  try {
    URL.revokeObjectURL(playingAudio.url);
  } catch {
    /* ignore */
  }
  playingAudio = undefined;
}

function updateClearHistoryButton() {
  const clearBtn = $<HTMLButtonElement>("clearHistory");
  if (!clearBtn) return;
  if (clearingHistory) {
    clearBtn.disabled = true;
    clearBtn.textContent = "正在清空……";
    return;
  }
  clearBtn.textContent = "清空历史";
  clearBtn.disabled = historyRecords.length === 0;
}

function applyHistoryRecords(records: Session[], activeIds?: string[]) {
  historyRecords = records;
  if (activeIds) historyActiveIds = activeIds;
  renderHistory(historyRecords, historyActiveIds);
  updateClearHistoryButton();
}

function removeSessionsFromUi(sessionIds: string[]) {
  if (!sessionIds.length) return;
  const removed = new Set(sessionIds);
  for (const id of sessionIds) stopPlaybackIfSession(id);
  historyRecords = historyRecords.filter((r) => !removed.has(r.id));
  console.info("[HistoryDelete]", {
    stage: "ui_removed",
    deletedSessionIds: sessionIds,
    remainingUiCount: historyRecords.length
  });
  renderHistory(historyRecords, historyActiveIds);
  updateClearHistoryButton();
}

function broadcastHistoryChanged(payload: {
  operation: "delete" | "clear";
  deletedSessionIds: string[];
  timestamp?: number;
}) {
  const msg = {
    type: MessageType.RecordingHistoryChanged,
    target: "dashboard" as const,
    requestId: requestId(),
    payload: {
      operation: payload.operation,
      deletedSessionIds: payload.deletedSessionIds,
      timestamp: payload.timestamp ?? Date.now()
    }
  };
  try {
    historyChannel?.postMessage(msg.payload);
  } catch {
    /* ignore */
  }
  try {
    void chrome.runtime.sendMessage(msg);
  } catch {
    /* ignore */
  }
}

function applyRemoteHistoryChange(deletedSessionIds: string[]) {
  if (!deletedSessionIds?.length) {
    void reloadHistoryVerified("remote_empty_reload");
    return;
  }
  invalidateHistoryReads("remote_history_changed");
  removeSessionsFromUi(deletedSessionIds);
  void reloadHistoryVerified("remote_verify");
}

async function reloadHistoryVerified(reason: string) {
  const requestVersion = ++historyRequestVersion;
  console.info("[HistorySync]", { stage: "reload_started", reason, requestVersion });
  try {
    const data = (await ask(MessageType.GetState)) as {
      active: (Session & { elapsedMs?: number })[];
      sessions: Session[];
    };
    if (requestVersion !== historyRequestVersion) {
      console.info("[HistorySync]", { stage: "reload_discarded", requestVersion, current: historyRequestVersion });
      return;
    }
    const activeIds = (data.active || []).map((a) => a.id);
    const reconciled: Session[] = [];
    for (const s of data.sessions || []) {
      try {
        reconciled.push(await reconcileSessionMp3Status(s));
      } catch {
        reconciled.push(s);
      }
      if (requestVersion !== historyRequestVersion) return;
    }
    if (requestVersion !== historyRequestVersion) return;
    applyHistoryRecords(reconciled, activeIds);
    console.info("[HistorySync]", {
      stage: "verified",
      reason,
      remainingStorageCount: reconciled.length,
      remainingUiCount: historyRecords.length
    });
  } catch (e) {
    console.warn("[HistorySync] reload failed", reason, e);
  }
}

function friendlyError(msg: string) {
  if (/EXTENSION_CONTEXT|不是从浏览器扩展|存储功能不可用|CHROME_STORAGE/i.test(msg)) {
    return "浏览器扩展存储功能不可用，请重新加载插件后重试。";
  }
  if (/NotAllowed|Permission|权限/i.test(msg)) return "没有声音设备权限，请在浏览器地址栏的权限设置中允许麦克风访问。";
  if (/NotFound/i.test(msg)) return "没有找到可用的声音设备。";
  if (/NotReadable|Could not start/i.test(msg)) return "设备无法打开，可能被其他程序占用。";
  if (/Overconstrained|device not found/i.test(msg)) return "所选设备已断开，请重新选择。";
  return msg;
}

function setStatus(text: string) {
  $("status").textContent = text;
}

type ConfirmOptions = {
  title: string;
  body: string;
  cancelText: string;
  okText: string;
  danger?: boolean;
};

function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  const modal = $("confirmModal");
  $("confirmTitle").textContent = opts.title;
  $("confirmBody").textContent = opts.body;
  const cancel = $<HTMLButtonElement>("confirmCancel");
  const ok = $<HTMLButtonElement>("confirmOk");
  cancel.textContent = opts.cancelText;
  ok.textContent = opts.okText;
  ok.className = opts.danger ? "btn danger solid small" : "btn danger outline small";
  modal.classList.remove("hidden");
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      modal.classList.add("hidden");
      cancel.onclick = null;
      ok.onclick = null;
      resolve(value);
    };
    cancel.onclick = () => finish(false);
    ok.onclick = () => finish(true);
  });
}

function currentBitrate() {
  return resolveBitrate(Number($<HTMLSelectElement>("bitrate").value) || settings.defaultBitrate || DEFAULT_BITRATE);
}

function fillBitrates() {
  const bitrate = $<HTMLSelectElement>("bitrate");
  const def = $<HTMLSelectElement>("defaultBitrate");
  bitrate.replaceChildren(...BITRATE_PRESETS.map((o) => new Option(o.label, String(o.bitrate))));
  def.replaceChildren(...BITRATE_PRESETS.map((o) => new Option(o.label, String(o.bitrate))));
  const chosen = resolveBitrate(settings.defaultBitrate || DEFAULT_BITRATE);
  bitrate.value = String(chosen);
  def.value = String(chosen);
  updateBitrateCard();
}

function updateBitrateCard() {
  const v = currentBitrate();
  const opt = getBitratePreset(v);
  $("bitrateTitle").textContent = opt.shortTitle;
  $("bitrateDesc").textContent = opt.shortDescription;
  const elapsedMs = recording && startedAt ? Date.now() - startedAt : 0;
  $("bitrateSize").textContent =
    elapsedMs > 5_000
      ? `当前约 ${estimateMp3Mb(v, elapsedMs).toFixed(1)} MB · 约${opt.estimatedMbPerHour} MB/小时`
      : `约${opt.estimatedMbPerHour} MB/小时`;
  const badge = $("bitrateBadge");
  badge.textContent = opt.badge;
  badge.className = `bitrate-badge${opt.warning ? " warn" : opt.recommend ? " recommend" : ""}`;
  const warn = $("bitrateWarn");
  if (opt.warning) {
    warn.textContent = opt.warning;
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
  }
  $("bitrateTip").textContent = opt.recommend || opt.tip || "";
  $("bitrateSuitable").textContent = opt.suitableFor.join("、");
  $("bitrateDetailText").textContent = opt.detailedDescription;
  if (opt.notSuitableFor?.length) {
    $("bitrateUnsuitableRow").classList.remove("hidden");
    $("bitrateUnsuitable").textContent = opt.notSuitableFor.join("、");
  } else {
    $("bitrateUnsuitableRow").classList.add("hidden");
  }
}

async function persistBitrate(bitrate: number) {
  settings.defaultBitrate = resolveBitrate(bitrate);
  await ask(MessageType.SaveSettings, { ...settings });
}

function renderDevices(list: MediaDeviceInfo[]) {
  const select = $<HTMLSelectElement>("device");
  const previous = select.value || settings.defaultDeviceId || "";
  select.replaceChildren(
    ...list.map((d, i) => new Option(d.label?.trim() || `声音设备 ${i + 1}`, d.deviceId))
  );
  if (list.some((d) => d.deviceId === previous)) select.value = previous;
  else if (list[0]) select.value = list[0].deviceId;
  const needsAuth = list.length === 0 || list.some((d) => !d.label?.trim());
  $("permCard").classList.toggle("hidden", !needsAuth || list.some((d) => !!d.label?.trim()));
  if (list.length && list.every((d) => !d.label?.trim())) $("permCard").classList.remove("hidden");
  if (!list.length) {
    $("permCard").classList.remove("hidden");
    $("deviceMsg").textContent = "未发现可录制设备。";
  } else if (list.some((d) => !d.label?.trim())) {
    $("deviceMsg").textContent = "";
  } else {
    $("deviceMsg").textContent = "";
    $("permCard").classList.add("hidden");
  }
  $<HTMLButtonElement>("start").disabled = recording || busy || !list.length;
}

async function refreshDevices() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error("当前浏览器不支持设备枚举");
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    renderDevices(devices);
    if (!recording) await startPreview();
  } catch (e) {
    $("deviceMsg").textContent = friendlyError(e instanceof Error ? e.message : String(e));
  }
}

async function requestPermission() {
  let stream: MediaStream | undefined;
  try {
    $("deviceMsg").textContent = "正在请求权限…";
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    await refreshDevices();
    $("deviceMsg").textContent = "";
  } catch (e) {
    $("deviceMsg").textContent = friendlyError(e instanceof Error ? e.message : String(e));
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

async function stopPreview() {
  preview?.monitor.stop();
  preview?.stream.getTracks().forEach((t) => t.stop());
  preview = undefined;
}

async function startPreview() {
  if (recording || busy) return;
  await stopPreview();
  resetWaveform($("liveMonitor"));
  setWaveformMode("preview");
  const deviceId = $<HTMLSelectElement>("device").value;
  if (!deviceId) return;
  const label = devices.find((d) => d.deviceId === deviceId)?.label || "声音设备";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
      video: false
    });
    // If recording started while getUserMedia was pending, release immediately.
    if (recording || busy) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const monitor = new StreamLevelMonitor("preview", "test", label, stream);
    monitor.setSensitivity(settings.detectionSensitivity || "standard");
    monitor.onUpdate((u) => {
      if (recording || getRecordingFlag()) return;
      applyLevelUpdate($("liveMonitor"), u);
    });
    monitor.start();
    preview = { stream, monitor };
    setWaveformMode("preview");
  } catch (e) {
    $("deviceMsg").textContent = friendlyError(e instanceof Error ? e.message : String(e));
    setWaveformMode("error");
  }
}

function getRecordingFlag() {
  return recording;
}

function recordingLabel(s: Session): string {
  const rs = s.recordingStatus || (s.status === "completed" ? "completed" : s.status);
  if (rs === "recording" || rs === "starting" || rs === "paused") return "正在录音";
  if (rs === "interrupted" || s.historyStatus === "interrupted" || s.historyStatus === "partial") {
    return s.safeDurationMs > 0 ? "录音已保存（部分）" : "异常中断";
  }
  if (rs === "completed" || s.status === "completed") return "录音已保存";
  if (rs === "error") return "录音异常";
  return String(rs);
}

function originalLabel(s: Session): string {
  switch (s.originalStatus) {
    case "available":
      return "可下载";
    case "download_failed":
      return "自动下载未启动";
    case "missing":
      return "缺失";
    case "pending":
      return "准备中";
    default:
      return s.safeDurationMs > 0 ? "可下载" : "—";
  }
}

function mp3Label(s: Session): string {
  switch (s.mp3Status) {
    case "queued":
      return "MP3等待生成";
    case "decoding":
    case "encoding":
    case "validating":
      return s.mp3ProgressLabel || `MP3生成中：${s.mp3Progress ?? 0}%`;
    case "completed":
      return "MP3已完成";
    case "failed":
      return "MP3生成失败";
    case "skipped":
      return "未生成MP3";
    case "idle":
    default:
      if (s.hasMp3) return "MP3已完成";
      if (s.historyStatus === "mp3_failed" || s.historyStatus === "mp3_missing" || s.historyStatus === "mp3_corrupted") {
        return s.historyStatus === "mp3_missing" ? "MP3文件缺失" : "MP3生成失败";
      }
      if (s.historyStatus === "processing_mp3") return "MP3生成中";
      return "—";
  }
}

function historyLabel(s: Session) {
  // Prefer split statuses for display title.
  if (s.recordingStatus === "completed" || s.status === "completed") {
    if (s.mp3Status === "failed" || s.historyStatus === "mp3_failed") return "录音已保存";
    if (s.mp3Status === "queued" || s.mp3Status === "decoding" || s.mp3Status === "encoding") {
      return "录音已保存";
    }
    if (s.hasMp3 || s.mp3Status === "completed") return "已完成";
    return "录音已保存";
  }
  switch (s.historyStatus || s.status) {
    case "recording":
      return "正在录音";
    case "processing_mp3":
    case "exporting":
      return "录音已保存";
    case "mp3_missing":
    case "mp3_corrupted":
    case "mp3_failed":
      return "录音已保存";
    case "partial":
      return "只有部分录音";
    case "interrupted":
      return "异常中断";
    case "completed":
      return "已完成";
    default:
      return recordingLabel(s);
  }
}

function renderHistory(sessions: Session[], activeIds: string[]) {
  const host = $("history");
  host.replaceChildren();
  const list = [...sessions].sort((a, b) => b.startedAt - a.startedAt);
  $("historyEmpty").classList.toggle("hidden", list.length > 0);
  $("historyEmpty").textContent = "暂无录音";
  updateClearHistoryButton();
  for (const s of list) {
    if (activeIds.includes(s.id) && (s.historyStatus === "recording" || s.status === "recording" || s.recordingStatus === "recording")) {
      continue;
    }
    const item = document.createElement("article");
    item.className = "history-item";
    item.dataset.sessionId = s.id;
    if (deletingSessionIds.has(s.id)) item.classList.add("deleting");
    const title = s.displayName || new Date(s.startedAt).toLocaleString();
    const when = new Date(s.startedAt).toLocaleString();
    const dur = fmt(s.durationMs || s.safeDurationMs || 0);
    const size = s.fileSize ? `${(s.fileSize / (1024 * 1024)).toFixed(2)} MB` : "—";
    const rate = formatBitrateHistory(s.bitrate || DEFAULT_BITRATE, s.hasMp3);
    const state = historyLabel(s);
    const isDeleting = deletingSessionIds.has(s.id);
    const mp3Failed =
      s.mp3Status === "failed" ||
      s.historyStatus === "mp3_failed" ||
      s.historyStatus === "mp3_missing" ||
      s.historyStatus === "mp3_corrupted";
    const mp3Busy =
      s.mp3Status === "queued" ||
      s.mp3Status === "decoding" ||
      s.mp3Status === "encoding" ||
      s.mp3Status === "validating" ||
      s.historyStatus === "processing_mp3";
    const canDownloadMp3 = !!s.hasMp3 && s.mp3Status !== "failed" && s.historyStatus !== "mp3_missing";
    const originalOk = s.originalStatus !== "missing" && (s.safeDurationMs > 0 || s.originalStatus === "available");
    item.innerHTML = `
      <h3></h3>
      <div class="history-meta-grid"></div>
      <p class="history-state"></p>
      <div class="history-status-split"></div>
      <p class="history-help"></p>
      <div class="history-actions"></div>`;
    item.querySelector("h3")!.textContent = title;
    item.querySelector(".history-meta-grid")!.innerHTML =
      `<div>时间：${when}</div><div>时长：${dur} · 大小：${size}</div><div>设备：${s.selectedDeviceLabel || "声音设备"}</div><div>音质：${rate}</div>`;
    const stateEl = item.querySelector(".history-state")!;
    stateEl.textContent = isDeleting ? "正在删除…" : state;
    stateEl.className = `history-state ${canDownloadMp3 ? "ok" : mp3Failed ? "warn" : "ok"}`;
    const split = item.querySelector(".history-status-split")!;
    split.innerHTML = `<div>录音状态：${recordingLabel(s)}</div><div>原始录音：${originalLabel(s)}</div><div>MP3：${mp3Label(s)}</div>`;
    const help = item.querySelector(".history-help")!;
    if (isDeleting) {
      help.textContent = "正在删除此录音…";
    } else if (mp3Failed) {
      help.textContent = s.mp3Error || "录音内容仍然安全保留。你可以下载原始录音，或重新生成MP3。";
    } else if (s.originalStatus === "download_failed") {
      help.textContent = s.originalError || "自动下载未启动，请点击下载原始录音。";
    } else if (mp3Busy) {
      help.textContent = "长录音转换可能需要几分钟。你可以继续使用插件或关闭此页面。";
    } else if (s.historyStatus === "interrupted" || s.historyStatus === "partial") {
      help.textContent = "上次异常中断，已保存部分仍然存在。";
    } else {
      help.textContent = "";
    }
    const actions = item.querySelector(".history-actions")!;
    const add = (text: string, cls: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn small ${cls}`;
      b.textContent = text;
      b.dataset.sessionId = s.id;
      b.disabled = isDeleting;
      b.onclick = fn;
      actions.append(b);
      return b;
    };

    const regenerate = async (opts: { forceMono?: boolean; overrideBitrate?: number; label: string }) => {
      if (regeneratingSessions.has(s.id) || deletingSessionIds.has(s.id)) return;
      regeneratingSessions.add(s.id);
      try {
        setStatus(`${opts.label}…`);
        await ask(MessageType.ExportSession, {
          sessionId: s.id,
          download: false,
          force: true,
          forceMono: opts.forceMono ?? (s.bitrate || 0) <= 16000,
          overrideBitrate: opts.overrideBitrate
        });
        setStatus("MP3 已重新生成");
        await reloadHistoryVerified("after_regenerate");
        const dl = await downloadRecordingMp3(s.id, "retry");
        if (dl.ok) setStatus("下载已开始");
        else setStatus(friendlyDownloadError(dl.error.code, dl.error.message));
      } catch (e) {
        setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
        await reloadHistoryVerified("after_regenerate_fail");
      } finally {
        regeneratingSessions.delete(s.id);
      }
    };

    // Original download always available when data exists.
    if (originalOk) {
      add("下载原始录音", "play", () => {
        void (async () => {
          setStatus("正在准备原始录音…");
          try {
            const result = await downloadOriginalRecording(s.id, { trigger: "manual" });
            if (result.ok) setStatus(`原始录音下载已开始：${result.filename || ""}`);
            else setStatus(result.error?.message || "下载原始录音失败");
            await reloadHistoryVerified("after_original_download");
          } catch (e) {
            setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
          }
        })();
      });
    }

    if (canDownloadMp3) {
      add("播放", "play", async () => {
        try {
          stopPlaybackIfSession();
          const result = await getMp3BlobForSession(s.id);
          if (!result.ok) {
            setStatus(friendlyDownloadError(result.error.code, result.error.message));
            await reloadHistoryVerified("after_play_missing");
            return;
          }
          const url = URL.createObjectURL(result.blob);
          const audio = new Audio(url);
          playingAudio = { sessionId: s.id, audio, url };
          audio.onended = () => stopPlaybackIfSession(s.id);
          audio.onerror = () => stopPlaybackIfSession(s.id);
          await audio.play();
        } catch (e) {
          stopPlaybackIfSession(s.id);
          setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
        }
      });
      const dlBtn = add("下载MP3", "download", () => {
        void (async () => {
          if (dlBtn.disabled) return;
          const original = "下载MP3";
          dlBtn.disabled = true;
          dlBtn.textContent = "正在读取……";
          try {
            const result = await downloadRecordingMp3(s.id, "manual");
            if (!result.ok) {
              dlBtn.textContent = "重新下载";
              dlBtn.disabled = false;
              setStatus(friendlyDownloadError(result.error.code, result.error.message));
              await reloadHistoryVerified("after_mp3_download_fail");
              return;
            }
            dlBtn.textContent = "下载已开始";
            setStatus(`下载已开始：${result.filename}`);
            setTimeout(() => {
              dlBtn.textContent = original;
              dlBtn.disabled = false;
            }, 1500);
          } catch (e) {
            dlBtn.textContent = "重新下载";
            dlBtn.disabled = false;
            setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
          }
        })();
      });
    } else if (mp3Busy) {
      add(mp3Label(s), "download", () => setStatus(s.mp3ProgressLabel || "MP3正在后台生成…")).disabled = true;
    } else if (s.mp3Status !== "skipped") {
      add("重新生成MP3", "download", () => void regenerate({ label: "正在重新生成 MP3" }));
      if ((s.bitrate || 0) <= 16000) {
        add("兼容模式重新生成", "play", () =>
          void regenerate({ forceMono: true, label: "正在用 16 kbps 单声道兼容模式重新生成" })
        );
        add("改用32kbps", "play", () =>
          void regenerate({ overrideBitrate: 32000, forceMono: false, label: "正在用 32 kbps 重新生成" })
        );
      }
    }

    if (mp3Failed || s.originalStatus === "download_failed") {
      add("查看说明", "play", () => {
        void showConfirm({
          title: mp3Failed ? "MP3 说明" : "原始下载说明",
          body:
            s.mp3Error ||
            s.originalError ||
            "录音内容仍然安全保留。你可以下载原始录音，或重新生成MP3。",
          cancelText: "关闭",
          okText: "知道了",
          danger: false
        });
      });
    }

    add("删除", "delete", async () => {
      if (deletingSessionIds.has(s.id)) return;
      if (!confirm("确定永久删除这条录音吗？删除后无法恢复。")) return;
      const sessionId = s.id;
      console.info("[HistoryDelete]", { stage: "button_clicked", sessionId });
      deletingSessionIds.add(sessionId);
      renderHistory(historyRecords, historyActiveIds);
      invalidateHistoryReads("delete_started");
      try {
        const result = (await ask(MessageType.DeleteSession, { sessionId })) as {
          ok?: boolean;
          sessionId?: string;
          error?: string;
        };
        const deletedId = result?.sessionId || sessionId;
        console.info("[HistoryDelete]", {
          stage: "storage_deleted",
          uiSessionId: sessionId,
          serviceSessionId: deletedId,
          matched: deletedId === sessionId
        });
        if (result && result.ok === false) {
          throw new Error(result.error || "删除失败");
        }
        deletingSessionIds.delete(sessionId);
        removeSessionsFromUi([deletedId]);
        broadcastHistoryChanged({ operation: "delete", deletedSessionIds: [deletedId] });
        setStatus("录音已删除。");
        await reloadHistoryVerified("after_delete");
      } catch (e) {
        deletingSessionIds.delete(sessionId);
        renderHistory(historyRecords, historyActiveIds);
        setStatus("删除不完整，请重试。" + friendlyError(e instanceof Error ? e.message : String(e)));
      }
    });
    host.append(item);
  }
}

async function refresh() {
  const requestVersion = historyRequestVersion;
  try {
    const data = (await ask(MessageType.GetState)) as {
      active: (Session & { elapsedMs?: number; levels?: AudioLevelUpdate[] })[];
      sessions: Session[];
      settings?: AppSettings;
    };
    if (requestVersion !== historyRequestVersion) {
      console.info("[HistorySync]", {
        stage: "poll_discarded",
        requestVersion,
        current: historyRequestVersion
      });
      return;
    }
    if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
    syncDownloadSettingsUi();
    const sens = $<HTMLSelectElement>("detectionSensitivity");
    if (sens) sens.value = settings.detectionSensitivity || "standard";
    const active = data.active[0];
    if (active) {
      recording = true;
      selectedSession = active.id;
      $<HTMLButtonElement>("start").disabled = true;
      $<HTMLButtonElement>("stop").disabled = false;
      $("safe").textContent = fmt(active.safeDurationMs);
      $("elapsed").textContent = fmt(active.elapsedMs || Date.now() - active.startedAt);
      setStatus("正在录音");
      for (const level of active.levels || []) applyLevelUpdate($("liveMonitor"), level);
      setWaveformMode("recording", active.id);
      await stopPreview();
      updateBitrateCard();
    } else if (!busy) {
      recording = false;
      selectedSession = undefined;
      $<HTMLButtonElement>("start").disabled = !devices.length;
      $<HTMLButtonElement>("stop").disabled = true;
      if ($("status").textContent === "正在录音" || $("status").textContent === "正在启动……") {
        setStatus("准备就绪");
      }
    }
    if (requestVersion !== historyRequestVersion) return;
    const reconciled: Session[] = [];
    for (const s of data.sessions) {
      try {
        reconciled.push(await reconcileSessionMp3Status(s));
      } catch {
        reconciled.push(s);
      }
      if (requestVersion !== historyRequestVersion) return;
    }
    if (requestVersion !== historyRequestVersion) return;
    applyHistoryRecords(reconciled, data.active.map((a) => a.id));
  } catch {
    /* keep UI */
  }
}

async function startRecording() {
  if (busy || recording) return;
  const deviceId = $<HTMLSelectElement>("device").value;
  if (!deviceId) {
    setStatus("请先选择声音设备");
    return;
  }
  if (!devices.some((d) => d.deviceId === deviceId)) {
    setStatus("所选设备已断开，请重新选择。");
    await refreshDevices();
    return;
  }
  const bitrate = currentBitrate();
  if (bitrate === 16000 && !lowQualityShown) {
    $("lowQualityNote").classList.remove("hidden");
    lowQualityShown = true;
    setTimeout(() => $("lowQualityNote").classList.add("hidden"), 4000);
  }
  busy = true;
  $<HTMLButtonElement>("start").disabled = true;
  $<HTMLButtonElement>("start").textContent = "正在启动……";
  setStatus("正在启动……");
  try {
    // Release dashboard preview stream before offscreen opens the same device.
    await stopPreview();
    setWaveformMode("recording");
    await new Promise((r) => setTimeout(r, 120));
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.usage != null && estimate.usage / estimate.quota > 0.92) {
      throw new Error("本地存储空间不足，请先删除旧录音。");
    }
    const deviceLabel = devices.find((d) => d.deviceId === deviceId)?.label || "声音设备";
    const session = (await ask(MessageType.StartRecording, {
      mode: "device",
      deviceId,
      deviceLabel,
      displayName: $<HTMLInputElement>("recName").value.trim(),
      bitrate,
      mixed: false
    })) as Session;
    selectedSession = session.id;
    recording = true;
    setWaveformMode("recording", session.id);
    startedAt = Date.now();
    $<HTMLButtonElement>("stop").disabled = false;
    $<HTMLButtonElement>("start").textContent = "开始录音";
    setStatus("正在录音");
    await ask(MessageType.SubscribeLevels);
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = setInterval(() => {
      $("elapsed").textContent = fmt(Date.now() - startedAt);
      updateBitrateCard();
    }, 250);
    await persistBitrate(bitrate);
  } catch (e) {
    recording = false;
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
    $<HTMLButtonElement>("start").disabled = !devices.length;
    await startPreview();
  } finally {
    busy = false;
    $<HTMLButtonElement>("start").textContent = "开始录音";
  }
}

async function stopRecording() {
  if (!selectedSession || busy) return;
  busy = true;
  $<HTMLButtonElement>("stop").disabled = true;
  setStatus("正在结束录音……");
  try {
    const id = selectedSession;
    setStatus("正在保存最后一段录音……");
    const result = (await ask(MessageType.StopRecording, { sessionId: id })) as {
      mode?: StopDownloadMode;
      originalDownload?: { ok?: boolean; filename?: string; error?: { message?: string } } | null;
      mp3Queued?: boolean;
    };
    if (elapsedTimer) clearInterval(elapsedTimer);
    removeSessionMeters(id);
    recording = false;
    selectedSession = undefined;
    setWaveformMode("preview");
    $("elapsed").textContent = "00:00";

    const mode = result?.mode || settings.stopDownloadMode || "original_then_mp3";
    if (mode === "mp3_only") {
      setStatus("已完成（已按设置等待 MP3）");
    } else {
      setStatus("录音已经安全保存，正在准备下载……");
      const od = result?.originalDownload;
      if (od?.ok) {
        setStatus(
          result?.mp3Queued
            ? "原始录音下载已开始。MP3正在后台生成，你可以继续使用插件或关闭此页面。"
            : "原始录音下载已开始。"
        );
      } else if (od && od.ok === false) {
        setStatus(od.error?.message || "自动下载未启动，请在历史记录中点击下载原始录音。");
      } else {
        setStatus(
          result?.mp3Queued
            ? "录音已停止。MP3将在后台生成。"
            : "录音已停止，原始录音已安全保存。"
        );
      }
    }

    await startPreview();
    await refresh();
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  } finally {
    busy = false;
    $<HTMLButtonElement>("start").disabled = !devices.length;
    $<HTMLButtonElement>("stop").disabled = true;
  }
}

function stopDownloadModeHint(mode: StopDownloadMode): string {
  if (mode === "original_only") return "最快，不进行MP3转换。";
  if (mode === "mp3_only") return "等待时间较长，长录音可能失败，不推荐。";
  return "最安全。停止后马上取得录音，MP3完成后再自动下载。";
}

function syncDownloadSettingsUi() {
  const mode = (settings.stopDownloadMode || "original_then_mp3") as StopDownloadMode;
  const modeEl = $<HTMLSelectElement>("stopDownloadMode");
  if (modeEl) modeEl.value = mode;
  const hint = $("stopDownloadModeHint");
  if (hint) hint.textContent = stopDownloadModeHint(mode);
  const autoOrig = $<HTMLInputElement>("autoDownloadOriginal");
  if (autoOrig) autoOrig.checked = settings.autoDownloadOriginal !== false;
  $<HTMLInputElement>("autoDownload").checked =
    settings.autoDownloadMp3AfterSuccess !== false && settings.autoDownloadMp3 !== false;
  const keep = $<HTMLInputElement>("keepOriginalAfterMp3");
  if (keep) keep.checked = settings.keepOriginalAfterMp3 !== false;
}

async function persistDownloadSettings() {
  await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
}

$("refresh").onclick = () => void refreshDevices();
$("permission").onclick = () => void requestPermission();
$("bitrate").onchange = async () => {
  updateBitrateCard();
  await persistBitrate(currentBitrate());
};
$("bitrateDetailsToggle").onclick = () => {
  const panel = $("bitrateDetails");
  const open = !panel.classList.toggle("hidden");
  $("bitrateDetailsToggle").textContent = open ? "收起详细说明" : "查看详细说明";
};
$("device").onchange = () => void startPreview();
$("start").onclick = () => void startRecording();
$("stop").onclick = () => void stopRecording();
$("settingsBtn").onclick = () => $("settingsPanel").classList.toggle("hidden");
$("helpBtn").onclick = () => void openHelpOrAsk();
$("helpDevicesLink").onclick = () => void openHelpOrAsk("devices");
$("helpBitrateLink").onclick = () => void openHelpOrAsk("bitrate");
$("onboardingOpenHelp").onclick = () => void openHelpOrAsk("quickstart");
$("onboardingDismiss").onclick = async () => {
  settings.onboardingDismissed = true;
  $("onboardingCard").classList.add("hidden");
  await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
};
$("showOnboardingAgain").onclick = async () => {
  settings.onboardingDismissed = false;
  $("onboardingCard").classList.remove("hidden");
  await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
};

async function openHelpOrAsk(hash = "") {
  try {
    await openHelpPage(hash);
  } catch {
    await ask(MessageType.OpenHelp, { hash }).catch((e) => setStatus(String(e.message || e)));
  }
}

function syncOnboardingCard() {
  const show = settings.onboardingDismissed !== true;
  $("onboardingCard").classList.toggle("hidden", !show);
}

$("autoDownload").onchange = async () => {
  settings.autoDownloadMp3 = $<HTMLInputElement>("autoDownload").checked;
  settings.autoDownloadMp3AfterSuccess = $<HTMLInputElement>("autoDownload").checked;
  await persistDownloadSettings();
};
$("autoDownloadOriginal").onchange = async () => {
  settings.autoDownloadOriginal = $<HTMLInputElement>("autoDownloadOriginal").checked;
  await persistDownloadSettings();
};
$("keepOriginalAfterMp3").onchange = async () => {
  settings.keepOriginalAfterMp3 = $<HTMLInputElement>("keepOriginalAfterMp3").checked;
  await persistDownloadSettings();
};
$("stopDownloadMode").onchange = async () => {
  const mode = $<HTMLSelectElement>("stopDownloadMode").value as StopDownloadMode;
  settings.stopDownloadMode = mode;
  if (mode === "original_only") {
    settings.autoDownloadOriginal = true;
    settings.autoDownloadMp3AfterSuccess = false;
    settings.autoDownloadMp3 = false;
  } else if (mode === "mp3_only") {
    settings.autoDownloadOriginal = false;
    settings.autoDownloadMp3AfterSuccess = true;
    settings.autoDownloadMp3 = true;
  } else {
    settings.autoDownloadOriginal = true;
    settings.autoDownloadMp3AfterSuccess = true;
    settings.autoDownloadMp3 = true;
  }
  syncDownloadSettingsUi();
  await persistDownloadSettings();
};
$("detectionSensitivity").onchange = async () => {
  const v = $<HTMLSelectElement>("detectionSensitivity").value;
  settings.detectionSensitivity =
    v === "sensitive" || v === "stable" ? v : "standard";
  await ask(MessageType.SaveSettings, { ...settings });
  if (!recording) await startPreview();
};
$("defaultBitrate").onchange = async () => {
  settings.defaultBitrate = resolveBitrate(Number($<HTMLSelectElement>("defaultBitrate").value));
  $<HTMLSelectElement>("bitrate").value = String(settings.defaultBitrate);
  updateBitrateCard();
  await ask(MessageType.SaveSettings, { ...settings });
};
$("clearHistory").onclick = async () => {
  if (clearingHistory) return;
  const first = await showConfirm({
    title: "确定要清空全部录音历史吗？",
    body: "这将永久删除所有已完成、异常中断和MP3生成失败的录音数据，删除后无法恢复。",
    cancelText: "取消",
    okText: "继续清空",
    danger: true
  });
  if (!first) return;
  const second = await showConfirm({
    title: "请再次确认：永久删除全部录音？",
    body: "此操作不可撤销。只有确认后才会开始删除。",
    cancelText: "返回",
    okText: "永久删除全部录音",
    danger: true
  });
  if (!second) return;

  const runClear = async (onlySafe: boolean) => {
    clearingHistory = true;
    updateClearHistoryButton();
    console.info("[HistoryClear]", { stage: "started", uiRecordCount: historyRecords.length });
    invalidateHistoryReads("clear_started");
    try {
      const result = (await ask(MessageType.ClearAllHistory, {
        confirm: "DELETE_ALL",
        onlySafe
      })) as {
        success: boolean;
        deletedSessionIds?: string[];
        skippedSessionIds?: string[];
        failedSessions?: { sessionId: string; message: string }[] | number;
        deletedSessions: number;
        skippedSessions: number;
        failedCount?: number;
        reclaimedBytes: number;
        partialFailure: boolean;
      };

      const deletedIds = result.deletedSessionIds || [];
      const failedCount =
        result.failedCount ??
        (typeof result.failedSessions === "number"
          ? result.failedSessions
          : Array.isArray(result.failedSessions)
            ? result.failedSessions.length
            : 0);
      console.info("[HistoryClear]", {
        stage: "storage_completed",
        deletedSessionIds: deletedIds,
        failedCount
      });

      removeSessionsFromUi(deletedIds);
      console.info("[HistoryClear]", {
        stage: "ui_state_updated",
        remainingUiCount: historyRecords.length
      });
      broadcastHistoryChanged({ operation: "clear", deletedSessionIds: deletedIds });

      const skipped = result.skippedSessions || result.skippedSessionIds?.length || 0;

      if (failedCount > 0) {
        setStatus(`已删除${deletedIds.length}条录音，${failedCount}条未能删除。`);
      } else if (skipped > 0) {
        setStatus(
          `已清除可安全删除的历史 ${deletedIds.length} 条，保留处理中 ${skipped} 条（约 ${(result.reclaimedBytes / (1024 * 1024)).toFixed(1)} MB）。`
        );
      } else if (deletedIds.length === 0) {
        setStatus("没有可删除的录音历史。");
      } else {
        setStatus("已清空全部录音历史。");
      }

      await reloadHistoryVerified("after_clear");
      return result;
    } catch (e) {
      setStatus("清空失败，录音历史没有被删除。" + friendlyError(e instanceof Error ? e.message : String(e)));
      await reloadHistoryVerified("after_clear_fail");
      throw e;
    } finally {
      clearingHistory = false;
      updateClearHistoryButton();
    }
  };

  try {
    const busyCount = historyRecords.filter((s) => {
      if (historyActiveIds.includes(s.id)) return true;
      return (
        s.historyStatus === "recording" ||
        s.recordingStatus === "recording" ||
        s.status === "recording"
      );
    }).length;
    if (busyCount > 0) {
      const onlySafe = await showConfirm({
        title: "当前有录音或音频正在处理中，无法全部清空。",
        body: `检测到 ${busyCount} 条正在录音或处理中的记录将被保留。可选择只清除其余可安全删除的历史。`,
        cancelText: "取消",
        okText: "只清除可安全删除的历史",
        danger: true
      });
      if (!onlySafe) return;
      await runClear(true);
      return;
    }
    await runClear(true);
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  }
};
$("clearAll").onclick = () => void $("clearHistory").click();


chrome.runtime.onMessage.addListener((msg: AudioLevelUpdate | Request) => {
  if (msg && "type" in msg && msg.type === MessageType.RecordingHistoryChanged) {
    const ids = (msg.payload?.deletedSessionIds as string[] | undefined) || [];
    applyRemoteHistoryChange(ids);
    return;
  }
  if (!msg || !("type" in msg) || msg.type !== MessageType.AudioLevelUpdate) return;
  if (!recording) return;
  const level = msg as AudioLevelUpdate;
  if (level.sessionId === "preview" || level.sessionId === "test") return;
  applyLevelUpdate($("liveMonitor"), level);
});

if (historyChannel) {
  historyChannel.onmessage = (ev: MessageEvent) => {
    const data = ev.data as { deletedSessionIds?: string[]; operation?: string } | undefined;
    if (!data?.deletedSessionIds) return;
    applyRemoteHistoryChange(data.deletedSessionIds);
  };
}

navigator.mediaDevices?.addEventListener("devicechange", () => void refreshDevices());
window.addEventListener("beforeunload", () => {
  void stopPreview();
  void ask(MessageType.UnsubscribeLevels).catch(() => undefined);
});

ensureMeterHost($("liveMonitor"));
fillBitrates();
installDownloadLifecycleListeners();

function showEnvFatal(message: string) {
  const banner = document.createElement("div");
  banner.className = "env-fatal";
  banner.textContent = message;
  document.body.prepend(banner);
  $<HTMLButtonElement>("start").disabled = true;
  $<HTMLButtonElement>("stop").disabled = true;
  setStatus(message);
  console.error("[SafeCallRecorder] env check failed", diagnoseStorageEnvironment());
}

void (async () => {
  if (!isExtensionContext()) {
    showEnvFatal("当前页面不是从浏览器扩展中打开的。请在扩展管理页加载 dist 目录，然后点击扩展图标打开。");
    return;
  }
  try {
    settings = await getSettings();
  } catch (e) {
    console.warn("[SafeCallRecorder] settings load failed, using defaults", e, diagnoseStorageEnvironment());
    settings = { ...DEFAULT_SETTINGS };
    setStatus("读取扩展设置失败，已使用默认设置。");
  }
  fillBitrates();
  await refreshDevices();
  await ask(MessageType.SubscribeLevels).catch(() => undefined);
  await refresh();
  syncOnboardingCard();
  if (new URLSearchParams(location.search).get("openSettings") === "1") {
    $("settingsPanel").classList.remove("hidden");
  }
})();
setInterval(() => void refresh(), 2000);
