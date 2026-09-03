/** Human-readable hint for Web OAuth token cache expiry (~1 hour). */
export function formatGoogleAuthExpiryHint(
  expiresAt: number | null | undefined,
  options?: { hasRefreshToken?: boolean; now?: number }
): string | null {
  if (options?.hasRefreshToken) {
    return "Google 已长期授权，上传时会自动续期令牌，无需重复连接。";
  }
  const now = options?.now ?? Date.now();
  if (expiresAt == null || !Number.isFinite(expiresAt)) return null;
  const ms = expiresAt - now;
  if (ms <= 0) {
    return "Google 登录已过期，上传或同步时将自动刷新；若失败请点「连接 Google 账号」。";
  }
  const mins = Math.ceil(ms / 60_000);
  const until = new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const autoRefresh = "到期后将自动刷新，无需手动重连。";
  const longTermHint = "填写客户端密钥并重新连接后可长期授权。";
  if (mins <= 15) {
    return `Google 登录约 ${mins} 分钟后过期（${until}），${autoRefresh} ${longTermHint}`;
  }
  if (mins < 60) {
    return `Google 登录剩余约 ${mins} 分钟（有效至 ${until}，${autoRefresh}） ${longTermHint}`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (remMins === 0) {
    return `Google 登录剩余约 ${hours} 小时（有效至 ${until}，${autoRefresh}） ${longTermHint}`;
  }
  return `Google 登录剩余约 ${hours} 小时 ${remMins} 分钟（有效至 ${until}，${autoRefresh}） ${longTermHint}`;
}

export function isGoogleAuthExpiryWarning(
  expiresAt: number | null | undefined,
  now = Date.now()
): boolean {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return false;
  return expiresAt - now <= 15 * 60_000;
}
