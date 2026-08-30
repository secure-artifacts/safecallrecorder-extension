export const HELP_CONTENT_VERSION = "1.4.0";

export async function openHelpPage(hash = ""): Promise<void> {
  const clean = hash.replace(/^#/, "");
  const base = chrome.runtime.getURL("help.html");
  const target = clean ? `${base}#${clean}` : base;
  const existing = await chrome.tabs.query({ url: `${base}*` });
  const tab = existing[0];
  if (tab?.id != null) {
    await chrome.tabs.update(tab.id, { url: target, active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    // If same page, force hash navigation via scripting is unnecessary — url update with hash works.
    return;
  }
  await chrome.tabs.create({ url: target });
}

export async function openDashboardPage(): Promise<void> {
  const base = chrome.runtime.getURL("dashboard.html");
  const existing = await chrome.tabs.query({ url: `${base}*` });
  const tab = existing[0];
  if (tab?.id != null) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: base });
}
