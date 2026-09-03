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
  isExtensionContext,
  setSettings
} from "./extension-storage";
import { openHelpPage } from "./help-nav";
import { downloadOriginalRecording } from "./download/original-download-service";
import {
  buildRecordingName,
  createRecordingNameItem,
  formatDateOnly,
  formatRecordingDate,
  MAX_RECORDING_NAME_ITEMS,
  normalizeRecordingNameConfig,
  recordingNameIsEmpty,
  sessionDisplayTitle,
  type RecordingNameConfig,
  type RecordingNameItem,
  type RecordingNamePart
} from "./recording-name";
import {
  addRecordingNameProfile,
  applyRecordingNameProfilesToSettings,
  buildSessionRecordingName,
  findRecordingNameProfile,
  getActiveRecordingNameProfile,
  MAX_RECORDING_NAME_PROFILES,
  normalizeRecordingNameProfiles,
  removeRecordingNameProfile,
  renameRecordingNameProfile,
  setActiveRecordingNameProfile,
  updateProfileConfig
} from "./recording-name-profiles";
import {
  isLocalMediaEndedAutoStartEnabled,
  addFilesToPlaylist,
  movePlaylistItem,
  reorderPlaylistItemTo,
  removePlaylistItem,
  playlistPlayingStatus,
  playlistReadyStatus,
  playlistSummary,
  type LocalMediaPlaylistItem
} from "./local-media-player";
import { finalizeWebmDurationBlob } from "./webm-duration";
import {
  buildHistoryBackupFileName,
  exportHistoryBackup,
  importHistoryBackup
} from "./history-backup";
import { downloadFolderHint, friendlyProtectedFolderPickError, isProtectedFolderPickError } from "./download-path";
import {
  clearSavedDownloadDirectory,
  describeDownloadDirectory,
  getSavedDownloadDirectory,
  pickDownloadDirectory,
  supportsDirectoryPicker,
  directoryPickerUnavailableMessage
} from "./download-directory";
import { saveDownloadBlob } from "./download-save";
import { deviceHint } from "./device-manager";
import {
  compareSelectedWithBrowser,
  formatChannels,
  probeBrowserDefaultInput,
  probeStereoFromStream,
  readInputFromStream,
  type InputDeviceInfo
} from "./device-verify";
import { canContinueRecording } from "./recording-continue";
import { driveUploadLabel } from "./google-drive/upload-service";
import { driveLinkLabel, resolveSessionDriveWebUrl } from "./google-drive/drive-links";
import { copyTextToClipboard } from "./google-drive/clipboard";
import { onDriveUploadEvent, type DriveUploadEvent } from "./google-drive/upload-events";
import { googleDriveAccountLabel, isGoogleDriveLinked, resolveStopDownloadMode, canUploadToGoogleDrive } from "./google-drive/settings";
import {
  getGoogleRedirectUri,
  googleDriveSetupHint,
  isGoogleDriveConfigured,
  friendlyGoogleConnectError
} from "./google-drive/config";
import { connectGoogleAccount, getAuthSessionForExport } from "./google-drive/auth";
import { ensureDefaultDriveFolder } from "./google-drive/drive-api";
import {
  applyGoogleDriveConfig,
  clearGoogleDriveSettings,
  describeGoogleDriveConfigExport,
  googleDriveConfigFileName,
  googleDriveSettingsClearPatch,
  isUsableAuthSessionExport,
  parseGoogleDriveConfig,
  serializeGoogleDriveConfig
} from "./google-drive/config-backup";
import {
  applySettingsBackupImport,
  buildSettingsBackupExport,
  describeSettingsBackupExport,
  parseSettingsImport,
  serializeSettingsBackup,
  settingsBackupFileName,
  type SettingsBackupExport
} from "./settings-backup";
import {
  formatGoogleAuthExpiryHint,
  isGoogleAuthExpiryWarning
} from "./google-drive/auth-expiry";
import {
  attachPlaybackRecovery,
  isPrematureMediaEnd,
  playMediaWithRecovery,
  resumeIfShouldPlay,
  waitForMediaReady
} from "./playback-recovery";
import { resolveExportNameForSession } from "./session-display-name";
import { applyStopDownloadModeToSettings, shouldAutoDownloadOriginalAfterStop } from "./stop-download-mode";

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
let googleDriveAuthExpiresAt: number | null = null;
let googleDriveAuthHasRefreshToken = false;
let googleDriveAuthValid = false;
let googleDriveConnecting = false;
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
let exportingHistory = false;
let importingHistory = false;
let deletingSessionIds = new Set<string>();
let playingAudio:
  | { sessionId: string; audio: HTMLAudioElement; url: string; detachRecovery: () => void }
  | undefined;
/** Remembers the export-bitrate dropdown choice across history refreshes. */
const exportBitrateChoice = new Map<string, number>();
let lastHistoryListKey = "";
let historyExportUiHoldUntil = 0;

const HISTORY_CHANNEL_NAME = "safe-call-recorder-history";
let historyChannel: BroadcastChannel | undefined;
try {
  historyChannel = new BroadcastChannel(HISTORY_CHANNEL_NAME);
} catch {
  historyChannel = undefined;
}

let previewHadSound = false;
let autoStartCooldownUntil = 0;
let autoStartPending = false;
let cachedBrowserDefault: InputDeviceInfo | null = null;
let verifyInFlight = false;
let lastStereoProbeAt = 0;
let localMediaPlaybackActive = false;
let localMediaSequentialPlay = false;
let localMediaPlaylist: LocalMediaPlaylistItem[] = [];
let localMediaPlaylistIndex = -1;
let localMediaLoaded: { item: LocalMediaPlaylistItem; objectUrl: string } | undefined;
let localMediaDragId: string | null = null;
let localMediaRecoveryDetach: (() => void) | undefined;
/** True while playlist playback should continue (ignore transient buffering pauses). */
let localMediaWantsPlay = false;
/** User explicitly paused; block auto-resume until they press play again. */
let localMediaUserPaused = false;
/** Ignore pause events caused by buffering until this timestamp. */
let localMediaBufferingUntil = 0;
/** True from「播放列表」until stop or full playlist end — keeps mic preview off. */
let localMediaSessionActive = false;
let localMediaLastPointerAt = 0;

function isLocalMediaSessionBusy() {
  return localMediaSessionActive || localMediaWantsPlay || localMediaPlaybackActive;
}

function detachLocalMediaRecovery() {
  localMediaRecoveryDetach?.();
  localMediaRecoveryDetach = undefined;
}

async function ensurePreviewMonitor() {
  if (busy || recording || localMediaPlaybackActive) return;
  if (!preview) {
    await startPreview();
    return;
  }
  preview.monitor.resumeIfNeeded();
  const track = preview.stream.getAudioTracks()[0];
  if (!track || track.readyState === "ended") {
    await startPreview();
  }
}

function renderDeviceVerificationUi(
  selected: InputDeviceInfo | null,
  browser: InputDeviceInfo | null,
  cmp: ReturnType<typeof compareSelectedWithBrowser>,
  stereoLabel: string,
  stereoClass: string
) {
  const pluginEl = $("verifyPluginLabel");
  const browserEl = $("verifyBrowserLabel");
  const channelsEl = $("verifyChannels");
  const stereoEl = $("verifyStereo");
  const resultEl = $("verifyResult");

  if (selected?.label) {
    pluginEl.textContent = `${selected.label}（${selected.hint}）`;
  } else {
    pluginEl.textContent = "未选择";
  }

  if (browser?.label) {
    browserEl.textContent = `${browser.label}（${browser.hint}）`;
  } else {
    browserEl.textContent = "尚未读取（需授权后核对）";
  }

  channelsEl.textContent = cmp.channelNote || formatChannels(selected?.channelCount);
  stereoEl.textContent = stereoLabel;
  stereoEl.className = `device-verify-val ${stereoClass}`;

  resultEl.textContent = `${cmp.title}。${cmp.detail}`;
  resultEl.className = `device-verify-result ${cmp.ok ? "ok" : cmp.status === "browser_unknown" || cmp.status === "no_selection" ? "warn" : "fail"}`;
}

async function refreshDeviceVerification(forceBrowserProbe = false) {
  if (verifyInFlight) return;
  verifyInFlight = true;
  try {
    const deviceId = $<HTMLSelectElement>("device").value;
    const selectedMeta = devices.find((d) => d.deviceId === deviceId);
    const selectedFromPreview = readInputFromStream(preview?.stream);
    const selected: InputDeviceInfo | null = deviceId
      ? {
          deviceId,
          label: selectedMeta?.label?.trim() || selectedFromPreview?.label || "声音设备",
          hint: deviceHint(selectedMeta?.label || selectedFromPreview?.label || ""),
          channelCount: selectedFromPreview?.channelCount,
          sampleRate: selectedFromPreview?.sampleRate
        }
      : null;

    if (forceBrowserProbe || !cachedBrowserDefault) {
      const wasPreview = !!preview;
      if (wasPreview) await stopPreview();
      cachedBrowserDefault = await probeBrowserDefaultInput();
      if (wasPreview && !recording && !busy && !localMediaSessionActive) await startPreview();
    }

    const cmp = compareSelectedWithBrowser(selected, cachedBrowserDefault);
    let stereoLabel = "播放测试音后可检测左右声道";
    let stereoClass = "";
    if (preview?.stream && selected?.channelCount && selected.channelCount >= 2) {
      stereoLabel = "立体声设备 · 等待音浪信号…";
    } else if (selected?.channelCount === 1) {
      stereoLabel = "单声道输入";
      stereoClass = "stereo-ok";
    }

    renderDeviceVerificationUi(selected, cachedBrowserDefault, cmp, stereoLabel, stereoClass);
  } finally {
    verifyInFlight = false;
  }
}

async function maybeProbeStereoFromPreview() {
  if (!preview?.stream || recording || busy) return;
  const now = Date.now();
  if (now - lastStereoProbeAt < 2500) return;
  const info = readInputFromStream(preview.stream);
  if (!info || (info.channelCount || 1) < 2) return;
  if (!previewHadSound) return;

  lastStereoProbeAt = now;
  const stereo = await probeStereoFromStream(preview.stream);
  const selected: InputDeviceInfo = {
    deviceId: info.deviceId,
    label: info.label,
    hint: info.hint,
    channelCount: info.channelCount,
    sampleRate: info.sampleRate
  };
  const cmp = compareSelectedWithBrowser(selected, cachedBrowserDefault);
  const stereoClass =
    stereo.state === "stereo_balanced" ? "stereo-ok" : stereo.state === "silent" ? "" : "stereo-warn";
  renderDeviceVerificationUi(selected, cachedBrowserDefault, cmp, stereo.label, stereoClass);
}

function updateLocalMediaUi() {
  const playBtn = $<HTMLButtonElement>("localMediaPlayBtn");
  const stopBtn = $<HTMLButtonElement>("localMediaStopBtn");
  const clearBtn = $<HTMLButtonElement>("localMediaClearPlaylistBtn");
  const hasPlaylist = localMediaPlaylist.length > 0;
  playBtn.disabled = busy || !hasPlaylist || localMediaPlaybackActive;
  stopBtn.disabled = busy || !hasPlaylist;
  stopBtn.classList.toggle("hidden", !hasPlaylist);
  clearBtn.disabled = busy || !hasPlaylist;
}

function renderLocalMediaPlaylist() {
  const host = $<HTMLOListElement>("localMediaPlaylist");
  host.replaceChildren();
  host.classList.toggle("hidden", localMediaPlaylist.length === 0);
  $("localMediaFileName").textContent = playlistSummary(localMediaPlaylist.length);

  localMediaPlaylist.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "local-media-playlist-item";
    li.dataset.id = item.id;
    const canReorder = !localMediaPlaybackActive && !recording && !busy;
    li.draggable = canReorder;
    if (index === localMediaPlaylistIndex && localMediaPlaylistIndex >= 0) {
      li.classList.add("active");
    }

    const grip = document.createElement("span");
    grip.className = "local-media-playlist-grip";
    grip.title = "拖动调整顺序";
    grip.setAttribute("aria-hidden", "true");
    grip.textContent = "⠿";

    const indexEl = document.createElement("span");
    indexEl.className = "local-media-playlist-index";
    indexEl.textContent = String(index + 1);

    const nameEl = document.createElement("span");
    nameEl.className = "local-media-playlist-name";
    nameEl.textContent = item.file.name;
    nameEl.title = "双击从此处开始播放";

    const actions = document.createElement("div");
    actions.className = "local-media-playlist-actions";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "btn outline small icon";
    up.title = "上移";
    up.textContent = "↑";
    up.disabled = index === 0 || localMediaPlaybackActive || recording || busy;
    up.onclick = () => reorderLocalMediaPlaylistItem(item.id, -1);

    const down = document.createElement("button");
    down.type = "button";
    down.className = "btn outline small icon";
    down.title = "下移";
    down.textContent = "↓";
    down.disabled =
      index === localMediaPlaylist.length - 1 || localMediaPlaybackActive || recording || busy;
    down.onclick = () => reorderLocalMediaPlaylistItem(item.id, 1);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn outline small icon";
    remove.title = "移除";
    remove.textContent = "×";
    remove.disabled = localMediaPlaybackActive || recording || busy;
    remove.onclick = () => removeLocalMediaPlaylistItem(item.id);

    actions.append(up, down, remove);
    li.append(grip, indexEl, nameEl, actions);
    li.title = "双击从此处开始播放";
    li.ondblclick = (e) => {
      if ((e.target as HTMLElement).closest(".local-media-playlist-actions")) return;
      if (busy) return;
      void playLocalMediaPlaylistFromIndex(index);
    };
    host.append(li);
  });
}

function unloadCurrentLocalMediaTrack() {
  detachLocalMediaRecovery();
  const video = $<HTMLVideoElement>("localMediaVideo");
  const audio = $<HTMLAudioElement>("localMediaAudio");
  video.pause();
  audio.pause();
  video.removeAttribute("src");
  audio.removeAttribute("src");
  video.load();
  audio.load();
  video.classList.add("hidden");
  audio.classList.add("hidden");
  video.onplay = video.onpause = video.onended = video.onerror = video.ontimeupdate = video.onpointerdown = video.onseeking = null;
  audio.onplay = audio.onpause = audio.onended = audio.onerror = audio.ontimeupdate = audio.onpointerdown = audio.onseeking = null;
  $("localMediaPlayerWrap").classList.add("hidden");
  if (localMediaLoaded) {
    try {
      URL.revokeObjectURL(localMediaLoaded.objectUrl);
    } catch {
      /* ignore */
    }
  }
  localMediaLoaded = undefined;
}

function clearLocalMediaPlaylist() {
  stopLocalMediaPlayback();
  unloadCurrentLocalMediaTrack();
  localMediaPlaylist = [];
  localMediaPlaylistIndex = -1;
  localMediaSequentialPlay = false;
  localMediaWantsPlay = false;
  localMediaUserPaused = false;
  localMediaSessionActive = false;
  renderLocalMediaPlaylist();
  $("localMediaStatus").classList.remove("playing");
  $("localMediaStatus").textContent = playlistReadyStatus(0, isLocalMediaEndedAutoStartEnabled(settings));
  updateLocalMediaUi();
}

function moveLocalMediaPlaylistItem(fromId: string, toId: string) {
  if (localMediaPlaybackActive || fromId === toId) return;
  const loadedId = localMediaLoaded?.item.id;
  localMediaPlaylist = reorderPlaylistItemTo(localMediaPlaylist, fromId, toId);
  if (loadedId) {
    localMediaPlaylistIndex = localMediaPlaylist.findIndex((item) => item.id === loadedId);
  }
  renderLocalMediaPlaylist();
}

function reorderLocalMediaPlaylistItem(id: string, delta: -1 | 1) {
  if (localMediaPlaybackActive) return;
  const prevIndex = localMediaPlaylist.findIndex((item) => item.id === id);
  localMediaPlaylist = movePlaylistItem(localMediaPlaylist, id, delta);
  const nextIndex = localMediaPlaylist.findIndex((item) => item.id === id);
  if (localMediaLoaded && prevIndex === localMediaPlaylistIndex && nextIndex >= 0) {
    localMediaPlaylistIndex = nextIndex;
  }
  renderLocalMediaPlaylist();
}

function removeLocalMediaPlaylistItem(id: string) {
  if (localMediaPlaybackActive) return;
  const removedIndex = localMediaPlaylist.findIndex((item) => item.id === id);
  const removingLoaded = localMediaLoaded?.item.id === id;
  localMediaPlaylist = removePlaylistItem(localMediaPlaylist, id);
  if (removingLoaded) {
    unloadCurrentLocalMediaTrack();
    localMediaPlaylistIndex = -1;
  } else if (removedIndex >= 0 && removedIndex < localMediaPlaylistIndex) {
    localMediaPlaylistIndex -= 1;
  }
  renderLocalMediaPlaylist();
  if (localMediaPlaylist.length === 0) {
    $("localMediaStatus").textContent = playlistReadyStatus(0, isLocalMediaEndedAutoStartEnabled(settings));
  }
  updateLocalMediaUi();
}

function addLocalMediaFiles(files: FileList | File[]) {
  const { playlist, added, skipped } = addFilesToPlaylist(localMediaPlaylist, [...files]);
  localMediaPlaylist = playlist;
  renderLocalMediaPlaylist();
  updateLocalMediaUi();

  const autoStart = isLocalMediaEndedAutoStartEnabled(settings);
  if (added > 0) {
    $("localMediaStatus").textContent = playlistReadyStatus(localMediaPlaylist.length, autoStart);
  }
  if (skipped.length > 0) {
    const skipNote = skipped.length === 1 ? skipped[0] : `${skipped.length} 个文件`;
    setStatus(`已跳过不支持的文件：${skipNote}`);
  }
}

function markLocalMediaUserInteraction() {
  localMediaLastPointerAt = Date.now();
}

function classifyLocalMediaPause(el: HTMLMediaElement): "buffering" | "user" {
  if (localMediaUserPaused) return "user";
  const userInteractedRecently = Date.now() - localMediaLastPointerAt < 3000;
  if (userInteractedRecently) return "user";
  if (
    localMediaWantsPlay &&
    (el.readyState < 3 || Date.now() < localMediaBufferingUntil)
  ) {
    return "buffering";
  }
  return "user";
}

function bindLocalMediaElement(el: HTMLVideoElement | HTMLAudioElement) {
  detachLocalMediaRecovery();
  el.preload = "auto";
  localMediaRecoveryDetach = attachPlaybackRecovery(el, {
    shouldRecover: () => localMediaWantsPlay && !localMediaUserPaused,
    onRecovering: () => {
      if (localMediaWantsPlay) {
        $("localMediaStatus").textContent = "播放缓冲中，正在尝试恢复…";
      }
    }
  });
  el.onplay = () => {
    localMediaUserPaused = false;
    localMediaWantsPlay = true;
    localMediaPlaybackActive = true;
    previewHadSound = false;
    void stopPreview();
    updateLocalMediaUi();
    renderLocalMediaPlaylist();
    const statusEl = $("localMediaStatus");
    const fileName = localMediaLoaded?.item.file.name || "";
    statusEl.textContent = playlistPlayingStatus(
      Math.max(localMediaPlaylistIndex, 0),
      localMediaPlaylist.length,
      fileName,
      isLocalMediaEndedAutoStartEnabled(settings)
    );
    statusEl.classList.add("playing");
  };
  el.onpause = () => {
    if (el.ended) return;
    localMediaPlaybackActive = false;
    updateLocalMediaUi();
    if (classifyLocalMediaPause(el) === "buffering") {
      $("localMediaStatus").textContent = "播放缓冲中…";
      return;
    }
    localMediaUserPaused = true;
    localMediaWantsPlay = false;
    $("localMediaStatus").classList.remove("playing");
    $("localMediaStatus").textContent = "播放已暂停。";
  };
  el.onended = () => {
    if (isPrematureMediaEnd(el)) {
      localMediaWantsPlay = true;
      void el.play().catch(() => undefined);
      return;
    }
    localMediaWantsPlay = false;
    void handleLocalMediaEnded();
  };
  el.onerror = () => {
    localMediaWantsPlay = false;
    localMediaSessionActive = false;
    localMediaPlaybackActive = false;
    localMediaSequentialPlay = false;
    detachLocalMediaRecovery();
    void ensurePreviewMonitor();
    updateLocalMediaUi();
    renderLocalMediaPlaylist();
    $("localMediaStatus").classList.remove("playing");
    $("localMediaStatus").textContent = "无法播放该文件，请换一个格式试试。";
  };
  el.onpointerdown = () => markLocalMediaUserInteraction();
  el.onclick = () => markLocalMediaUserInteraction();
  el.onkeydown = (e) => {
    if (e.code === "Space" || e.code === "Enter") markLocalMediaUserInteraction();
  };
  el.onwaiting = () => {
    localMediaBufferingUntil = Date.now() + 4000;
    if (localMediaWantsPlay && !localMediaUserPaused) {
      $("localMediaStatus").textContent = "播放缓冲中…";
    }
  };
  el.onseeking = () => {
    if (localMediaWantsPlay) $("localMediaStatus").textContent = "正在跳转…";
  };
  el.ontimeupdate = () => {
    if (el.paused || el.ended) return;
    if (!localMediaWantsPlay) return;
    localMediaPlaybackActive = true;
    $("localMediaStatus").classList.add("playing");
    const fileName = localMediaLoaded?.item.file.name || "";
    $("localMediaStatus").textContent = playlistPlayingStatus(
      Math.max(localMediaPlaylistIndex, 0),
      localMediaPlaylist.length,
      fileName,
      isLocalMediaEndedAutoStartEnabled(settings)
    );
  };
}

async function loadLocalMediaTrack(index: number) {
  const item = localMediaPlaylist[index];
  if (!item) return;
  unloadCurrentLocalMediaTrack();

  let playable: Blob = item.file;
  if (/webm/i.test(item.file.type) || /\.webm$/i.test(item.file.name)) {
    try {
      playable = await finalizeWebmDurationBlob(item.file, 0);
    } catch {
      playable = item.file;
    }
  }

  const objectUrl = URL.createObjectURL(playable);
  localMediaLoaded = { item, objectUrl };
  localMediaPlaylistIndex = index;

  const video = $<HTMLVideoElement>("localMediaVideo");
  const audio = $<HTMLAudioElement>("localMediaAudio");
  const target = item.kind === "video" ? video : audio;
  const other = item.kind === "video" ? audio : video;
  other.classList.add("hidden");
  other.removeAttribute("src");
  target.classList.remove("hidden");
  target.src = objectUrl;
  bindLocalMediaElement(target);
  $("localMediaPlayerWrap").classList.remove("hidden");
  renderLocalMediaPlaylist();
  updateLocalMediaUi();
}

async function playCurrentLocalMediaTrack() {
  if (!localMediaLoaded || busy) return;
  const el =
    localMediaLoaded.item.kind === "video"
      ? $<HTMLVideoElement>("localMediaVideo")
      : $<HTMLAudioElement>("localMediaAudio");
  localMediaUserPaused = false;
  localMediaWantsPlay = true;
  localMediaPlaybackActive = true;
  await playMediaWithRecovery(el);
}

async function handleLocalMediaEnded() {
  localMediaWantsPlay = false;
  localMediaUserPaused = false;
  localMediaPlaybackActive = false;
  updateLocalMediaUi();
  renderLocalMediaPlaylist();
  const statusEl = $("localMediaStatus");
  statusEl.classList.remove("playing");

  if (
    localMediaSequentialPlay &&
    localMediaPlaylistIndex >= 0 &&
    localMediaPlaylistIndex < localMediaPlaylist.length - 1
  ) {
    const nextIndex = localMediaPlaylistIndex + 1;
    statusEl.textContent = `即将播放下一项（${nextIndex + 1}/${localMediaPlaylist.length}）…`;
    try {
      await loadLocalMediaTrack(nextIndex);
      await waitForMediaReady(
        localMediaLoaded!.item.kind === "video"
          ? $<HTMLVideoElement>("localMediaVideo")
          : $<HTMLAudioElement>("localMediaAudio")
      ).catch(() => undefined);
      await playCurrentLocalMediaTrack();
    } catch (e) {
      localMediaSequentialPlay = false;
      localMediaSessionActive = false;
      detachLocalMediaRecovery();
      void ensurePreviewMonitor();
      statusEl.textContent = friendlyError(e instanceof Error ? e.message : String(e));
    }
    return;
  }

  localMediaSequentialPlay = false;
  localMediaSessionActive = false;
  detachLocalMediaRecovery();
  void ensurePreviewMonitor();

  if (!isLocalMediaEndedAutoStartEnabled(settings)) {
    statusEl.textContent =
      localMediaPlaylist.length > 1
        ? "播放列表已结束。可在设置中开启「插件内播放结束后自动开始」。"
        : "播放已结束。可在设置中开启「插件内播放结束后自动开始」。";
    return;
  }
  statusEl.textContent =
    localMediaPlaylist.length > 1 ? "播放列表已结束，正在自动开始录音…" : "播放已结束，正在自动开始录音…";
  await tryAutoStartRecording("local_media_ended");
}

async function playLocalMediaPlaylistFromIndex(index: number) {
  if (index < 0 || index >= localMediaPlaylist.length || busy) return;
  localMediaSequentialPlay = true;
  localMediaSessionActive = true;
  await stopPreview();
  try {
    const item = localMediaPlaylist[index]!;
    if (!localMediaLoaded || localMediaPlaylistIndex !== index || localMediaLoaded.item.id !== item.id) {
      await loadLocalMediaTrack(index);
    }
    await playCurrentLocalMediaTrack();
  } catch (e) {
    localMediaSequentialPlay = false;
    localMediaSessionActive = false;
    localMediaPlaybackActive = false;
    localMediaWantsPlay = false;
    void ensurePreviewMonitor();
    updateLocalMediaUi();
    renderLocalMediaPlaylist();
    $("localMediaStatus").textContent = friendlyError(e instanceof Error ? e.message : String(e));
  }
}

async function playLocalMediaPlaylist() {
  if (localMediaPlaylist.length === 0 || busy) return;
  const startIndex =
    localMediaLoaded && localMediaPlaylistIndex >= 0 && !localMediaPlaybackActive
      ? localMediaPlaylistIndex
      : 0;
  await playLocalMediaPlaylistFromIndex(startIndex);
}

function stopLocalMediaPlayback() {
  localMediaWantsPlay = false;
  localMediaUserPaused = false;
  localMediaBufferingUntil = 0;
  localMediaSessionActive = false;
  if (localMediaLoaded) {
    const el =
      localMediaLoaded.item.kind === "video"
        ? $<HTMLVideoElement>("localMediaVideo")
        : $<HTMLAudioElement>("localMediaAudio");
    el.pause();
    try {
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
  }
  localMediaPlaybackActive = false;
  localMediaSequentialPlay = false;
  detachLocalMediaRecovery();
  void ensurePreviewMonitor();
  updateLocalMediaUi();
  renderLocalMediaPlaylist();
  $("localMediaStatus").classList.remove("playing");
  $("localMediaStatus").textContent = localMediaPlaylist.length > 0 ? "播放已停止。" : playlistReadyStatus(0, isLocalMediaEndedAutoStartEnabled(settings));
}

async function persistDefaultDevice() {
  const deviceId = $<HTMLSelectElement>("device").value;
  if (deviceId) {
    settings.defaultDeviceId = deviceId;
    await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
  }
}

function recNameKindLabel(kind: RecordingNamePart): string {
  if (kind === "date") return "日期";
  if (kind === "number") return "编号";
  if (kind === "space") return "空格";
  return "自定义";
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function readRecordingNameConfigFromUi(): RecordingNameConfig {
  const { profiles, activeId } = normalizeRecordingNameProfiles(settings);
  const stored = profiles.find((p) => p.id === activeId)?.config ?? normalizeRecordingNameConfig(settings.recordingName);
  const storedById = new Map(stored.items.map((item) => [item.id, item]));
  const items: RecordingNameItem[] = [...$("recNameToggles").querySelectorAll<HTMLElement>(".rec-name-chip[data-id]")].flatMap(
    (chip) => {
      const id = chip.dataset.id;
      const kind = chip.dataset.part as RecordingNamePart | undefined;
      if (!id || (kind !== "date" && kind !== "number" && kind !== "custom" && kind !== "space")) return [];
      const prev = storedById.get(id);
      if (kind === "space") return [createRecordingNameItem("space", { id })];
      if (kind === "custom") {
        const input = document.getElementById(`rec-name-custom-${id}`) as HTMLInputElement | null;
        return [createRecordingNameItem("custom", { id, text: input?.value ?? prev?.text ?? "" })];
      }
      if (kind === "number") {
        const input = document.getElementById(`rec-name-number-${id}`) as HTMLInputElement | null;
        const cycleInput = document.getElementById(`rec-name-cycle-${id}`) as HTMLInputElement | null;
        const seed = input ? Number(input.value) : prev?.numberSeed;
        const cycleRaw = cycleInput?.value.trim() ?? "";
        const cycleParsed = cycleRaw === "" ? NaN : Number(cycleRaw);
        return [
          createRecordingNameItem("number", {
            id,
            numberSeed: seed,
            numberSeedDate: prev?.numberSeedDate,
            numberCycleMax:
              cycleRaw !== "" && Number.isFinite(cycleParsed) && cycleParsed > 0
                ? Math.floor(cycleParsed)
                : undefined
          })
        ];
      }
      return [createRecordingNameItem("date", { id })];
    }
  );
  return normalizeRecordingNameConfig({
    items,
    dateIncludeYear: $<HTMLButtonElement>("recNameDateYmd").classList.contains("active"),
    numberSeedDate: stored.numberSeedDate
  });
}

function renderRecordingNameChips(items: RecordingNameItem[]) {
  const host = $("recNameToggles");
  const counts: Record<RecordingNamePart, number> = { date: 0, number: 0, custom: 0, space: 0 };
  host.innerHTML = items
    .map((item) => {
      counts[item.kind] += 1;
      const n = counts[item.kind];
      const sameKindTotal = items.filter((i) => i.kind === item.kind).length;
      const label = sameKindTotal > 1 ? `${recNameKindLabel(item.kind)} ${n}` : recNameKindLabel(item.kind);
      return `<div class="rec-name-chip included${item.kind === "space" ? " rec-name-chip-space" : ""}" data-id="${item.id}" data-part="${item.kind}">
        <button type="button" class="rec-name-grip" aria-label="拖动调整顺序" draggable="true">⠿</button>
        <span class="rec-name-chip-label">${label}</span>
        <button type="button" class="rec-name-remove" data-remove-id="${item.id}" aria-label="去掉${label}">×</button>
      </div>`;
    })
    .join("");
}

function renderRecordingNameFields(items: RecordingNameItem[]) {
  const host = $("recNameItemFields");
  const counts: Record<"number" | "custom", number> = { number: 0, custom: 0 };
  const same = {
    number: items.filter((i) => i.kind === "number").length,
    custom: items.filter((i) => i.kind === "custom").length
  };
  host.innerHTML = items
    .map((item) => {
      if (item.kind === "number") {
        counts.number += 1;
        const label = same.number > 1 ? `起始编号 ${counts.number}` : "起始编号";
        const cycleLabel = same.number > 1 ? `一轮最大值 ${counts.number}` : "一轮最大值";
        const cycleVal = item.numberCycleMax != null && item.numberCycleMax > 0 ? String(item.numberCycleMax) : "";
        return `<div class="rec-name-extra rec-name-number-block">
          <label>${label}
            <input id="rec-name-number-${item.id}" type="number" min="0" max="999999" step="1" value="${item.numberSeed ?? 1}">
          </label>
          <label>${cycleLabel}
            <input id="rec-name-cycle-${item.id}" type="number" min="1" max="999999" step="1" value="${cycleVal}" placeholder="不限制（留空）">
          </label>
          <p class="hint rec-name-number-hint"><strong>一轮最大值</strong>：例如填 8，编号到 8 后下一天回到 1。留空则一直递增（1、2、3…）。</p>
        </div>`;
      }
      if (item.kind === "custom") {
        counts.custom += 1;
        const label = same.custom > 1 ? `自定义文字 ${counts.custom}` : "自定义文字";
        const value = escapeAttr(item.text ?? "");
        return `<div class="rec-name-extra">
          <label>${label}
            <input id="rec-name-custom-${item.id}" type="text" maxlength="80" placeholder="例如：VK通话" autocomplete="off" spellcheck="false" autocapitalize="off" value="${value}">
          </label>
        </div>`;
      }
      return "";
    })
    .join("");
}

function syncRecordingNameExtraRows(items: RecordingNameItem[]) {
  $("recNameDateRow").classList.toggle("hidden", !items.some((i) => i.kind === "date"));
  $<HTMLButtonElement>("recNameAddBtn").disabled = items.length >= MAX_RECORDING_NAME_ITEMS;
}

function syncRecordingDateStyleButtons(includeYear: boolean, now = new Date()) {
  const md = $<HTMLButtonElement>("recNameDateMd");
  const ymd = $<HTMLButtonElement>("recNameDateYmd");
  md.textContent = `月日 ${formatRecordingDate(now, false)}`;
  ymd.textContent = `年月日 ${formatRecordingDate(now, true)}`;
  md.classList.toggle("active", !includeYear);
  ymd.classList.toggle("active", includeYear);
  md.setAttribute("aria-pressed", includeYear ? "false" : "true");
  ymd.setAttribute("aria-pressed", includeYear ? "true" : "false");
}

function updateRecordingNamePreview() {
  const config = readRecordingNameConfigFromUi();
  const preview = buildRecordingName(config);
  $<HTMLElement>("recNamePreview").textContent = preview;
  $<HTMLElement>("recNamePreview").classList.toggle("rec-name-preview-empty", recordingNameIsEmpty(config));
}

function applyRecordingNameConfigToUi(config: RecordingNameConfig) {
  const c = normalizeRecordingNameConfig(config);
  renderRecordingNameChips(c.items);
  renderRecordingNameFields(c.items);
  syncRecordingDateStyleButtons(c.dateIncludeYear);
  syncRecordingNameExtraRows(c.items);
  updateRecordingNamePreview();
}

async function persistRecordingNameConfig(config: RecordingNameConfig) {
  const profileId =
    settings.activeRecordingNameProfileId ||
    normalizeRecordingNameProfiles(settings).activeId;
  settings = updateProfileConfig(settings, profileId, config);
  await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
  await syncActiveRecordingSessionName();
}

function syncRecordingNameProfilesUi() {
  settings = applyRecordingNameProfilesToSettings(settings);
  const { profiles, activeId } = normalizeRecordingNameProfiles(settings);
  const select = $<HTMLSelectElement>("recNameProfileSelect");
  if (select) {
    select.innerHTML = profiles.map((p) => `<option value="${escapeAttr(p.id)}">${escapeAttr(p.label)}</option>`).join("");
    select.value = activeId;
  }
  const delBtn = $<HTMLButtonElement>("recNameProfileDelete");
  if (delBtn) delBtn.disabled = profiles.length <= 1;
  const addBtn = $<HTMLButtonElement>("recNameProfileAdd");
  if (addBtn) addBtn.disabled = profiles.length >= MAX_RECORDING_NAME_PROFILES;
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0]!;
  applyRecordingNameConfigToUi(active.config);
}

function exportDisplayNameForSession(session: Session): string {
  return resolveExportNameForSession(session, settings);
}

async function syncActiveRecordingSessionName(clearManualTitle = false) {
  if (!recording || !selectedSession) return;
  const schemeName = buildSessionRecordingName(
    getActiveRecordingNameProfile(settings),
    startedAt || undefined
  );
  if (clearManualTitle) {
    await ask(MessageType.UpdateSessionDisplayName, { sessionId: selectedSession, displayName: "" }).catch(
      () => undefined
    );
  }
  await ask(MessageType.UpdateSessionAutoName, { sessionId: selectedSession, name: schemeName }).catch(
    () => undefined
  );
}

async function renameSessionDisplayName(session: Session) {
  const current = sessionDisplayTitle(session.displayName, session.name);
  const next = window.prompt(
    "录音名称（导出与下载使用此名称；Windows 不允许的符号会变为 _）",
    current
  );
  if (next == null) return;
  const trimmed = next.trim();
  if (!trimmed) {
    setStatus("名称不能为空。");
    return;
  }
  if (trimmed === current) return;
  try {
    const updated = (await ask(
      MessageType.UpdateSessionDisplayName,
      { sessionId: session.id, displayName: trimmed },
      2
    )) as Session;
    patchHistorySession(updated);
    renderHistory(historyRecords, historyActiveIds, true);
    setStatus("名称已更新。");
    void reloadHistoryVerified("after_rename");
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  }
}

async function tryAutoStartRecording(
  reason: "sound_detected" | "local_media" | "local_media_ended",
  meta?: { tabTitle?: string; tabUrl?: string }
) {
  if (reason === "local_media_ended") {
    if (settings.autoStartOnLocalMediaEnded === false) return;
  } else if (!settings.autoStartRecording) {
    return;
  }
  if (reason === "sound_detected" && settings.autoStartOnSound === false) return;
  if (reason === "local_media" && settings.autoStartOnLocalMediaTab === false) return;
  if (recording || busy || autoStartPending) return;
  if (Date.now() < autoStartCooldownUntil) return;
  const deviceId = $<HTMLSelectElement>("device").value;
  if (!deviceId || !devices.length) {
    setStatus("请先选择声音设备，才能自动开始录音。");
    return;
  }

  autoStartPending = true;
  try {
    setStatus(
      reason === "local_media"
        ? "检测到本地媒体播放，正在自动开始录音…"
        : reason === "local_media_ended"
          ? "本地媒体播放已结束，正在自动开始录音…"
          : "检测到声音，正在自动开始录音…"
    );
    console.info("[AutoStart]", { stage: "dashboard_start", reason, deviceId });
    await startRecording();
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  } finally {
    autoStartPending = false;
  }
}

function syncAutoStartSettingsUi() {
  const master = $<HTMLInputElement>("autoStartRecording");
  const localTab = $<HTMLInputElement>("autoStartOnLocalMediaTab");
  const localEnded = $<HTMLInputElement>("autoStartOnLocalMediaEnded");
  if (master) master.checked = settings.autoStartRecording === true;
  if (localTab) localTab.checked = settings.autoStartOnLocalMediaTab !== false;
  if (localEnded) localEnded.checked = settings.autoStartOnLocalMediaEnded !== false;
}

async function persistAutoStartSettings() {
  await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
}

async function ask(
  type: Request["type"],
  payload: Record<string, unknown> = {},
  retries = 0
) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await chrome.runtime.sendMessage({
        type,
        target: "service-worker",
        requestId: requestId(),
        payload
      } satisfies Request);
      if (!r?.ok) throw new Error(friendlyError(r?.error?.message || "操作失败"));
      return r.data;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw lastErr;
}

function patchHistorySession(session: Session) {
  const index = historyRecords.findIndex((s) => s.id === session.id);
  if (index >= 0) historyRecords[index] = { ...historyRecords[index], ...session };
  else historyRecords.push(session);
  lastHistoryListKey = "";
}

function invalidateHistoryReads(reason: string) {
  historyRequestVersion += 1;
  console.info("[HistorySync]", { stage: "invalidate", reason, version: historyRequestVersion });
  return historyRequestVersion;
}

function stopPlaybackIfSession(sessionId?: string) {
  if (!playingAudio) return;
  if (sessionId && playingAudio.sessionId !== sessionId) return;
  playingAudio.detachRecovery();
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

async function resumeDashboardPlayback() {
  if (localMediaWantsPlay && !localMediaUserPaused && localMediaLoaded) {
    const el =
      localMediaLoaded.item.kind === "video"
        ? $<HTMLVideoElement>("localMediaVideo")
        : $<HTMLAudioElement>("localMediaAudio");
    await resumeIfShouldPlay(el);
    if (!el.paused) localMediaPlaybackActive = true;
  }
  if (playingAudio) {
    await resumeIfShouldPlay(playingAudio.audio);
  }
}

function updateHistoryToolbar() {
  const clearBtn = $<HTMLButtonElement>("clearHistory");
  const exportBtn = $<HTMLButtonElement>("exportHistory");
  const importBtn = $<HTMLButtonElement>("importHistory");
  const historyBusy = exportingHistory || importingHistory || clearingHistory;

  if (clearBtn) {
    if (clearingHistory) {
      clearBtn.disabled = true;
      clearBtn.textContent = "正在清空……";
    } else {
      clearBtn.textContent = "清空历史";
      clearBtn.disabled = historyBusy || historyRecords.length === 0;
    }
  }

  if (exportBtn) {
    exportBtn.disabled = historyBusy || historyRecords.length === 0;
    exportBtn.textContent = exportingHistory ? "正在导出……" : "导出备份";
  }

  if (importBtn) {
    importBtn.disabled = historyBusy;
    importBtn.textContent = importingHistory ? "正在导入……" : "导入备份";
  }
}

/** @deprecated use updateHistoryToolbar */
function updateClearHistoryButton() {
  updateHistoryToolbar();
}

function applyHistoryRecords(records: Session[], activeIds?: string[]) {
  historyRecords = records;
  if (activeIds) historyActiveIds = activeIds;
  const uploading = records.find((s) => s.driveMp3Status === "uploading");
  if (uploading && $("driveUploadPanel").classList.contains("hidden")) {
    showDriveUploadProgress(
      uploading.driveMp3FileName
        ? `正在上传到 Google 云端：${uploading.driveMp3FileName}`
        : "正在上传到 Google 云端…",
      -1,
      true
    );
  }
  renderHistory(historyRecords, historyActiveIds);
  updateClearHistoryButton();
}

function removeSessionsFromUi(sessionIds: string[]) {
  if (!sessionIds.length) return;
  const removed = new Set(sessionIds);
  for (const id of sessionIds) {
    stopPlaybackIfSession(id);
    exportBitrateChoice.delete(id);
  }
  historyRecords = historyRecords.filter((r) => !removed.has(r.id));
  console.info("[HistoryDelete]", {
    stage: "ui_removed",
    deletedSessionIds: sessionIds,
    remainingUiCount: historyRecords.length
  });
  lastHistoryListKey = "";
  renderHistory(historyRecords, historyActiveIds, true);
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
  const el = $("status");
  el.textContent = text;
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function mergeSettingsFromPoll(incoming: AppSettings) {
  flushGoogleDriveCredentialsFromUi();
  const idInput = $<HTMLInputElement>("googleDriveClientId");
  const secretInput = $<HTMLInputElement>("googleDriveClientSecret");
  const uiClientId = idInput?.value ?? "";
  const uiClientSecret = secretInput?.value ?? "";
  settings = { ...DEFAULT_SETTINGS, ...incoming };
  if (uiClientId !== (incoming.googleDriveClientId ?? "")) {
    settings.googleDriveClientId = uiClientId.trim() || undefined;
  }
  if (uiClientSecret !== (incoming.googleDriveClientSecret ?? "")) {
    settings.googleDriveClientSecret = uiClientSecret.trim() || undefined;
  }
}

async function syncGoogleDriveSettingsToStorage(): Promise<void> {
  flushGoogleDriveCredentialsFromUi();
  const merged = await setSettings({
    googleDriveEnabled: settings.googleDriveEnabled,
    googleDriveClientId: settings.googleDriveClientId,
    googleDriveClientSecret: settings.googleDriveClientSecret,
    googleDriveFolderId: settings.googleDriveFolderId,
    googleDriveFolderName: settings.googleDriveFolderName,
    googleDriveUploadMode: settings.googleDriveUploadMode,
    googleDriveAutoUploadOnStop: settings.googleDriveAutoUploadOnStop,
    googleDriveAccountEmail: settings.googleDriveAccountEmail
  });
  Object.assign(settings, merged);
}

function flushGoogleDriveCredentialsFromUi() {
  const clientInput = $<HTMLInputElement>("googleDriveClientId");
  const secretInput = $<HTMLInputElement>("googleDriveClientSecret");
  const clientId = clientInput?.value.trim() ?? "";
  const clientSecret = secretInput?.value.trim() ?? "";
  settings.googleDriveClientId = clientId || undefined;
  settings.googleDriveClientSecret = clientSecret || undefined;
}

function resetGoogleDriveCredentialInputs() {
  const clientInput = $<HTMLInputElement>("googleDriveClientId");
  const secretInput = $<HTMLInputElement>("googleDriveClientSecret");
  if (clientInput) clientInput.value = "";
  if (secretInput) secretInput.value = "";
  settings.googleDriveClientId = undefined;
  settings.googleDriveClientSecret = undefined;
}

let driveUploadCopyUrl = "";

function setDriveUploadPanelVisible(visible: boolean) {
  $("driveUploadPanel").classList.toggle("hidden", !visible);
}

function showDriveUploadProgress(label: string, percent: number, indeterminate = false) {
  setDriveUploadPanelVisible(true);
  $("driveUploadLabel").textContent = label;
  $("driveUploadDone").classList.add("hidden");
  const bar = $<HTMLProgressElement>("driveUploadProgress");
  bar.classList.remove("hidden");
  if (indeterminate || percent < 0) {
    bar.removeAttribute("value");
  } else {
    bar.value = Math.max(0, Math.min(100, Math.round(percent)));
  }
}

function showDriveUploadComplete(fileName: string, webUrl: string) {
  driveUploadCopyUrl = webUrl;
  setDriveUploadPanelVisible(true);
  $("driveUploadLabel").textContent = "上传完成";
  $<HTMLProgressElement>("driveUploadProgress").classList.add("hidden");
  $("driveUploadDoneText").textContent = `已上传到 Google 云端：${fileName}`;
  $("driveUploadDone").classList.remove("hidden");
  setStatus(`已上传到 Google Drive：${fileName}`);
}

function hideDriveUploadPanel() {
  setDriveUploadPanelVisible(false);
  driveUploadCopyUrl = "";
  $<HTMLProgressElement>("driveUploadProgress").classList.remove("hidden");
  $("driveUploadDone").classList.add("hidden");
}

function handleDriveUploadEvent(event: DriveUploadEvent) {
  if (event.type === "start") {
    showDriveUploadProgress(`正在上传到 Google 云端：${event.fileName}`, 0);
    return;
  }
  if (event.type === "progress") {
    const pct = event.total > 0 ? (event.loaded / event.total) * 100 : -1;
    showDriveUploadProgress(
      event.total > 0
        ? `正在上传到 Google 云端… ${Math.round(pct)}%`
        : "正在上传到 Google 云端…",
      pct
    );
    return;
  }
  if (event.type === "done") {
    showDriveUploadComplete(event.fileName, event.webUrl);
    void reloadHistoryVerified("after_drive_upload_event");
    return;
  }
  if (event.type === "failed") {
    hideDriveUploadPanel();
    setStatus(`上传失败：${event.message}`);
    void reloadHistoryVerified("after_drive_upload_fail");
  }
}

async function copySessionDriveLink(session: Session) {
  const url = resolveSessionDriveWebUrl(session);
  if (!url) {
    setStatus("暂无 Google 云端链接");
    return;
  }
  const ok = await copyTextToClipboard(url);
  setStatus(ok ? "云端音频链接已复制" : "复制失败，请手动复制链接");
}

async function copyDriveUploadLink() {
  if (!driveUploadCopyUrl) {
    setStatus("暂无 Google 云端链接");
    return;
  }
  const ok = await copyTextToClipboard(driveUploadCopyUrl);
  setStatus(ok ? "云端音频链接已复制" : "复制失败，请手动复制链接");
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
  $<HTMLButtonElement>("start").disabled = busy || !list.length;
  void refreshDeviceVerification(false);
}

async function refreshDevices() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error("当前浏览器不支持设备枚举");
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    renderDevices(devices);
    if (!recording && !localMediaPlaybackActive) await startPreview();
    await refreshDeviceVerification(true);
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
    await refreshDeviceVerification(true);
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
  if (busy || recording || localMediaPlaybackActive) return;
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
    previewHadSound = false;
    monitor.onUpdate((u) => {
      if (recording || getRecordingFlag()) return;
      applyLevelUpdate($("liveMonitor"), u);
      const hasStableSound =
        u.hasSound || u.soundState === "has_sound" || u.soundState === "low_volume" || u.soundState === "clipping";
      if (
        settings.autoStartRecording &&
        settings.autoStartOnSound !== false &&
        hasStableSound &&
        !previewHadSound &&
        !localMediaPlaybackActive &&
        !localMediaSessionActive
      ) {
        void tryAutoStartRecording("sound_detected");
      }
      previewHadSound = hasStableSound;
      void maybeProbeStereoFromPreview();
    });
    monitor.start();
    preview = { stream, monitor };
    setWaveformMode("preview");
    void refreshDeviceVerification(false);
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

function historySessionKey(s: Session): string {
  return [
    s.id,
    s.name,
    s.mp3Status,
    s.mp3Progress,
    s.hasMp3 ? "1" : "0",
    s.historyStatus,
    s.fileSize,
    s.bitrate,
    s.originalStatus,
    s.mp3ProgressLabel,
    s.driveMp3Status,
    s.driveMp3FileId,
    s.driveMp3WebUrl,
    s.displayName,
    deletingSessionIds.has(s.id) ? "1" : "0"
  ].join("|");
}

function openSessionDriveLink(session: Session) {
  const url = resolveSessionDriveWebUrl(session);
  if (!url) {
    setStatus("暂无 Google 云端链接");
    return;
  }
  chrome.tabs.create({ url });
}

function historyListKey(sessions: Session[], activeIds: string[]): string {
  return `${sessions.map(historySessionKey).join(";")}#${activeIds.join(",")}`;
}

function holdHistoryExportUi(ms = 15000) {
  historyExportUiHoldUntil = Date.now() + ms;
}

function isHistoryExportSelectOpen(): boolean {
  if (Date.now() < historyExportUiHoldUntil) return true;
  const el = document.activeElement;
  return Boolean(el instanceof HTMLSelectElement && el.classList.contains("history-export-bitrate"));
}

function chosenExportBitrate(session: Session): number {
  return exportBitrateChoice.get(session.id) ?? resolveBitrate(session.bitrate || DEFAULT_BITRATE);
}

function renderHistory(sessions: Session[], activeIds: string[], force = false) {
  const host = $("history");
  if (!force && isHistoryExportSelectOpen()) return;
  const nextKey = historyListKey(sessions, activeIds);
  if (!force && nextKey === lastHistoryListKey && host.childElementCount > 0) return;
  lastHistoryListKey = nextKey;
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
    const title = sessionDisplayTitle(s.displayName, s.name);
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
    split.replaceChildren();
    const addSplitLine = (text: string) => {
      const row = document.createElement("div");
      row.textContent = text;
      split.append(row);
    };
    addSplitLine(`录音状态：${recordingLabel(s)}`);
    addSplitLine(`原始录音：${originalLabel(s)}`);
    addSplitLine(`MP3：${mp3Label(s)}`);
    const driveRow = document.createElement("div");
    driveRow.append(`Google 云端：${driveUploadLabel(s)}`);
    const driveUrl = resolveSessionDriveWebUrl(s);
    if (driveUrl) {
      driveRow.append(" · ");
      const link = document.createElement("a");
      link.href = driveUrl;
      link.className = "drive-cloud-link";
      link.textContent = driveLinkLabel(s);
      link.title = "在 Google Drive 中打开";
      link.onclick = (ev) => {
        ev.preventDefault();
        openSessionDriveLink(s);
      };
      driveRow.append(link);
    }
    split.append(driveRow);
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
      help.textContent = "上次异常中断，已保存部分仍然存在。可点「继续录音」接着录，或下载已有内容。";
    } else if (!mp3Busy && originalOk) {
      help.textContent = "可选择任意音质导出 MP3。也可点「继续录音」在同一条记录里接着录。";
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

    add("重命名", "outline", () => void renameSessionDisplayName(s));

    const regenerate = async (opts: {
      forceMono?: boolean;
      overrideBitrate?: number;
      label: string;
      exportDisplayName?: string;
    }) => {
      if (regeneratingSessions.has(s.id) || deletingSessionIds.has(s.id)) return;
      regeneratingSessions.add(s.id);
      const exportName = opts.exportDisplayName ?? exportDisplayNameForSession(s);
      try {
        const target = resolveBitrate(opts.overrideBitrate ?? (s.bitrate || DEFAULT_BITRATE));
        setStatus(`${opts.label}…`);
        await ask(MessageType.ExportSession, {
          sessionId: s.id,
          download: false,
          force: true,
          forceMono: opts.forceMono ?? target <= 16000,
          overrideBitrate: target,
          exportDisplayName: exportName
        });
        setStatus(`已按 ${Math.round(target / 1000)} kbps 生成 MP3：${exportName}`);
        await reloadHistoryVerified("after_regenerate");
        const dl = await downloadRecordingMp3(s.id, "retry", { filenameOverride: exportName });
        if (dl.ok) setStatus(`下载已开始：${dl.filename || ""}`);
        else setStatus(friendlyDownloadError(dl.error.code, dl.error.message));
      } catch (e) {
        setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
        await reloadHistoryVerified("after_regenerate_fail");
      } finally {
        regeneratingSessions.delete(s.id);
      }
    };

    const canContinue = canContinueRecording(s) && !mp3Busy;

    if (canContinue) {
      add("继续录音", "secondary", () => {
        void continueRecordingFromHistory(s.id);
      });
    }

    // Original download always available when data exists.
    if (originalOk) {
      add("下载原始录音", "play", () => {
        void (async () => {
          setStatus("正在准备原始录音…");
          try {
            const exportName = exportDisplayNameForSession(s);
            const result = await downloadOriginalRecording(s.id, {
              trigger: "manual",
              displayNameOverride: exportName
            });
            if (result.ok) setStatus(`原始录音下载已开始：${result.filename || ""}`);
            else setStatus(result.error?.message || "下载原始录音失败");
            await reloadHistoryVerified("after_original_download");
          } catch (e) {
            setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
          }
        })();
      });
    }

    if (canDownloadMp3 && settings.googleDriveEnabled) {
      const driveUrl = resolveSessionDriveWebUrl(s);
      if (driveUrl) {
        add("打开云端", "outline", () => openSessionDriveLink(s));
        add("复制链接", "copy-link", () => void copySessionDriveLink(s));
      }
      add("上传云端", "outline", () => {
        void (async () => {
          showDriveUploadProgress("正在上传到 Google Drive…", 0, true);
          try {
            const exportName = exportDisplayNameForSession(s);
            const result = (await ask(MessageType.GoogleDriveUploadMp3, {
              sessionId: s.id,
              filenameOverride: exportName
            })) as {
              ok: boolean;
              fileName?: string;
              webUrl?: string;
              error?: { message?: string };
            };
            if (!result.ok) {
              hideDriveUploadPanel();
              setStatus(result.error?.message || "上传失败");
            } else if (result.webUrl && result.fileName) {
              showDriveUploadComplete(result.fileName, result.webUrl);
            } else if (result.fileName) {
              setStatus(`已上传到 Google Drive：${result.fileName}`);
            }
            await reloadHistoryVerified("after_drive_upload");
          } catch (e) {
            hideDriveUploadPanel();
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
          const audio = new Audio();
          audio.preload = "auto";
          audio.src = url;
          const detachRecovery = attachPlaybackRecovery(audio);
          playingAudio = { sessionId: s.id, audio, url, detachRecovery };
          audio.onended = () => stopPlaybackIfSession(s.id);
          audio.onerror = () => stopPlaybackIfSession(s.id);
          await waitForMediaReady(audio).catch(() => undefined);
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
            const exportName = exportDisplayNameForSession(s);
            const result = await downloadRecordingMp3(s.id, "manual", { filenameOverride: exportName });
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
    }

    if (originalOk && !mp3Busy) {
      const exportRow = document.createElement("div");
      exportRow.className = "history-export";
      const label = document.createElement("label");
      label.className = "history-export-label";
      label.textContent = "导出音质";
      const sel = document.createElement("select");
      sel.className = "history-export-bitrate";
      sel.setAttribute("aria-label", "导出音质");
      const current = chosenExportBitrate(s);
      for (const p of BITRATE_PRESETS) {
        sel.append(new Option(p.label, String(p.bitrate), false, p.bitrate === current));
      }
      const sizeEl = document.createElement("span");
      sizeEl.className = "history-export-size";
      const updateSize = () => {
        const mb = estimateMp3Mb(Number(sel.value), s.durationMs || s.safeDurationMs || 0);
        sizeEl.textContent = mb > 0 ? `约 ${mb < 0.1 ? mb.toFixed(2) : mb.toFixed(1)} MB` : "";
      };
      updateSize();
      sel.onmousedown = () => holdHistoryExportUi();
      sel.onfocus = () => {
        holdHistoryExportUi();
        exportBitrateChoice.set(s.id, resolveBitrate(Number(sel.value) || current));
      };
      sel.onchange = () => {
        exportBitrateChoice.set(s.id, resolveBitrate(Number(sel.value)));
        updateSize();
        holdHistoryExportUi(800);
      };
      sel.onblur = () => holdHistoryExportUi(400);
      const exportBtn = document.createElement("button");
      exportBtn.type = "button";
      exportBtn.className = "btn small download";
      exportBtn.textContent = "导出MP3";
      exportBtn.disabled = isDeleting;
      exportBtn.onclick = () => {
        const exportName = exportDisplayNameForSession(s);
        const target = resolveBitrate(Number(sel.value) || chosenExportBitrate(s));
        exportBitrateChoice.set(s.id, target);
        const sameAsCurrent = canDownloadMp3 && target === resolveBitrate(s.bitrate || DEFAULT_BITRATE);
        if (sameAsCurrent) {
          void (async () => {
            exportBtn.disabled = true;
            exportBtn.textContent = "正在读取……";
            try {
              const result = await downloadRecordingMp3(s.id, "manual", { filenameOverride: exportName });
              if (!result.ok) {
                setStatus(friendlyDownloadError(result.error.code, result.error.message));
                return;
              }
              setStatus(`下载已开始：${result.filename}`);
            } catch (e) {
              setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
            } finally {
              exportBtn.textContent = "导出MP3";
              exportBtn.disabled = false;
            }
          })();
          return;
        }
        void regenerate({
          overrideBitrate: target,
          exportDisplayName: exportName,
          label: `正在按 ${Math.round(target / 1000)} kbps 导出 MP3`
        });
      };
      exportRow.append(label, sel, sizeEl, exportBtn);
      actions.append(exportRow);
    } else if (!originalOk && !canDownloadMp3 && !mp3Busy && s.mp3Status !== "skipped") {
      add("重新生成MP3", "download", () =>
        void regenerate({ label: "正在重新生成 MP3", exportDisplayName: exportDisplayNameForSession(s) })
      );
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
      renderHistory(historyRecords, historyActiveIds, true);
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
        renderHistory(historyRecords, historyActiveIds, true);
        setStatus("删除不完整，请重试。" + friendlyError(e instanceof Error ? e.message : String(e)));
      }
    });
    host.append(item);
  }
}

async function refresh() {
  const requestVersion = historyRequestVersion;
  const deferHistorySync = localMediaSessionActive;
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
    if (data.settings) {
      mergeSettingsFromPoll({ ...DEFAULT_SETTINGS, ...data.settings });
      if (!deferHistorySync) {
        syncDownloadSettingsUi();
        syncAutoStartSettingsUi();
        const sens = $<HTMLSelectElement>("detectionSensitivity");
        if (sens) sens.value = settings.detectionSensitivity || "standard";
      }
    }
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
      if (!localMediaPlaybackActive) {
        setWaveformMode("preview");
        void ensurePreviewMonitor();
      }
    }
    if (deferHistorySync) return;
    if (requestVersion !== historyRequestVersion) return;
    const livingIds = new Set(data.sessions.map((s) => s.id));
    const reconciled: Session[] = [];
    for (const s of data.sessions) {
      try {
        reconciled.push(await reconcileSessionMp3Status(s, livingIds));
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

async function continueRecordingFromHistory(sessionId: string) {
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
  busy = true;
  stopLocalMediaPlayback();
  $<HTMLButtonElement>("start").disabled = true;
  updateLocalMediaUi();
  setStatus("正在恢复录音……");
  try {
    await stopPreview();
    setWaveformMode("recording");
    await new Promise((r) => setTimeout(r, 120));
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.usage != null && estimate.usage / estimate.quota > 0.92) {
      throw new Error("本地存储空间不足，请先删除旧录音。");
    }
    const deviceLabel = devices.find((d) => d.deviceId === deviceId)?.label || "声音设备";
    const session = (await ask(MessageType.StartRecording, {
      continue: true,
      sessionId,
      deviceId,
      deviceLabel,
      bitrate: currentBitrate()
    })) as Session;
    selectedSession = session.id;
    recording = true;
    setWaveformMode("recording", session.id);
    startedAt = Date.now() - (session.safeDurationMs || 0);
    $<HTMLButtonElement>("stop").disabled = false;
    $<HTMLButtonElement>("start").textContent = "开始录音";
    setStatus(`继续录音中（已保存 ${fmt(session.safeDurationMs || 0)}）`);
    await ask(MessageType.SubscribeLevels);
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = setInterval(() => {
      $("elapsed").textContent = fmt(Date.now() - startedAt);
      updateBitrateCard();
    }, 250);
    await persistDefaultDevice();
    await reloadHistoryVerified("after_continue_start");
  } catch (e) {
    recording = false;
    selectedSession = undefined;
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
    $<HTMLButtonElement>("start").disabled = !devices.length;
    await startPreview();
  } finally {
    busy = false;
    updateLocalMediaUi();
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
  updateLocalMediaUi();
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
    await flushDownloadFolderSettings();
    const nameConfig = readRecordingNameConfigFromUi();
    await persistRecordingNameConfig(nameConfig);
    const displayName = buildSessionRecordingName(
      findRecordingNameProfile(settings, settings.activeRecordingNameProfileId)
    );
    const session = (await ask(MessageType.StartRecording, {
      mode: "device",
      deviceId,
      deviceLabel,
      displayName,
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
    await persistDefaultDevice();
  } catch (e) {
    recording = false;
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
    $<HTMLButtonElement>("start").disabled = !devices.length;
    await startPreview();
  } finally {
    busy = false;
    $<HTMLButtonElement>("start").textContent = "开始录音";
    updateLocalMediaUi();
  }
}

async function stopRecording() {
  if (!selectedSession || busy) return;
  busy = true;
  $<HTMLButtonElement>("stop").disabled = true;
  setStatus("正在结束录音……");
  try {
    await flushDownloadFolderSettings();
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

    const mode = (result?.mode as StopDownloadMode | undefined) || resolveStopDownloadMode(settings);
    let od = result?.originalDownload ?? null;
    if (
      !od &&
      shouldAutoDownloadOriginalAfterStop({ ...settings, stopDownloadMode: mode })
    ) {
      setStatus("正在准备原始录音下载……");
      od = await downloadOriginalRecording(id, { trigger: "auto" });
    }
    if (mode === "mp3_only") {
      setStatus("已完成（已按设置等待整合 MP3）");
    } else if (mode === "cloud_only") {
      setStatus(
        result?.mp3Queued
          ? "录音已停止。整合 MP3 正在生成并将上传到 Google 云端。"
          : "录音已停止。"
      );
    } else {
      setStatus("录音已经安全保存，正在准备下载……");
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
    previewHadSound = false;
    autoStartCooldownUntil = Date.now() + 2500;
    await refresh();
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  } finally {
    busy = false;
    $<HTMLButtonElement>("start").disabled = !devices.length;
    $<HTMLButtonElement>("stop").disabled = true;
    updateLocalMediaUi();
  }
}

function stopDownloadModeHint(mode: StopDownloadMode): string {
  if (mode === "original_only") {
    return settings.googleDriveEnabled && settings.googleDriveAutoUploadOnStop !== false
      ? "最快，不进行本机 MP3 转换；若已启用 Google 云端上传，仍会在后台生成 MP3 并上传。"
      : "最快，不进行 MP3 转换。继续录音后停止仍会保留全部原始分段。";
  }
  if (mode === "mp3_only") return "停止后在后台生成整合 MP3 再下载；若已启用 Google 云端上传，会同步上传。";
  if (mode === "cloud_only") {
    return settings.googleDriveEnabled
      ? "停止后生成整合 MP3 并上传到 Google 云端，不保存到本机（仅 MP3）。"
      : "需先在下方启用 Google 云端上传并连接账号。";
  }
  return "最安全。停止后马上取得原始录音，后台生成整合 MP3 后再自动下载；若已启用 Google 云端上传，会同步上传。";
}

async function refreshDownloadFolderUi() {
  const folderInput = $<HTMLInputElement>("downloadFolder");
  if (folderInput && document.activeElement !== folderInput) {
    folderInput.value = settings.downloadFolder ?? "";
  }
  const label = $("downloadFolderLabel");
  const useBtn = $<HTMLButtonElement>("useDownloadFolderBtn");
  const pickBtn = $<HTMLButtonElement>("pickDownloadFolder");
  const pickerOk = supportsDirectoryPicker();
  const hasCustom = Boolean(await getSavedDownloadDirectory());
  if (pickBtn) {
    pickBtn.disabled = false;
    pickBtn.title = pickerOk
      ? "保存到 D 盘等其他位置（不能选「下载」根目录）"
      : "当前浏览器扩展页不支持此功能，点击查看说明";
  }
  if (useBtn) useBtn.classList.toggle("active-mode", !hasCustom);
  if (pickBtn) pickBtn.classList.toggle("active-mode", hasCustom);
  const unsupportedHint = $("downloadFolderPickerUnsupported");
  if (unsupportedHint) {
    unsupportedHint.textContent = directoryPickerUnavailableMessage();
    unsupportedHint.classList.toggle("hidden", pickerOk);
  }
  const pathLabel = await describeDownloadDirectory(settings.downloadFolder);
  if (label) {
    label.textContent = hasCustom
      ? `当前（自定义文件夹）：${pathLabel}`
      : `当前（浏览器「下载」）：${downloadFolderHint(settings.downloadFolder)}`;
  }
}

function readDownloadFolderFromUi(): string {
  return $<HTMLInputElement>("downloadFolder").value.trim();
}

async function flushDownloadFolderSettings() {
  settings.downloadFolder = readDownloadFolderFromUi();
  await persistDownloadSettings();
}

let downloadFolderSaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleDownloadFolderSave() {
  clearTimeout(downloadFolderSaveTimer);
  downloadFolderSaveTimer = setTimeout(() => void flushDownloadFolderSettings(), 400);
}

async function useBrowserDownloadFolder() {
  await clearSavedDownloadDirectory();
  settings.customDownloadDirectoryName = undefined;
  await persistDownloadSettings();
  await refreshDownloadFolderUi();
  setStatus("已设为保存到浏览器下载文件夹。");
}

type DriveFolderBrowseFrame = { id?: string; name: string };

let driveFolderBrowseStack: DriveFolderBrowseFrame[] = [{ name: "我的云端硬盘" }];

function applyGoogleDriveEmail(email?: string) {
  const next = email?.trim();
  if (next) settings.googleDriveAccountEmail = next;
}

async function refreshGoogleDriveConnectionStatus() {
  if (!settings.googleDriveEnabled) {
    googleDriveAuthExpiresAt = null;
    googleDriveAuthHasRefreshToken = false;
    googleDriveAuthValid = false;
    syncGoogleDriveSettingsUi();
    return;
  }
  try {
    const data = (await ask(MessageType.GoogleDriveGetStatus)) as {
      email?: string;
      authExpiresAt?: number | null;
      authHasRefreshToken?: boolean;
      authValid?: boolean;
    };
    applyGoogleDriveEmail(data.email);
    googleDriveAuthExpiresAt = data.authExpiresAt ?? null;
    googleDriveAuthHasRefreshToken = data.authHasRefreshToken === true;
    googleDriveAuthValid = data.authValid === true;
  } catch {
    googleDriveAuthValid = false;
  }
  syncGoogleDriveSettingsUi();
}

function renderGoogleDriveAuthExpiryHint() {
  const el = $("googleDriveAuthExpiryHint");
  if (!el) return;
  const linked = isGoogleDriveLinked(settings);
  if (linked && !googleDriveAuthValid && !googleDriveAuthHasRefreshToken) {
    el.textContent = "Google 登录已失效，请点「连接 Google 账号」重新授权。";
    el.classList.remove("hidden");
    el.classList.add("warning");
    return;
  }
  const hint = linked
    ? formatGoogleAuthExpiryHint(googleDriveAuthExpiresAt, {
        hasRefreshToken: googleDriveAuthHasRefreshToken
      })
    : null;
  if (!hint) {
    el.textContent = "";
    el.classList.add("hidden");
    el.classList.remove("warning");
    return;
  }
  el.textContent = hint;
  el.classList.remove("hidden");
  el.classList.toggle(
    "warning",
    !googleDriveAuthHasRefreshToken && isGoogleAuthExpiryWarning(googleDriveAuthExpiresAt)
  );
}

function syncGoogleDriveSettingsUi() {
  const enabled = $<HTMLInputElement>("googleDriveEnabled");
  if (enabled) enabled.checked = settings.googleDriveEnabled === true;
  const clientInput = $<HTMLInputElement>("googleDriveClientId");
  if (clientInput && document.activeElement !== clientInput) {
    clientInput.value = settings.googleDriveClientId ?? "";
  }
  const secretInput = $<HTMLInputElement>("googleDriveClientSecret");
  if (secretInput && document.activeElement !== secretInput) {
    secretInput.value = settings.googleDriveClientSecret ?? "";
  }
  const extId = $("googleDriveExtensionId");
  const redirect = $("googleDriveRedirectUri");
  if (extId) extId.textContent = chrome.runtime.id;
  if (redirect) redirect.textContent = getGoogleRedirectUri();
  const redirectTutorial = $("googleDriveRedirectUriTutorial");
  if (redirectTutorial) redirectTutorial.textContent = getGoogleRedirectUri();
  const mode = $<HTMLSelectElement>("googleDriveUploadMode");
  if (mode) mode.value = settings.googleDriveUploadMode || "local_and_cloud";
  const auto = $<HTMLInputElement>("googleDriveAutoUploadOnStop");
  if (auto) auto.checked = settings.googleDriveAutoUploadOnStop !== false;
  const configured = isGoogleDriveConfigured(settings);
  const driveOn = settings.googleDriveEnabled === true;
  const setupGuide = $("googleDriveSetupGuide");
  if (setupGuide) setupGuide.classList.toggle("hidden", !driveOn);
  const setupHint = $("googleDriveSetupHint");
  if (setupHint) {
    setupHint.textContent = configured ? "" : googleDriveSetupHint();
    setupHint.classList.toggle("hidden", !driveOn || configured);
  }
  const panel = $("googleDrivePanel");
  if (panel) panel.classList.toggle("hidden", !driveOn);
  const account = $("googleDriveAccountLabel");
  if (account) {
    account.textContent = googleDriveAccountLabel(settings, {
      authValid: isGoogleDriveLinked(settings) ? googleDriveAuthValid : undefined
    });
  }
  const folder = $("googleDriveFolderLabel");
  if (folder) {
    folder.textContent = settings.googleDriveFolderName
      ? `当前文件夹：${settings.googleDriveFolderName}`
      : "当前文件夹：未选择";
  }
  const linked = isGoogleDriveLinked(settings);
  const needsConnect = !linked || !googleDriveAuthValid;
  const connectBtn = $<HTMLButtonElement>("googleDriveConnect");
  if (connectBtn) {
    connectBtn.disabled = googleDriveConnecting;
    connectBtn.classList.toggle("hidden", !needsConnect);
  }
  $<HTMLButtonElement>("googleDriveDisconnect")?.classList.toggle("hidden", !linked);
  renderGoogleDriveAuthExpiryHint();
  const privacy = $("privacyNote");
  if (privacy) {
    privacy.textContent = settings.googleDriveEnabled
      ? "录音保存在本机；启用 Google 云端上传后，MP3 可同步到 Google Drive。"
      : "录音默认保存在本机；启用 Google 云端上传后，MP3 可同步到 Google Drive。";
  }
}

async function refreshDriveFolderModal() {
  const current = driveFolderBrowseStack[driveFolderBrowseStack.length - 1]!;
  $("driveFolderPath").textContent = driveFolderBrowseStack.map((f) => f.name).join(" / ");
  const list = $("driveFolderList");
  list.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "hint";
  loading.textContent = "正在加载文件夹…";
  list.append(loading);
  try {
    const data = (await ask(MessageType.GoogleDriveListFolders, {
      parentId: current.id
    })) as { folders?: Array<{ id: string; name: string }>; email?: string };
    applyGoogleDriveEmail(data.email);
    list.replaceChildren();
    for (const folder of data.folders || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "drive-folder-item";
      btn.textContent = `📁 ${folder.name}`;
      btn.onclick = () => {
        driveFolderBrowseStack.push({ id: folder.id, name: folder.name });
        void refreshDriveFolderModal();
      };
      btn.ondblclick = async () => {
        settings.googleDriveFolderId = folder.id;
        settings.googleDriveFolderName = folder.name;
        await persistDownloadSettings();
        syncGoogleDriveSettingsUi();
        $("driveFolderModal").classList.add("hidden");
        setStatus(`已选择 Google Drive 文件夹：${folder.name}`);
      };
      list.append(btn);
    }
    if (!list.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "此目录下没有子文件夹。可新建文件夹，或双击上一级中的文件夹进入。";
      list.append(empty);
    }
  } catch (e) {
    list.replaceChildren();
    const err = document.createElement("p");
    err.className = "hint";
    err.textContent = friendlyError(e instanceof Error ? e.message : String(e));
    list.append(err);
  }
}

function syncDownloadSettingsUi() {
  const mode = (settings.stopDownloadMode || "original_then_mp3") as StopDownloadMode;
  const modeEl = $<HTMLSelectElement>("stopDownloadMode");
  if (modeEl) {
    modeEl.value = mode;
    const cloudOpt = modeEl.querySelector<HTMLOptionElement>('option[value="cloud_only"]');
    if (cloudOpt) cloudOpt.disabled = !settings.googleDriveEnabled;
  }
  const hint = $("stopDownloadModeHint");
  if (hint) hint.textContent = stopDownloadModeHint(mode);
  const autoOrig = $<HTMLInputElement>("autoDownloadOriginal");
  if (autoOrig) autoOrig.checked = settings.autoDownloadOriginal !== false;
  $<HTMLInputElement>("autoDownload").checked =
    settings.autoDownloadMp3AfterSuccess !== false && settings.autoDownloadMp3 !== false;
  const keep = $<HTMLInputElement>("keepOriginalAfterMp3");
  if (keep) keep.checked = settings.keepOriginalAfterMp3 !== false;
  void refreshDownloadFolderUi();
  syncGoogleDriveSettingsUi();
}

async function persistDownloadSettings(strict = false) {
  if (strict) {
    await ask(MessageType.SaveSettings, { ...settings }, 2);
    return;
  }
  await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
}

async function tryRestoreGoogleAuthSession(
  authSession?: { accessToken: string; expiresAt: number; clientId: string; refreshToken?: string } | null,
  accountEmail?: string
): Promise<boolean> {
  if (!authSession || !isUsableAuthSessionExport(authSession)) return false;
  try {
    const restored = (await ask(
      MessageType.GoogleDriveRestoreAuthSession,
      { authSession },
      2
    )) as { ok?: boolean; email?: string };
    if (!restored?.ok) return false;
    if (restored.email) settings.googleDriveAccountEmail = restored.email;
    else if (accountEmail?.trim()) settings.googleDriveAccountEmail = accountEmail.trim();
    await persistDownloadSettings(true);
    syncGoogleDriveSettingsUi();
    await refreshGoogleDriveConnectionStatus();
    return true;
  } catch (e) {
    console.warn("[GoogleDriveImport] auth restore failed", e);
    return false;
  }
}

async function tryRestoreGoogleAuthFromConfig(
  config: ReturnType<typeof parseGoogleDriveConfig>
): Promise<boolean> {
  return tryRestoreGoogleAuthSession(config.authSession, config.googleDrive.accountEmail);
}

function syncAllSettingsUi() {
  syncRecordingNameProfilesUi();
  syncDownloadSettingsUi();
  syncAutoStartSettingsUi();
  const sens = $<HTMLSelectElement>("detectionSensitivity");
  if (sens) sens.value = settings.detectionSensitivity || "standard";
  const def = $<HTMLSelectElement>("defaultBitrate");
  if (def) def.value = String(settings.defaultBitrate || DEFAULT_BITRATE);
  $<HTMLSelectElement>("bitrate").value = String(settings.defaultBitrate || DEFAULT_BITRATE);
  updateBitrateCard();
  syncGoogleDriveSettingsUi();
}

async function importGoogleDriveConfigPayload(config: ReturnType<typeof parseGoogleDriveConfig>) {
  settings = applyGoogleDriveConfig(settings, config);
  syncGoogleDriveSettingsUi();
  await syncGoogleDriveSettingsToStorage();
  syncDownloadSettingsUi();

  const authRestored = await tryRestoreGoogleAuthFromConfig(config);
  if (!authRestored) await refreshGoogleDriveConnectionStatus();

  if (authRestored && canUploadToGoogleDrive(settings)) {
    setStatus(
      `配置已导入，云端上传已就绪（${settings.googleDriveAccountEmail || "已恢复登录"}），无需重新登录 Google。`
    );
    return;
  }

  if (config.authSession && !authRestored) {
    const needsSecret = Boolean(
      config.authSession.refreshToken?.trim() && !config.googleDrive.clientSecret?.trim()
    );
    if (needsSecret) {
      setStatus(
        "配置已导入，但缺少客户端密钥，无法恢复长期登录。请填写密钥后点「连接 Google 账号」。"
      );
      if (settings.stopDownloadMode === "cloud_only") {
        settings = applyStopDownloadModeToSettings(settings, "original_then_mp3");
        await persistDownloadSettings();
        syncDownloadSettingsUi();
      }
      return;
    }
    if (settings.googleDriveEnabled && isGoogleDriveConfigured(settings)) {
      try {
        setStatus("配置已导入，登录状态无效，正在打开 Google 授权…");
        const data = await connectGoogleDriveAccount();
        setStatus(`配置已导入并连接 Google 账号：${data.email || ""}`);
        return;
      } catch (e) {
        setStatus(friendlyGoogleConnectError(e instanceof Error ? e.message : String(e)));
        if (settings.stopDownloadMode === "cloud_only") {
          settings = applyStopDownloadModeToSettings(settings, "original_then_mp3");
          await persistDownloadSettings();
          syncDownloadSettingsUi();
        }
        return;
      }
    }
    setStatus("配置已导入，但登录状态已过期或无效，请点「连接 Google 账号」。");
    if (settings.stopDownloadMode === "cloud_only") {
      settings = applyStopDownloadModeToSettings(settings, "original_then_mp3");
      await persistDownloadSettings();
      syncDownloadSettingsUi();
    }
    return;
  }

  if (settings.googleDriveEnabled && isGoogleDriveConfigured(settings)) {
    try {
      setStatus("配置已导入，正在打开 Google 授权…");
      const data = await connectGoogleDriveAccount();
      setStatus(`配置已导入并连接 Google 账号：${data.email || ""}`);
    } catch (e) {
      settings = applyStopDownloadModeToSettings(settings, "original_then_mp3");
      await persistDownloadSettings();
      syncDownloadSettingsUi();
      setStatus(
        `配置已导入（文件夹：${settings.googleDriveFolderName || settings.googleDriveFolderId}）。${friendlyGoogleConnectError(e instanceof Error ? e.message : String(e))}`
      );
    }
  } else {
    setStatus(
      `配置已导入（文件夹：${settings.googleDriveFolderName || settings.googleDriveFolderId || "—"}）。${isGoogleDriveConfigured(settings) ? "请点「连接 Google 账号」。" : googleDriveSetupHint()}`
    );
  }
}

async function importFullSettingsBackup(doc: SettingsBackupExport) {
  settings = applySettingsBackupImport(doc);
  await persistDownloadSettings(true);
  syncAllSettingsUi();

  const authRestored = await tryRestoreGoogleAuthSession(
    doc.authSession,
    doc.settings.googleDriveAccountEmail
  );
  if (!authRestored) await refreshGoogleDriveConnectionStatus();

  const folderHint = settings.customDownloadDirectoryName
    ? `自定义保存路径「${settings.customDownloadDirectoryName}」需重新点「选择其他位置…」授权。`
    : "";
  if (authRestored && settings.googleDriveEnabled && canUploadToGoogleDrive(settings)) {
    setStatus(
      `全部设置已导入，Google 云端已就绪（${settings.googleDriveAccountEmail || "已恢复登录"}）。${folderHint}`
    );
    return;
  }
  if (settings.googleDriveEnabled && doc.authSession && !authRestored) {
    const needsSecret = Boolean(
      doc.authSession.refreshToken?.trim() && !settings.googleDriveClientSecret?.trim()
    );
    if (needsSecret) {
      setStatus(
        `全部设置已导入，但缺少客户端密钥，无法恢复 Google 登录。请填写密钥后点「连接 Google 账号」。${folderHint}`
      );
      if (settings.stopDownloadMode === "cloud_only") {
        settings = applyStopDownloadModeToSettings(settings, "original_then_mp3");
        await persistDownloadSettings();
        syncDownloadSettingsUi();
      }
      return;
    }
    if (isGoogleDriveConfigured(settings)) {
      try {
        setStatus("全部设置已导入，正在打开 Google 授权…");
        const data = await connectGoogleDriveAccount();
        setStatus(`全部设置已导入并连接 Google 账号：${data.email || ""}。${folderHint}`);
        return;
      } catch (e) {
        setStatus(
          `全部设置已导入。${friendlyGoogleConnectError(e instanceof Error ? e.message : String(e))} ${folderHint}`
        );
        if (settings.stopDownloadMode === "cloud_only") {
          settings = applyStopDownloadModeToSettings(settings, "original_then_mp3");
          await persistDownloadSettings();
          syncDownloadSettingsUi();
        }
        return;
      }
    }
  }
  setStatus(`全部设置已导入。${folderHint}`.trim());
}

async function fetchAuthSessionForExport(clientId: string) {
  let authSession =
    (
      (await ask(MessageType.GoogleDriveGetAuthSessionExport)) as {
        authSession?: {
          accessToken: string;
          expiresAt: number;
          clientId: string;
          refreshToken?: string;
        };
      }
    ).authSession ?? (await getAuthSessionForExport());
  if (authSession && clientId) {
    authSession = { ...authSession, clientId };
  }
  return authSession;
}

/** Run OAuth in the dashboard page so Brave/Chrome can show the Google popup reliably. */
async function connectGoogleDriveAccount(): Promise<{ email?: string }> {
  flushGoogleDriveCredentialsFromUi();
  if (!isGoogleDriveConfigured(settings)) {
    throw new Error(`${googleDriveSetupHint()} 请填写 OAuth 客户端 ID 后重试。`);
  }
  if (googleDriveConnecting) {
    throw new Error("正在连接 Google 账号，请稍候…");
  }
  googleDriveConnecting = true;
  const connectBtn = $<HTMLButtonElement>("googleDriveConnect");
  if (connectBtn) connectBtn.disabled = true;
  try {
    setStatus("正在连接 Google 账号…（若 Brave 拦截弹窗，请允许本扩展的弹出窗口）");
    await syncGoogleDriveSettingsToStorage();
    const { email } = await connectGoogleAccount();
    settings.googleDriveAccountEmail = email;
    settings.googleDriveEnabled = true;
    if (!settings.googleDriveFolderId?.trim()) {
      setStatus("正在准备 Google Drive 文件夹…");
      const folder = await ensureDefaultDriveFolder();
      settings.googleDriveFolderId = folder.id;
      settings.googleDriveFolderName = folder.name;
    }
    await syncGoogleDriveSettingsToStorage();
    syncGoogleDriveSettingsUi();
    await refreshGoogleDriveConnectionStatus();
    return { email };
  } finally {
    googleDriveConnecting = false;
    syncGoogleDriveSettingsUi();
  }
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
$("device").onchange = () => {
  cachedBrowserDefault = null;
  void persistDefaultDevice();
  void startPreview();
};
$("verifyDeviceBtn").onclick = () => void refreshDeviceVerification(true);
function setRecordingNameEditorOpen(open: boolean) {
  $("recNameEditor").classList.toggle("hidden", !open);
  const btn = $<HTMLButtonElement>("recNameEditToggle");
  btn.textContent = open ? "收起" : "修改";
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (!open) $("recNameAddMenu").classList.add("hidden");
}

async function addRecordingNameItem(kind: RecordingNamePart) {
  const config = readRecordingNameConfigFromUi();
  if (config.items.length >= MAX_RECORDING_NAME_ITEMS) return;
  const extras =
    kind === "number" ? { numberSeed: 1, numberSeedDate: formatDateOnly(new Date()) } : kind === "custom" ? { text: "" } : {};
  config.items.push(createRecordingNameItem(kind, extras));
  applyRecordingNameConfigToUi(config);
  await persistRecordingNameConfig(config);
  const added = config.items.at(-1);
  if (!added) return;
  const focusId = kind === "custom" ? `rec-name-custom-${added.id}` : kind === "number" ? `rec-name-number-${added.id}` : "";
  if (focusId) (document.getElementById(focusId) as HTMLInputElement | null)?.focus();
}

async function removeRecordingNameItem(id: string) {
  const config = readRecordingNameConfigFromUi();
  config.items = config.items.filter((item) => item.id !== id);
  applyRecordingNameConfigToUi(config);
  await persistRecordingNameConfig(config);
}

$("recNameProfileSelect").onchange = async () => {
  const profileId = $<HTMLSelectElement>("recNameProfileSelect").value;
  settings = setActiveRecordingNameProfile(settings, profileId);
  await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
  syncRecordingNameProfilesUi();
  await syncActiveRecordingSessionName(true);
};
$("recNameProfileAdd").onclick = async () => {
  settings = addRecordingNameProfile(settings);
  await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
  syncRecordingNameProfilesUi();
  setRecordingNameEditorOpen(true);
};
$("recNameProfileRename").onclick = () => {
  void (async () => {
    const profileId = $<HTMLSelectElement>("recNameProfileSelect").value;
    const profile = findRecordingNameProfile(settings, profileId);
    const next = window.prompt("命名方案名称", profile.label);
    if (next == null) return;
    settings = renameRecordingNameProfile(settings, profileId, next);
    await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
    syncRecordingNameProfilesUi();
  })();
};
$("recNameProfileDelete").onclick = () => {
  void (async () => {
    const { profiles } = normalizeRecordingNameProfiles(settings);
    if (profiles.length <= 1) return;
    const profileId = $<HTMLSelectElement>("recNameProfileSelect").value;
    const profile = findRecordingNameProfile(settings, profileId);
    const ok = await showConfirm({
      title: "删除命名方案",
      body: `确定删除「${profile.label}」吗？`,
      cancelText: "取消",
      okText: "删除",
      danger: true
    });
    if (!ok) return;
    settings = removeRecordingNameProfile(settings, profileId);
    await ask(MessageType.SaveSettings, { ...settings }).catch(() => undefined);
    syncRecordingNameProfilesUi();
  })();
};

$("recNameEditToggle").onclick = () => {
  const open = $("recNameEditor").classList.contains("hidden");
  setRecordingNameEditorOpen(open);
};
$("recNameAddBtn").onclick = (e) => {
  e.stopPropagation();
  $("recNameAddMenu").classList.toggle("hidden");
};
for (const btn of $("recNameAddMenu").querySelectorAll<HTMLButtonElement>("[data-add]")) {
  btn.onclick = (e) => {
    e.stopPropagation();
    const part = btn.dataset.add as RecordingNamePart;
    $("recNameAddMenu").classList.add("hidden");
    if (part) void addRecordingNameItem(part);
  };
}
$("recNameToggles").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-remove-id]");
  const id = btn?.dataset.removeId;
  if (id) void removeRecordingNameItem(id);
});
document.addEventListener("click", (e) => {
  const wrap = $("recNameAddBtn").parentElement;
  if (wrap && !wrap.contains(e.target as Node)) $("recNameAddMenu").classList.add("hidden");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("recNameAddMenu").classList.add("hidden");
});

async function persistRecordingDateStyle(includeYear: boolean) {
  syncRecordingDateStyleButtons(includeYear);
  updateRecordingNamePreview();
  await persistRecordingNameConfig(readRecordingNameConfigFromUi());
}
$("recNameDateMd").onclick = () => void persistRecordingDateStyle(false);
$("recNameDateYmd").onclick = () => void persistRecordingDateStyle(true);

let recNameDragId: string | null = null;
$("recNameToggles").addEventListener("dragstart", (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".rec-name-chip[data-id]");
  if (!chip) return;
  recNameDragId = chip.dataset.id || null;
  chip.classList.add("dragging");
  e.dataTransfer?.setData("text/plain", recNameDragId || "");
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
});
$("recNameToggles").addEventListener("dragend", () => {
  recNameDragId = null;
  $("recNameToggles")
    .querySelectorAll(".rec-name-chip.dragging, .rec-name-chip.drag-over")
    .forEach((el) => el.classList.remove("dragging", "drag-over"));
});
$("recNameToggles").addEventListener("dragover", (e) => {
  e.preventDefault();
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".rec-name-chip[data-id]");
  $("recNameToggles").querySelectorAll(".rec-name-chip.drag-over").forEach((el) => el.classList.remove("drag-over"));
  if (chip && recNameDragId && chip.dataset.id !== recNameDragId) chip.classList.add("drag-over");
});
$("recNameToggles").addEventListener("drop", (e) => {
  e.preventDefault();
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".rec-name-chip[data-id]");
  chip?.classList.remove("drag-over");
  const from = recNameDragId;
  const to = chip?.dataset.id;
  if (!from || !to || from === to) return;
  const config = readRecordingNameConfigFromUi();
  const fromIdx = config.items.findIndex((item) => item.id === from);
  const toIdx = config.items.findIndex((item) => item.id === to);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = config.items.splice(fromIdx, 1);
  if (!moved) return;
  config.items.splice(toIdx, 0, moved);
  applyRecordingNameConfigToUi(config);
  void persistRecordingNameConfig(config);
});

$("recNameItemFields").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id.startsWith("rec-name-number-")) {
    const id = input.id.slice("rec-name-number-".length);
    const config = readRecordingNameConfigFromUi();
    const item = config.items.find((i) => i.id === id && i.kind === "number");
    if (item) item.numberSeedDate = formatDateOnly(new Date());
    applyRecordingNameConfigToUi(config);
    void persistRecordingNameConfig(config);
  }
});
$("recNameItemFields").addEventListener("input", () => {
  updateRecordingNamePreview();
  void persistRecordingNameConfig(readRecordingNameConfigFromUi());
});
$("localMediaFile").onchange = () => {
  const input = $<HTMLInputElement>("localMediaFile");
  const files = input.files;
  if (!files?.length) return;
  addLocalMediaFiles(files);
  input.value = "";
};
$("localMediaClearPlaylistBtn").onclick = () => clearLocalMediaPlaylist();
$("localMediaPlayBtn").onclick = () => void playLocalMediaPlaylist();
$("localMediaStopBtn").onclick = () => stopLocalMediaPlayback();
$("localMediaPlaylist").addEventListener("dragstart", (e) => {
  if (localMediaPlaybackActive || recording || busy) {
    e.preventDefault();
    return;
  }
  if ((e.target as HTMLElement).closest(".local-media-playlist-actions")) {
    e.preventDefault();
    return;
  }
  const item = (e.target as HTMLElement).closest<HTMLElement>(".local-media-playlist-item[data-id]");
  if (!item) return;
  localMediaDragId = item.dataset.id || null;
  item.classList.add("dragging");
  e.dataTransfer?.setData("text/plain", localMediaDragId || "");
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
});
$("localMediaPlaylist").addEventListener("dragend", () => {
  localMediaDragId = null;
  $("localMediaPlaylist")
    .querySelectorAll(".local-media-playlist-item.dragging, .local-media-playlist-item.drag-over")
    .forEach((el) => el.classList.remove("dragging", "drag-over"));
});
$("localMediaPlaylist").addEventListener("dragover", (e) => {
  if (!localMediaDragId || localMediaPlaybackActive || recording || busy) return;
  e.preventDefault();
  const item = (e.target as HTMLElement).closest<HTMLElement>(".local-media-playlist-item[data-id]");
  $("localMediaPlaylist")
    .querySelectorAll(".local-media-playlist-item.drag-over")
    .forEach((el) => el.classList.remove("drag-over"));
  if (item && item.dataset.id !== localMediaDragId) item.classList.add("drag-over");
});
$("localMediaPlaylist").addEventListener("drop", (e) => {
  e.preventDefault();
  const item = (e.target as HTMLElement).closest<HTMLElement>(".local-media-playlist-item[data-id]");
  item?.classList.remove("drag-over");
  const from = localMediaDragId;
  const to = item?.dataset.id;
  localMediaDragId = null;
  if (!from || !to || from === to) return;
  moveLocalMediaPlaylistItem(from, to);
});
$("start").onclick = () => void startRecording();
$("stop").onclick = () => void stopRecording();
$("settingsBtn").onclick = () => $("settingsPanel").classList.toggle("hidden");
$("exportAllSettings").onclick = () => {
  void (async () => {
    try {
      flushGoogleDriveCredentialsFromUi();
      await syncGoogleDriveSettingsToStorage();
      const exportClientId = $<HTMLInputElement>("googleDriveClientId").value.trim();
      const authSession = exportClientId
        ? await fetchAuthSessionForExport(exportClientId)
        : await fetchAuthSessionForExport(settings.googleDriveClientId?.trim() || "");
      if (
        settings.googleDriveEnabled &&
        isGoogleDriveLinked(settings) &&
        !isUsableAuthSessionExport(authSession)
      ) {
        setStatus(
          "导出失败：Google 登录无法备份。请填写客户端密钥后重新点「连接 Google 账号」完成长期授权，再导出。"
        );
        return;
      }
      const doc = buildSettingsBackupExport(settings, authSession);
      const json = JSON.stringify(doc, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = settingsBackupFileName(doc.exportedAt);
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const detail = describeSettingsBackupExport(authSession);
      setStatus(`全部设置已导出（${detail}）此文件含 Google 密钥与登录信息，请勿分享或上传到公开位置。`);
    } catch (e) {
      setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  })();
};
$("importAllSettings").onclick = () => $<HTMLInputElement>("importAllSettingsFile").click();
$("importAllSettingsFile").onchange = async () => {
  const input = $<HTMLInputElement>("importAllSettingsFile");
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const confirmed = await showConfirm({
    title: "导入全部设置？",
    body: `将用「${file.name}」中的设置替换当前全部选项（含 Google 云端、命名方案、下载方式等）。现有设置会被覆盖。`,
    cancelText: "取消",
    okText: "开始导入"
  });
  if (!confirmed) return;
  try {
    const text = await file.text();
    const payload = parseSettingsImport(text);
    if (payload.type === "full") {
      await importFullSettingsBackup(payload.doc);
      return;
    }
    await importGoogleDriveConfigPayload(payload.doc);
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  }
};
$("helpBtn").onclick = () => void openHelpOrAsk();
$("helpDevicesLink").onclick = () => void openHelpOrAsk("devices");
$("helpNameLink").onclick = () => void openHelpOrAsk("name");
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
$("downloadFolder").onchange = async () => {
  settings.downloadFolder = readDownloadFolderFromUi();
  await refreshDownloadFolderUi();
  await persistDownloadSettings();
};
$("downloadFolder").oninput = () => {
  settings.downloadFolder = readDownloadFolderFromUi();
  void refreshDownloadFolderUi();
  scheduleDownloadFolderSave();
};
$("useDownloadFolderBtn").onclick = () => {
  void useBrowserDownloadFolder();
};
$("pickDownloadFolder").onclick = async () => {
  if (!supportsDirectoryPicker()) {
    setStatus(directoryPickerUnavailableMessage());
    return;
  }
  try {
    const handle = await pickDownloadDirectory();
    settings.customDownloadDirectoryName = handle.name;
    await persistDownloadSettings();
    await refreshDownloadFolderUi();
    setStatus(`已选择保存文件夹：${handle.name}`);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    if (isProtectedFolderPickError(e)) {
      setStatus(friendlyProtectedFolderPickError());
      return;
    }
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  }
};
async function persistGoogleDriveClientId(showStatus = true) {
  const input = $<HTMLInputElement>("googleDriveClientId");
  const next = input.value.trim();
  const prev = settings.googleDriveClientId?.trim() ?? "";
  if (next === prev) return;
  settings.googleDriveAccountEmail = undefined;
  await ask(MessageType.GoogleDriveRevokeAuth).catch(() => undefined);
  settings.googleDriveClientId = next || undefined;
  await setSettings({ googleDriveClientId: next || undefined });
  if (document.activeElement !== input) {
    input.value = settings.googleDriveClientId ?? "";
  }
  syncGoogleDriveSettingsUi();
  if (showStatus) {
    setStatus(
      next
        ? "客户端 ID 已保存到本机。请同时备份到记事本/密码管理器，换电脑时要用。请点「连接 Google 账号」。"
        : "客户端 ID 已清除。"
    );
  }
}

async function persistGoogleDriveClientSecret(showStatus = true) {
  const input = $<HTMLInputElement>("googleDriveClientSecret");
  const next = input.value.trim();
  const prev = settings.googleDriveClientSecret?.trim() ?? "";
  if (next === prev) return;
  settings.googleDriveClientSecret = next || undefined;
  await setSettings({ googleDriveClientSecret: next || undefined });
  if (document.activeElement !== input) {
    input.value = settings.googleDriveClientSecret ?? "";
  }
  syncGoogleDriveSettingsUi();
  if (showStatus) {
    setStatus(
      next
        ? "客户端密钥已保存到本机。请同时备份到记事本/密码管理器（Google 只显示一次）。请重新点「连接 Google 账号」以启用长期自动续期。"
        : "客户端密钥已清除。"
    );
  }
}

let googleDriveClientSecretSaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleGoogleDriveClientSecretSave() {
  clearTimeout(googleDriveClientSecretSaveTimer);
  googleDriveClientSecretSaveTimer = setTimeout(() => void persistGoogleDriveClientSecret(), 500);
}

let googleDriveClientIdSaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleGoogleDriveClientIdSave() {
  clearTimeout(googleDriveClientIdSaveTimer);
  googleDriveClientIdSaveTimer = setTimeout(() => void persistGoogleDriveClientId(), 500);
}

$("googleDriveEnabled").onchange = async () => {
  settings.googleDriveEnabled = $<HTMLInputElement>("googleDriveEnabled").checked;
  syncGoogleDriveSettingsUi();
  await persistDownloadSettings();
  if (settings.googleDriveEnabled) {
    await refreshGoogleDriveConnectionStatus();
  }
};
$("googleDriveClientId").oninput = () => scheduleGoogleDriveClientIdSave();
$("googleDriveClientId").onchange = () => {
  clearTimeout(googleDriveClientIdSaveTimer);
  void persistGoogleDriveClientId();
};
$("googleDriveClientSecret").oninput = () => scheduleGoogleDriveClientSecretSave();
$("googleDriveClientSecret").onchange = () => {
  clearTimeout(googleDriveClientSecretSaveTimer);
  void persistGoogleDriveClientSecret();
};
$("googleDriveUploadMode").onchange = async () => {
  settings.googleDriveUploadMode = $<HTMLSelectElement>("googleDriveUploadMode").value as
    | "local_and_cloud"
    | "cloud_only";
  await persistDownloadSettings();
};
$("googleDriveAutoUploadOnStop").onchange = async () => {
  settings.googleDriveAutoUploadOnStop = $<HTMLInputElement>("googleDriveAutoUploadOnStop").checked;
  await persistDownloadSettings();
};
$("googleDriveExportConfig").onclick = () => {
  void (async () => {
    try {
      flushGoogleDriveCredentialsFromUi();
      await syncGoogleDriveSettingsToStorage();
      if (!settings.googleDriveFolderId?.trim()) {
        setStatus("请先选择 Google Drive 文件夹后再导出配置。");
        return;
      }
      const exportCredentials = {
        clientId: $<HTMLInputElement>("googleDriveClientId").value.trim(),
        clientSecret: $<HTMLInputElement>("googleDriveClientSecret").value.trim()
      };
      if (!exportCredentials.clientId) {
        setStatus("导出失败：请填写 OAuth 客户端 ID。");
        return;
      }
      let authSession = await fetchAuthSessionForExport(exportCredentials.clientId);
      if (isGoogleDriveLinked(settings) && !isUsableAuthSessionExport(authSession)) {
        setStatus(
          "导出失败：当前 Google 登录无法备份。请填写客户端密钥后重新点「连接 Google 账号」完成长期授权，再导出。"
        );
        return;
      }
      const json = serializeGoogleDriveConfig(settings, authSession, exportCredentials);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = googleDriveConfigFileName();
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const detail = describeGoogleDriveConfigExport(authSession);
      setStatus(
        `Google 云端配置已导出（${detail}）此文件含 ID、密钥与登录信息，请勿分享或上传到公开位置。`
      );
    } catch (e) {
      setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  })();
};
$("googleDriveImportConfig").onclick = () => $<HTMLInputElement>("googleDriveImportConfigFile").click();
$("googleDriveClearConfig").onclick = () => {
  void (async () => {
    const ok = await showConfirm({
      title: "确定要清空云端配置吗？",
      body: "将清除 OAuth 客户端 ID/密钥、Google 登录、文件夹与上传选项，并取消「启用 Google Drive 上传」。此操作不可撤销，清空后需重新配置。",
      cancelText: "取消",
      okText: "清空云端配置",
      danger: true
    });
    if (!ok) return;
    try {
      await ask(MessageType.GoogleDriveDisconnect).catch(() => undefined);
      resetGoogleDriveCredentialInputs();
      const clearPatch = googleDriveSettingsClearPatch(settings);
      settings = clearGoogleDriveSettings(settings);
      const merged = await setSettings(clearPatch);
      Object.assign(settings, merged);
      googleDriveAuthExpiresAt = null;
      googleDriveAuthHasRefreshToken = false;
      googleDriveAuthValid = false;
      syncDownloadSettingsUi();
      syncGoogleDriveSettingsUi();
      setStatus("已清空 Google 云端配置。如需再次使用，请重新填写客户端 ID 并连接账号。");
    } catch (e) {
      setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  })();
};
$("googleDriveImportConfigFile").onchange = async () => {
  const input = $<HTMLInputElement>("googleDriveImportConfigFile");
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const config = parseGoogleDriveConfig(text);
    await importGoogleDriveConfigPayload(config);
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  }
};
$("googleDriveConnect").onclick = () => {
  setStatus("正在连接 Google 账号…");
  void (async () => {
    try {
      const data = await connectGoogleDriveAccount();
      setStatus(data.email ? `已连接 Google 账号：${data.email}` : "已连接 Google 账号");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setStatus(friendlyGoogleConnectError(raw));
      console.warn("[GoogleDriveConnect]", raw, e);
    }
  })();
};
$("googleDriveDisconnect").onclick = async () => {
  try {
    await ask(MessageType.GoogleDriveDisconnect);
    settings.googleDriveAccountEmail = undefined;
    googleDriveAuthExpiresAt = null;
    googleDriveAuthHasRefreshToken = false;
    googleDriveAuthValid = false;
    await persistDownloadSettings();
    syncGoogleDriveSettingsUi();
    setStatus("已断开 Google 账号，文件夹设置已保留。请重新点「连接 Google 账号」。");
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  }
};
$("googleDriveUseDefaultFolder").onclick = async () => {
  try {
    setStatus("正在创建/查找默认文件夹…");
    const folder = (await ask(MessageType.GoogleDriveEnsureDefaultFolder)) as { id: string; name: string; email?: string };
    settings.googleDriveFolderId = folder.id;
    settings.googleDriveFolderName = folder.name;
    applyGoogleDriveEmail(folder.email);
    await persistDownloadSettings();
    syncGoogleDriveSettingsUi();
    setStatus(`已选择文件夹：${folder.name}`);
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  }
};
$("googleDrivePickFolder").onclick = async () => {
  driveFolderBrowseStack = [{ name: "我的云端硬盘" }];
  $("driveFolderModal").classList.remove("hidden");
  await refreshDriveFolderModal();
};
$("driveFolderCancel").onclick = () => $("driveFolderModal").classList.add("hidden");
$("driveFolderUp").onclick = () => {
  if (driveFolderBrowseStack.length > 1) driveFolderBrowseStack.pop();
  void refreshDriveFolderModal();
};
$("driveFolderSelectCurrent").onclick = async () => {
  const current = driveFolderBrowseStack[driveFolderBrowseStack.length - 1];
  if (!current?.id) {
    setStatus("请进入某个文件夹后再选择，或使用「创建并选择」。");
    return;
  }
  settings.googleDriveFolderId = current.id;
  settings.googleDriveFolderName = current.name;
  await persistDownloadSettings();
  syncGoogleDriveSettingsUi();
  $("driveFolderModal").classList.add("hidden");
  setStatus(`已选择 Google Drive 文件夹：${current.name}`);
};
$("driveFolderCreateBtn").onclick = async () => {
  const name = $<HTMLInputElement>("driveFolderNewName").value.trim() || "SafeCallRecorder";
  const parent = driveFolderBrowseStack[driveFolderBrowseStack.length - 1];
  try {
    const folder = (await ask(MessageType.GoogleDriveCreateFolder, {
      name,
      parentId: parent?.id
    })) as { id: string; name: string };
    settings.googleDriveFolderId = folder.id;
    settings.googleDriveFolderName = folder.name;
    await persistDownloadSettings();
    syncGoogleDriveSettingsUi();
    $("driveFolderModal").classList.add("hidden");
    setStatus(`已创建并选择文件夹：${folder.name}`);
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  }
};
$("stopDownloadMode").onchange = async () => {
  const mode = $<HTMLSelectElement>("stopDownloadMode").value as StopDownloadMode;
  settings = applyStopDownloadModeToSettings(settings, mode);
  syncDownloadSettingsUi();
  await persistDownloadSettings();
};
$("detectionSensitivity").onchange = async () => {
  const v = $<HTMLSelectElement>("detectionSensitivity").value;
  settings.detectionSensitivity =
    v === "sensitive" || v === "stable" ? v : "standard";
  await ask(MessageType.SaveSettings, { ...settings });
  previewHadSound = false;
  if (!recording) await startPreview();
};
$("autoStartRecording").onchange = async () => {
  settings.autoStartRecording = $<HTMLInputElement>("autoStartRecording").checked;
  if (settings.autoStartRecording) {
    settings.autoStartOnSound = true;
    settings.autoStartOnLocalMediaTab = settings.autoStartOnLocalMediaTab !== false;
    settings.autoStartOnLocalMediaEnded = settings.autoStartOnLocalMediaEnded !== false;
  }
  syncAutoStartSettingsUi();
  previewHadSound = false;
  await persistAutoStartSettings();
};
$("autoStartOnLocalMediaTab").onchange = async () => {
  settings.autoStartOnLocalMediaTab = $<HTMLInputElement>("autoStartOnLocalMediaTab").checked;
  settings.autoStartRecording = true;
  $<HTMLInputElement>("autoStartRecording").checked = true;
  await persistAutoStartSettings();
};
$("autoStartOnLocalMediaEnded").onchange = async () => {
  settings.autoStartOnLocalMediaEnded = $<HTMLInputElement>("autoStartOnLocalMediaEnded").checked;
  settings.autoStartRecording = true;
  $<HTMLInputElement>("autoStartRecording").checked = true;
  await persistAutoStartSettings();
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

async function downloadBackupBlob(blob: Blob, filename: string) {
  const saved = await saveDownloadBlob(blob, filename);
  if (!saved.ok) throw new Error(saved.error.message);
}

function formatBackupSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

$("exportHistory").onclick = async () => {
  if (exportingHistory || importingHistory || clearingHistory) return;
  exportingHistory = true;
  updateHistoryToolbar();
  try {
    const result = await exportHistoryBackup((msg) => setStatus(msg));
    const filename = buildHistoryBackupFileName();
    await downloadBackupBlob(result.blob, filename);
    const skipNote =
      result.skippedSessionIds.length > 0
        ? `，已跳过处理中 ${result.skippedSessionIds.length} 条`
        : "";
    setStatus(
      `已导出 ${result.exportedSessions} 条录音历史（约 ${formatBackupSize(result.totalBytes)}）${skipNote}。`
    );
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
  } finally {
    exportingHistory = false;
    updateHistoryToolbar();
  }
};

$("importHistory").onclick = () => {
  if (exportingHistory || importingHistory || clearingHistory) return;
  $<HTMLInputElement>("importHistoryFile").click();
};

$<HTMLInputElement>("importHistoryFile").onchange = async (ev) => {
  const input = ev.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || importingHistory || exportingHistory || clearingHistory) return;

  const sizeLabel = formatBackupSize(file.size);
  const confirmed = await showConfirm({
    title: "导入录音历史备份？",
    body: `将导入文件「${file.name}」（${sizeLabel}）中的录音记录。现有历史不会被删除，导入的记录会追加到列表中。`,
    cancelText: "取消",
    okText: "开始导入"
  });
  if (!confirmed) return;

  importingHistory = true;
  updateHistoryToolbar();
  try {
    const result = await importHistoryBackup(file, (msg) => setStatus(msg));
    invalidateHistoryReads("import_started");
    await reloadHistoryVerified("after_import");
    const errorNote =
      result.errors.length > 0 ? `，${result.errors.length} 条警告（详见控制台）。` : "";
    if (result.importedSessions === 0) {
      setStatus(`未能导入任何录音。${result.errors[0] || ""}`.trim());
    } else {
      setStatus(
        `已导入 ${result.importedSessions} 条录音历史${result.skippedSessions > 0 ? `，跳过 ${result.skippedSessions} 条` : ""}${errorNote}`
      );
    }
    if (result.errors.length) console.warn("[HistoryImport]", result.errors);
  } catch (e) {
    setStatus(friendlyError(e instanceof Error ? e.message : String(e)));
    await reloadHistoryVerified("after_import_fail");
  } finally {
    importingHistory = false;
    updateHistoryToolbar();
  }
};


chrome.runtime.onMessage.addListener((msg: AudioLevelUpdate | Request) => {
  if (msg && "type" in msg && msg.type === MessageType.RequestAutoStart) {
    const payload = (msg as Request).payload || {};
    void tryAutoStartRecording("local_media", {
      tabTitle: String(payload.tabTitle || ""),
      tabUrl: String(payload.tabUrl || "")
    });
    return;
  }
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

navigator.mediaDevices?.addEventListener("devicechange", () => {
  if (localMediaSessionActive || localMediaPlaybackActive || playingAudio) return;
  void refreshDevices();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || recording || busy) return;
  void resumeDashboardPlayback();
  if (!localMediaPlaybackActive && !playingAudio) void ensurePreviewMonitor();
});
window.addEventListener("beforeunload", () => {
  void stopPreview();
  clearLocalMediaPlaylist();
  void ask(MessageType.UnsubscribeLevels).catch(() => undefined);
});

ensureMeterHost($("liveMonitor"));
fillBitrates();
installDownloadLifecycleListeners();
$("driveUploadCopyLink").onclick = () => void copyDriveUploadLink();
onDriveUploadEvent(handleDriveUploadEvent);

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
  syncAutoStartSettingsUi();
  syncRecordingNameProfilesUi();
  await refreshGoogleDriveConnectionStatus();
  updateLocalMediaUi();
  if (!recording && !localMediaPlaybackActive) void ensurePreviewMonitor();
  if (new URLSearchParams(location.search).get("openSettings") === "1") {
    $("settingsPanel").classList.remove("hidden");
  }
})();
setInterval(() => void refresh(), 2000);
setInterval(() => {
  if (
    settings.googleDriveEnabled &&
    isGoogleDriveLinked(settings) &&
    (googleDriveAuthExpiresAt || googleDriveAuthHasRefreshToken)
  ) {
    renderGoogleDriveAuthExpiryHint();
  }
}, 60_000);
