/** Human-readable hint for Web OAuth token cache expiry (~1 hour). */
export function formatGoogleAuthExpiryHint(
  expiresAt: number | null | undefined,
  now = Date.now()
): string | null {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return null;
  const ms = expiresAt - now;
  if (ms <= 0) {
    return "Google 登录已过期，上传或同步前请点「连接 Google 账号」。";
  }
  const mins = Math.ceil(ms / 60_000);
  const until = new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (mins <= 15) {
    return `Google 登录约 ${mins} 分钟后过期（${until}），过期后需重新连接。`;
  }
  if (mins < 60) {
    return `Google 登录剩余约 ${mins} 分钟（有效至 ${until}）。`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (remMins === 0) {
    return `Google 登录剩余约 ${hours} 小时（有效至 ${until}）。`;
  }
  return `Google 登录剩余约 ${hours} 小时 ${remMins} 分钟（有效至 ${until}）。`;
}

export function isGoogleAuthExpiryWarning(
  expiresAt: number | null | undefined,
  now = Date.now()
): boolean {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return false;
  return expiresAt - now <= 15 * 60_000;
}
