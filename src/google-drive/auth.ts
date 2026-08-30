import { getSettings, storageGetDirect, storageRemoveDirect, storageSetDirect } from "../extension-storage";
import {
  DRIVE_SCOPES,
  getGoogleRedirectUri,
  getManifestOAuthClientId,
  googleDriveSetupHint,
  resolveGoogleClientId,
  usesUiOAuthClientId
} from "./config";

const TOKEN_CACHE_KEY = "googleDriveTokenCache";

type TokenCache = {
  accessToken: string;
  expiresAt: number;
  clientId: string;
};

function hasIdentityApi(): boolean {
  return (
    typeof chrome?.identity?.getAuthToken === "function" &&
    typeof chrome?.identity?.launchWebAuthFlow === "function"
  );
}

async function readTokenCache(): Promise<TokenCache | null> {
  const data = await storageGetDirect(TOKEN_CACHE_KEY);
  const cache = data[TOKEN_CACHE_KEY] as TokenCache | undefined;
  return cache?.accessToken ? cache : null;
}

async function writeTokenCache(cache: TokenCache | null) {
  if (!cache) {
    await storageRemoveDirect(TOKEN_CACHE_KEY);
    return;
  }
  await storageSetDirect({ [TOKEN_CACHE_KEY]: cache });
}

export async function clearGoogleTokenCache() {
  await writeTokenCache(null);
}

function parseTokenFromResponseUrl(responseUrl: string): { token: string; expiresAt: number } {
  const url = new URL(responseUrl);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.search.slice(1));
  const token = params.get("access_token");
  if (!token) throw new Error("Google 授权未完成，未返回 access_token。");
  const expiresIn = Number(params.get("expires_in") || 3600);
  return { token, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 };
}

async function getAuthTokenViaWebAuthFlow(clientId: string, interactive: boolean): Promise<string> {
  const redirectUri = getGoogleRedirectUri();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", DRIVE_SCOPES.join(" "));
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("prompt", interactive ? "consent select_account" : "none");

  const responseUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive }, (redirectedTo) => {
      const err = chrome.runtime.lastError;
      if (err || !redirectedTo) {
        reject(new Error(err?.message || "Google 授权被取消或失败"));
        return;
      }
      resolve(redirectedTo);
    });
  });

  const { token, expiresAt } = parseTokenFromResponseUrl(responseUrl);
  await writeTokenCache({ accessToken: token, expiresAt, clientId });
  return token;
}

async function getAuthTokenFromManifest(interactive: boolean): Promise<string> {
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

export async function getGoogleAuthToken(interactive: boolean): Promise<string> {
  const settings = await getSettings();
  const clientId = await resolveGoogleClientId(settings);
  if (!clientId) throw new Error(googleDriveSetupHint());
  if (!hasIdentityApi()) {
    throw new Error("当前环境不支持 Google 登录（需要 Chrome 扩展 identity 权限）。");
  }

  const useWebFlow = usesUiOAuthClientId(settings) || !getManifestOAuthClientId();
  if (useWebFlow) {
    const cached = await readTokenCache();
    if (cached && cached.clientId === clientId && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }
    return getAuthTokenViaWebAuthFlow(clientId, interactive);
  }

  if (!interactive) {
    try {
      return await getAuthTokenFromManifest(false);
    } catch {
      /* fall through */
    }
  }
  return getAuthTokenFromManifest(interactive);
}

export async function revokeGoogleAuthToken(): Promise<void> {
  const cached = await readTokenCache();
  await clearGoogleTokenCache();
  if (cached?.accessToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cached.accessToken)}`, {
        method: "POST",
        headers: { "Content-type": "application/x-www-form-urlencoded" }
      });
    } catch {
      /* ignore */
    }
  }
  if (!hasIdentityApi()) return;
  const token = await getAuthTokenFromManifest(false).catch(() => "");
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
  const clientId = await resolveGoogleClientId();
  if (!clientId) throw new Error(googleDriveSetupHint());
  const token = await getGoogleAuthToken(true);
  const email = await fetchGoogleAccountEmail(token);
  return { email };
}

export function getExtensionAuthInfo() {
  return {
    extensionId: chrome.runtime.id,
    redirectUri: getGoogleRedirectUri(),
    manifestClientConfigured: Boolean(getManifestOAuthClientId())
  };
}
