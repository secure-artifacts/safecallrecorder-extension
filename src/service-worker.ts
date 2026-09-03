import { isLocalMediaUrl } from "./auto-start";
import {
  applyRecordingNameProfilesToSettings,
  buildSessionRecordingName,
  getActiveRecordingNameProfile
} from "./recording-name-profiles";
import { MessageType, requestId, type Request, failure } from "./messages";
import { DEFAULT_SETTINGS, type AppSettings } from "./types";
import {
  setSessionSourceTab,
  storageGetDirect,
  storageRemoveDirect,
  storageSetDirect
} from "./extension-storage";
import { openHelpPage } from "./help-nav";
import { handleGoogleDriveMessage } from "./google-drive/sw-handlers";
import { saveDownloadBlobFromBuffer, saveUrlWithChromeDownloads } from "./download-save";
import { updateSessionDisplayName } from "./session-display-name";

let creating: Promise<void> | undefined;
let openingDashboard: Promise<void> | undefined;
const dashboardUrl = chrome.runtime.getURL("dashboard.html");

let autoStartCooldownUntil = 0;
let autoStartInFlight = false;

async function loadSettings(): Promise<AppSettings> {
  const cur = await storageGetDirect("settings");
  const raw = (cur.settings as AppSettings | undefined) || ({} as AppSettings);
  return applyRecordingNameProfilesToSettings({
    ...DEFAULT_SETTINGS,
    ...raw
  });
}

async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url]
  });
  if (contexts.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.BLOBS],
      justification: "在控制页关闭后持续录制所选声音设备并分段保存到本机"
    })
    .finally(() => (creating = undefined));
  return creating;
}

async function openDashboard(sourceTab?: chrome.tabs.Tab): Promise<void> {
  const sourceTabId = sourceTab?.id ?? null;
  await setSessionSourceTab({
    latestSourceTabId: sourceTabId,
    latestSourceTabTitle: sourceTab?.title ?? "",
    latestSourceTabUrl: sourceTab?.url ?? ""
  });
  const existing = (await chrome.tabs.query({ url: `${dashboardUrl}*` }))[0];
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: dashboardUrl });
}

async function isRecordingActive(): Promise<boolean> {
  try {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({
      type: MessageType.GetState,
      target: "offscreen",
      requestId: requestId()
    } satisfies Request);
    const active = (res as { data?: { active?: unknown[] } })?.data?.active;
    return Array.isArray(active) && active.length > 0;
  } catch {
    return false;
  }
}

async function notifyDashboardAutoStart(payload: Record<string, unknown>) {
  const dashboards = await chrome.tabs.query({ url: `${dashboardUrl}*` });
  const tab = dashboards[0];
  if (!tab?.id) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.RequestAutoStart,
      target: "dashboard",
      requestId: requestId(),
      payload
    } satisfies Request);
    return true;
  } catch {
    return false;
  }
}

async function startRecordingInBackground(settings: AppSettings, meta: { tabTitle?: string; tabUrl?: string }) {
  const deviceId = settings.defaultDeviceId;
  if (!deviceId) {
    console.info("[AutoStart] no defaultDeviceId, opening dashboard");
    return false;
  }
  await ensureOffscreen();
  const profile = getActiveRecordingNameProfile(settings);
  const displayName = buildSessionRecordingName(profile);
  const res = await chrome.runtime.sendMessage({
    type: MessageType.StartRecording,
    target: "offscreen",
    requestId: requestId(),
    payload: {
      mode: "device",
      deviceId,
      deviceLabel: "声音设备",
      displayName,
      bitrate: settings.defaultBitrate || DEFAULT_SETTINGS.defaultBitrate,
      mixed: false
    }
  } satisfies Request);
  if (!(res as { ok?: boolean })?.ok) {
    console.warn("[AutoStart] background start failed", res);
    return false;
  }
  console.info("[AutoStart] background recording started", { deviceId, displayName });
  return true;
}

async function handleLocalMediaAutoStart(tab: chrome.tabs.Tab) {
  if (autoStartInFlight) return;
  if (Date.now() < autoStartCooldownUntil) return;
  const settings = await loadSettings();
  if (!settings.autoStartRecording || settings.autoStartOnLocalMediaTab === false) return;
  if (!(await isLocalMediaUrl(tab.url))) return;
  if (await isRecordingActive()) return;

  autoStartInFlight = true;
  try {
    console.info("[AutoStart]", { stage: "local_media_detected", tabId: tab.id, url: tab.url });
    const payload = {
      reason: "local_media",
      tabId: tab.id,
      tabTitle: tab.title,
      tabUrl: tab.url
    };
    const sent = await notifyDashboardAutoStart(payload);
    if (sent) return;

    const started = await startRecordingInBackground(settings, {
      tabTitle: tab.title,
      tabUrl: tab.url
    });
    if (started) {
      await openDashboard(tab);
      return;
    }
    await openDashboard(tab);
    await notifyDashboardAutoStart(payload);
  } finally {
    autoStartInFlight = false;
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.audible !== true) return;
  void handleLocalMediaAutoStart({ ...tab, id: tabId });
});

chrome.action.onClicked.addListener((tab) => {
  openingDashboard ??= openDashboard(tab)
    .catch(console.error)
    .finally(() => (openingDashboard = undefined));
});

const FORWARD = new Set<string>([
  MessageType.GetState,
  MessageType.PauseRecording,
  MessageType.ResumeRecording,
  MessageType.StopRecording,
  MessageType.ExportSession,
  MessageType.DeleteSession,
  MessageType.TestDevice,
  MessageType.SubscribeLevels,
  MessageType.UnsubscribeLevels,
  MessageType.DownloadRecoverable,
  MessageType.ClearAllHistory,
  MessageType.GetMp3Url
]);

chrome.runtime.onMessage.addListener((msg: Request, _sender, reply) => {
  (async () => {
    if (msg.type === MessageType.AudioLevelUpdate) return;
    if (msg.target !== "service-worker") return;

    if (msg.type === MessageType.StorageGet) {
      const data = await storageGetDirect(msg.payload?.keys as string | string[] | Record<string, unknown>);
      return reply({ ok: true, requestId: msg.requestId, data });
    }
    if (msg.type === MessageType.StorageSet) {
      await storageSetDirect((msg.payload?.items || {}) as Record<string, unknown>);
      return reply({ ok: true, requestId: msg.requestId });
    }
    if (msg.type === MessageType.StorageRemove) {
      await storageRemoveDirect(msg.payload?.keys as string | string[]);
      return reply({ ok: true, requestId: msg.requestId });
    }

    if (msg.type === MessageType.SaveSettings) {
      const cur = await storageGetDirect("settings");
      const next = {
        ...DEFAULT_SETTINGS,
        ...(cur.settings as AppSettings | undefined),
        ...(msg.payload as unknown as Partial<AppSettings>)
      };
      await storageSetDirect({ settings: next });
      return reply({ ok: true, requestId: msg.requestId, data: next });
    }

    if (msg.type === MessageType.OpenHelp) {
      await openHelpPage(String(msg.payload?.hash || ""));
      return reply({ ok: true, requestId: msg.requestId });
    }

    if (msg.type === MessageType.UpdateSessionDisplayName) {
      const sessionId = String(msg.payload?.sessionId || "");
      const displayName = String(msg.payload?.displayName ?? "");
      if (!sessionId) throw new Error("缺少 sessionId");
      const session = await updateSessionDisplayName(sessionId, displayName);
      return reply({ ok: true, requestId: msg.requestId, data: session });
    }

    if (msg.type === MessageType.SaveDownloadBlob) {
      const payload = msg.payload || {};
      const buffer = payload.buffer as ArrayBuffer;
      const mimeType = String(payload.mimeType || "");
      const filename = String(payload.filename || "download");
      const downloadFolder =
        typeof payload.downloadFolder === "string" ? payload.downloadFolder : undefined;
      const data = await saveDownloadBlobFromBuffer(buffer, mimeType, filename, downloadFolder);
      if (!data.ok) throw new Error(data.error.message);
      return reply({ ok: true, requestId: msg.requestId, data });
    }

    if (msg.type === MessageType.SaveDownloadUrl) {
      const payload = msg.payload || {};
      const url = String(payload.url || "");
      const filename = String(payload.filename || "download");
      const downloadFolder =
        typeof payload.downloadFolder === "string" ? payload.downloadFolder : undefined;
      const data = await saveUrlWithChromeDownloads(url, filename, downloadFolder);
      if (!data.ok) throw new Error(data.error.message);
      return reply({ ok: true, requestId: msg.requestId, data });
    }

    if (
      msg.type === MessageType.GoogleDriveGetStatus ||
      msg.type === MessageType.GoogleDriveConnect ||
      msg.type === MessageType.GoogleDriveDisconnect ||
      msg.type === MessageType.GoogleDriveListFolders ||
      msg.type === MessageType.GoogleDriveSetFolder ||
      msg.type === MessageType.GoogleDriveCreateFolder ||
      msg.type === MessageType.GoogleDriveEnsureDefaultFolder ||
      msg.type === MessageType.GoogleDriveUploadMp3 ||
      msg.type === MessageType.GoogleDriveGetAuthToken ||
      msg.type === MessageType.GoogleDriveRevokeAuth
    ) {
      const data = await handleGoogleDriveMessage(msg.type, msg.payload || {});
      return reply({ ok: true, requestId: msg.requestId, data });
    }

    if (msg.type === MessageType.StartRecording) {
      await ensureOffscreen();
      const forwarded: Request = { ...msg, target: "offscreen", payload: { ...msg.payload, mode: "device" } };
      return reply(await chrome.runtime.sendMessage(forwarded));
    }

    if (msg.type === MessageType.StopRecording) {
      autoStartCooldownUntil = Date.now() + 2500;
    }

    if (FORWARD.has(msg.type)) {
      await ensureOffscreen();
      return reply(await chrome.runtime.sendMessage({ ...msg, target: "offscreen" }));
    }

    reply(failure(msg, "service-worker", new Error(`Unsupported message. supported=${Object.values(MessageType).join(",")}`)));
  })().catch((e) => reply(failure(msg, "service-worker", e)));
  return true;
});
