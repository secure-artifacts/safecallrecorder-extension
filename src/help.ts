import { HELP_CONTENT_VERSION, openDashboardPage } from "./help-nav";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setupToc() {
  const links = document.querySelectorAll<HTMLAnchorElement>(".help-toc a[href^='#']");
  for (const a of links) {
    a.addEventListener("click", (ev) => {
      const id = a.getAttribute("href")?.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      ev.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
      for (const x of links) x.classList.toggle("active", x === a);
    });
  }
}

function setupBackTop() {
  const btn = $("backTop");
  const onScroll = () => {
    btn.classList.toggle("hidden", window.scrollY < 480);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  btn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
  onScroll();
}

$("backToRecord").onclick = () => void openDashboardPage();
$("quickStartBack").onclick = () => void openDashboardPage();
$("openSettingsFromHelp").onclick = async () => {
  const url = chrome.runtime.getURL("dashboard.html?openSettings=1");
  const base = chrome.runtime.getURL("dashboard.html");
  const tabs = await chrome.tabs.query({ url: `${base}*` });
  if (tabs[0]?.id != null) {
    await chrome.tabs.update(tabs[0].id, { url, active: true });
    if (tabs[0].windowId != null) await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
};

$("helpVersion").textContent = `使用说明版本：${HELP_CONTENT_VERSION}`;

setupToc();
setupBackTop();

if (location.hash) {
  const el = document.getElementById(location.hash.slice(1));
  el?.scrollIntoView({ behavior: "instant", block: "start" });
}
