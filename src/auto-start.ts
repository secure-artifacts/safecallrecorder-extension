/** Detect URLs that represent local or direct media playback in the browser. */
export function isLocalMediaUrl(url: string | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.startsWith("file://")) return true;
  if (u.startsWith("blob:")) return true;
  if (/\.(mp3|wav|ogg|opus|m4a|aac|flac|webm|mp4|mkv|avi|mov|wmv|m4v)(\?|#|$)/i.test(u)) return true;
  return false;
}

export function suggestRecordingName(tabTitle?: string, tabUrl?: string): string {
  const fromTitle = (tabTitle || "").trim();
  if (fromTitle && fromTitle !== "undefined") {
    return fromTitle.replace(/\.[^.\\/]+$/i, "").slice(0, 80);
  }
  if (tabUrl) {
    try {
      const path = tabUrl.startsWith("file://")
        ? decodeURIComponent(tabUrl.replace(/^file:\/\//i, ""))
        : tabUrl;
      const base = path.split(/[/\\]/).pop() || "";
      return base.replace(/\.[^.]+$/i, "").slice(0, 80);
    } catch {
      /* ignore */
    }
  }
  return "";
}
