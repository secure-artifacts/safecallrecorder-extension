import { getOAuthClientId, googleDriveSetupHint, isGoogleDriveConfigured } from "./config";

function hasIdentityApi(): boolean {
  return Boolean(chrome?.identity?.getAuthToken);
}

export async function getGoogleAuthToken(interactive: boolean): Promise<string> {
  if (!isGoogleDriveConfigured()) {
    throw new Error(googleDriveSetupHint());
  }
  if (!hasIdentityApi()) {
    throw new Error("当前环境不支持 Google 登录（需要 Chrome 扩展 identity 权限）。");
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (result) => {
      const err = chrome.runtime.lastError;
      const token = typeof result === "string" ? result : (result as { token?: string } | undefined)?.token;
      if (err || !token) {
        reject(new Error(err?.message || "无法获取 Google 授权令牌"));
        return;
      }
      resolve(token);
    });
  });
}

export async function revokeGoogleAuthToken(): Promise<void> {
  if (!hasIdentityApi()) return;
  const token = await getGoogleAuthToken(false).catch(() => "");
  if (!token) return;
  await new Promise<void>((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

export async function fetchGoogleAccountEmail(token: string): Promise<string | undefined> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { email?: string };
  return data.email;
}

export async function connectGoogleAccount(): Promise<{ email?: string }> {
  const clientId = getOAuthClientId();
  if (!clientId) throw new Error(googleDriveSetupHint());
  const token = await getGoogleAuthToken(true);
  const email = await fetchGoogleAccountEmail(token);
  return { email };
}
