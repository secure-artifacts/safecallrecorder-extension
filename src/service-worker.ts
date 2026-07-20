import { MessageType, type Request, failure } from "./messages";
import { DEFAULT_SETTINGS, type AppSettings } from "./types";
import {
  setSessionSourceTab,
  storageGetDirect,
  storageRemoveDirect,
  storageSetDirect
} from "./extension-storage";
import { openHelpPage } from "./help-nav";

let creating: Promise<void> | undefined;
let openingDashboard: Promise<void> | undefined;
const dashboardUrl = chrome.runtime.getURL("dashboard.html");

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

async function openDashboard(sourceTab?: chrome.tabs.Tab) {
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

    if (msg.type === MessageType.StartRecording) {
      await ensureOffscreen();
      const forwarded: Request = { ...msg, target: "offscreen", payload: { ...msg.payload, mode: "device" } };
      return reply(await chrome.runtime.sendMessage(forwarded));
    }

    if (FORWARD.has(msg.type)) {
      await ensureOffscreen();
      return reply(await chrome.runtime.sendMessage({ ...msg, target: "offscreen" }));
    }

    reply(failure(msg, "service-worker", new Error(`Unsupported message. supported=${Object.values(MessageType).join(",")}`)));
  })().catch((e) => reply(failure(msg, "service-worker", e)));
  return true;
});
