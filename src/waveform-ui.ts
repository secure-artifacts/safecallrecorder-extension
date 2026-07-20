import { AudioLevelConfig } from "./audio-level-config";
import { AudioVisualizationConfig } from "./audio-visualization-config";
import { AudioDisplaySmoother } from "./audio-display-smoother";
import { volumeBadge } from "./audio-level-analyser";
import type { AudioLevelUpdate } from "./stream-level-monitor";

export type WaveformMode = "idle" | "preview" | "recording" | "disconnected" | "error";

type UiState = {
  title: string;
  badge: string;
  detail: string;
  tone: "ok" | "warn" | "danger" | "";
  live: string;
  liveOn: boolean;
};

interface MeterView {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  title: HTMLElement;
  status: HTMLElement;
  volume: HTMLElement;
  peak: HTMLElement;
  liveDot: HTMLElement;
  liveText: HTMLElement;
  levelBadge: HTMLElement;
  lastUpdate: number;
  target: number[];
  display: number[];
  soundState: string;
  hasSound: boolean;
  isClipping: boolean;
  isNearClipping: boolean;
  destroyed: boolean;
  lastVolumeText: string;
  lastPeakText: string;
  lastStatusKey: string;
}

const INSTANCE_ID = `wf_${Math.random().toString(36).slice(2, 9)}`;
let hostEl: HTMLElement | undefined;
let view: MeterView | undefined;
let mode: WaveformMode = "idle";
let raf = 0;
let frameSkip = 0;
let sourceSessionId: string | undefined;
const displaySmoother = new AudioDisplaySmoother(AudioVisualizationConfig.waveformPoints);

function log(action: string, extra: Record<string, unknown> = {}) {
  console.info("[Waveform]", { action, instanceId: INSTANCE_ID, source: mode, ...extra });
}

function flatIdle(n = AudioVisualizationConfig.waveformPoints) {
  return Array.from({ length: n }, () => AudioVisualizationConfig.idleBarHeight);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function resizeCanvas(m: MeterView) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.max(240, m.canvas.clientWidth || m.root.clientWidth || 640);
  const cssH = Math.max(120, m.canvas.clientHeight || 140);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (m.canvas.width !== w || m.canvas.height !== h) {
    m.canvas.width = w;
    m.canvas.height = h;
  }
}

function resolveUi(update: AudioLevelUpdate | null, stale: boolean): UiState {
  if (stale || mode === "disconnected") {
    return {
      title: "声音监测已断开",
      badge: "监测中断",
      detail: "正在尝试重新连接设备。",
      tone: "warn",
      live: "监测中断",
      liveOn: false
    };
  }
  if (mode === "error") {
    return {
      title: "声音监测异常",
      badge: "错误",
      detail: "请重新选择设备或刷新页面。",
      tone: "danger",
      live: "异常",
      liveOn: false
    };
  }
  if (!update) {
    return {
      title: "实时音浪",
      badge: "等待声音",
      detail: "选择设备后将显示实时音浪。",
      tone: "",
      live: "等待声音",
      liveOn: false
    };
  }

  if (update.soundState === "disconnected") {
    return {
      title: update.liveText || "监测已断开",
      badge: update.badge || "设备断开",
      detail: update.detail || "正在尝试重新连接设备。",
      tone: "danger",
      live: update.liveText || "监测已断开",
      liveOn: false
    };
  }
  if (update.soundState === "unavailable") {
    return {
      title: update.liveText || "监测异常",
      badge: update.badge || "不可用",
      detail: update.detail || update.soundLabel || "请重新选择声音设备。",
      tone: "warn",
      live: update.liveText || "监测异常",
      liveOn: false
    };
  }
  if (update.soundState === "clipping") {
    return {
      title: "检测到削波",
      badge: update.badge || "音量过大",
      detail: update.detail || "请降低设备音量，避免失真。",
      tone: "danger",
      live: "检测到声音",
      liveOn: true
    };
  }
  if (update.soundState === "silent") {
    return {
      title: "当前没有声音",
      badge: update.badge || "无声音",
      detail: update.detail || "请检查 VoiceMeeter 路由或设备音量。",
      tone: "warn",
      live: "当前没有声音",
      liveOn: false
    };
  }
  if (update.soundState === "low_volume") {
    return {
      title: "声音较小",
      badge: update.badge || "声音较小",
      detail: update.detail || "可以录制，但音量偏低。",
      tone: "",
      live: "检测到声音",
      liveOn: true
    };
  }
  // has_sound and any other sound-holding states — never use instantaneous hasSound here.
  return {
    title: "检测到声音",
    badge: update.badge || volumeBadge(update) || "声音正常",
    detail:
      update.detail ||
      (mode === "recording" ? "设备声音正常，正在录音。" : "设备中有声音，可以开始录音。"),
    tone: "ok",
    live: update.liveText || "检测到声音",
    liveOn: true
  };
}

function applyUi(m: MeterView, ui: UiState, deviceLabel?: string) {
  m.liveText.textContent = ui.live;
  m.liveDot.classList.toggle("on", ui.liveOn);
  m.levelBadge.textContent = ui.badge;
  m.levelBadge.dataset.level = ui.badge;
  m.title.textContent = deviceLabel || "声音设备";
  m.status.textContent = `${ui.title} · ${ui.detail}`;
  m.status.className = `meter-status${ui.tone ? ` ${ui.tone}` : ""}`;
}

function ensureSingleView(host: HTMLElement): MeterView {
  if (view && !view.destroyed && host.contains(view.root)) return view;

  // Hard reset: never allow multiple meter cards in the host.
  host.replaceChildren();
  host.classList.add("live-monitor");
  host.innerHTML = `
    <article class="meter-card" id="mainWaveformCard" data-waveform-instance="${INSTANCE_ID}">
      <div class="meter-head">
        <div class="meter-live"><span class="live-dot"></span><span class="live-text">等待声音</span></div>
        <span class="meter-level-badge">等待声音</span>
      </div>
      <p class="meter-title">声音设备</p>
      <div class="meter-canvas-wrap"><canvas id="main-waveform"></canvas></div>
      <div class="meter-stats">
        <span class="meter-volume">当前音量：0%</span>
        <span class="meter-peak">峰值：0%</span>
      </div>
      <p class="meter-status">选择设备后将显示实时音浪。</p>
    </article>`;

  const root = host.querySelector("#mainWaveformCard") as HTMLElement;
  const canvas = host.querySelector("#main-waveform") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") || ({
    fillRect() {},
    fill() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    closePath() {},
    arcTo() {},
    save() {},
    restore() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    shadowColor: "",
    shadowBlur: 0
  } as unknown as CanvasRenderingContext2D);
  view = {
    root,
    canvas,
    ctx,
    title: root.querySelector(".meter-title")!,
    status: root.querySelector(".meter-status")!,
    volume: root.querySelector(".meter-volume")!,
    peak: root.querySelector(".meter-peak")!,
    liveDot: root.querySelector(".live-dot")!,
    liveText: root.querySelector(".live-text")!,
    levelBadge: root.querySelector(".meter-level-badge")!,
    lastUpdate: Date.now(),
    target: flatIdle(),
    display: flatIdle(),
    soundState: "silent",
    hasSound: false,
    isClipping: false,
    isNearClipping: false,
    destroyed: false,
    lastVolumeText: "当前音量：0%",
    lastPeakText: "峰值：0%",
    lastStatusKey: ""
  };
  displaySmoother.reset();
  hostEl = host;
  log("mount", { deviceId: "", sessionId: sourceSessionId || "" });
  if (!raf) raf = requestAnimationFrame(drawLoop);
  return view;
}

export function ensureMeterHost(host: HTMLElement) {
  ensureSingleView(host);
}

export function setWaveformMode(next: WaveformMode, sessionId?: string) {
  mode = next;
  if (sessionId !== undefined) sourceSessionId = sessionId;
  log("mode", { mode, sessionId: sourceSessionId || "" });
}

export function getWaveformMode() {
  return mode;
}

export function countWaveformCards(host: HTMLElement = hostEl || document.getElementById("liveMonitor")!) {
  if (!host) return 0;
  return host.querySelectorAll(".meter-card").length;
}

export function applyLevelUpdate(host: HTMLElement, update: AudioLevelUpdate) {
  const m = ensureSingleView(host);
  if (m.destroyed) return;

  // Ignore stale preview packets once recording has taken over (and vice versa).
  if (mode === "recording" && update.sessionId === "preview") return;
  if (mode === "preview" && update.sessionId !== "preview" && update.sessionId !== "test") return;

  const now = Date.now();
  m.lastUpdate = now;

  const snap = displaySmoother.push({
    rms: update.rms,
    peak: update.peak,
    waveform: update.waveform,
    now
  });
  m.target = snap.waveformTarget;
  if (m.display.length !== m.target.length) m.display = m.target.slice();

  m.soundState = update.soundState;
  m.hasSound = update.hasSound;
  m.isClipping = update.isClipping;
  m.isNearClipping = update.isNearClipping;
  sourceSessionId = update.sessionId;

  if (snap.volumeChanged) {
    const text = `当前音量：${snap.volumePercent}%`;
    if (text !== m.lastVolumeText) {
      m.volume.textContent = text;
      m.lastVolumeText = text;
    }
  }
  if (snap.peakChanged) {
    const text = `峰值：${snap.peakPercent}%`;
    if (text !== m.lastPeakText) {
      m.peak.textContent = text;
      m.lastPeakText = text;
    }
  }

  const ui = resolveUi(update, false);
  const statusKey = `${ui.live}|${ui.badge}|${ui.detail}|${update.sourceLabel}`;
  if (statusKey !== m.lastStatusKey) {
    applyUi(m, ui, update.sourceLabel);
    m.lastStatusKey = statusKey;
  }
}

/** Remove all meters and recreate the single idle card. Does not change mode by itself. */
export function resetWaveform(host: HTMLElement) {
  if (view) {
    log("unmount", { sessionId: sourceSessionId || "" });
    view.destroyed = true;
    view = undefined;
  }
  sourceSessionId = undefined;
  displaySmoother.reset();
  ensureSingleView(host);
  const m = view!;
  applyUi(m, resolveUi(null, false));
  m.volume.textContent = "当前音量：0%";
  m.peak.textContent = "峰值：0%";
  m.lastVolumeText = m.volume.textContent;
  m.lastPeakText = m.peak.textContent;
  m.lastStatusKey = "";
}

/** @deprecated Use resetWaveform — kept for call-site compatibility. */
export function clearTestMeters(host: HTMLElement) {
  if (mode === "recording") {
    // Do not wipe the live recording card when clearing preview leftovers.
    return;
  }
  resetWaveform(host);
}

/** @deprecated Use resetWaveform / setWaveformMode — single card never needs per-session DOM nodes. */
export function removeSessionMeters(_sessionId: string) {
  // No-op for multi-card cleanup: single card is reused.
  log("removeSessionMeters_noop", { sessionId: _sessionId });
}

function smoothBars(m: MeterView) {
  m.display = displaySmoother.interpolateBars(m.display, m.target);
}

function drawMirroredBars(m: MeterView, stale: boolean) {
  if (!m.ctx) return;
  resizeCanvas(m);
  const { ctx, canvas } = m;
  if (!ctx || !canvas.width || !canvas.height) return;
  const w = canvas.width;
  const h = canvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#e0f2fe");
  bg.addColorStop(0.5, "#eef2ff");
  bg.addColorStop(1, "#f3e8ff");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const padX = 14 * dpr;
  const padY = 12 * dpr;
  const midY = h / 2;
  const bars = m.display.length ? m.display : [AudioVisualizationConfig.idleBarHeight];
  const n = bars.length;
  const gap = Math.max(1.2 * dpr, ((w - padX * 2) / n) * 0.22);
  const totalGap = gap * (n - 1);
  const barW = Math.max(2 * dpr, (w - padX * 2 - totalGap) / n);
  const maxHalf = (h - padY * 2) / 2;
  const minHalf = AudioVisualizationConfig.minimumBarHeightPx * dpr;

  ctx.save();
  ctx.shadowColor = stale ? "rgba(148,163,184,0.25)" : "rgba(56,189,248,0.35)";
  ctx.shadowBlur = 10 * dpr;

  const grad = ctx.createLinearGradient(padX, 0, w - padX, 0);
  if (stale) {
    grad.addColorStop(0, "#94a3b8");
    grad.addColorStop(1, "#cbd5e1");
  } else if (m.isClipping || m.soundState === "clipping") {
    grad.addColorStop(0, "#fb7185");
    grad.addColorStop(0.5, "#f97316");
    grad.addColorStop(1, "#ef4444");
  } else if (m.isNearClipping) {
    grad.addColorStop(0, "#2dd4bf");
    grad.addColorStop(0.45, "#38bdf8");
    grad.addColorStop(1, "#f97316");
  } else {
    grad.addColorStop(0, "#2dd4bf");
    grad.addColorStop(0.45, "#38bdf8");
    grad.addColorStop(1, "#a855f7");
  }

  for (let i = 0; i < n; i++) {
    const amp = Math.max(0, Math.min(1, bars[i] ?? 0));
    const half = Math.max(minHalf, amp * maxHalf);
    const x = padX + i * (barW + gap);
    const y = midY - half;
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, barW, half * 2, Math.min(barW / 2, 5 * dpr));
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.lineWidth = Math.max(1, dpr * 0.8);
  ctx.beginPath();
  ctx.moveTo(padX, midY);
  ctx.lineTo(w - padX, midY);
  ctx.stroke();
}

function drawLoop() {
  const hidden = typeof document !== "undefined" && document.hidden;
  if (hidden) {
    frameSkip = (frameSkip + 1) % 3;
    if (frameSkip !== 0) {
      raf = requestAnimationFrame(drawLoop);
      return;
    }
  } else {
    frameSkip = 0;
  }

  const m = view;
  if (m && !m.destroyed) {
    const age = Date.now() - m.lastUpdate;
    const stale = age > AudioLevelConfig.monitorStaleMs && mode !== "idle";
    if (stale) {
      m.target = m.target.map((v) => v * 0.92 + AudioVisualizationConfig.idleBarHeight * 0.08);
      const ui = resolveUi(null, true);
      const key = `${ui.live}|${ui.badge}|stale`;
      if (key !== m.lastStatusKey) {
        applyUi(m, ui, m.title.textContent || undefined);
        m.lastStatusKey = key;
      }
    }
    smoothBars(m);
    drawMirroredBars(m, stale);
  }
  raf = requestAnimationFrame(drawLoop);
}

export function setCountdown(host: HTMLElement, text: string) {
  ensureSingleView(host);
  let el = host.querySelector("#testCountdown") as HTMLElement | null;
  if (!el) {
    el = document.createElement("p");
    el.id = "testCountdown";
    el.className = "test-countdown";
    host.prepend(el);
  }
  el.textContent = text;
}

/** Test helper */
export function __waveformTestState() {
  return { instanceId: INSTANCE_ID, mode, hasView: !!view, cardCount: view ? 1 : 0 };
}
