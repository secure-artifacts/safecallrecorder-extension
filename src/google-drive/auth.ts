import { getSettings, setSettings, storageGet, storageRemove, storageSet } from "../extension-storage";
import { MessageType, requestId, type Request, type Response } from "../messages";
import type { GoogleDriveAuthSessionExport } from "./config-backup";
import {
  DRIVE_SCOPES,
  getGoogleRedirectUri,
  getManifestOAuthClientId,
  googleDriveSetupHint,
  resolveGoogleClientId,
  resolveGoogleClientSecretAsync,
  usesUiOAuthClientId
} from "./config";
import {
  exchangeAuthorizationCode,
  parseOAuthCodeFromResponseUrl,
  refreshOAuthAccessToken
} from "./oauth-token";

const TOKEN_CACHE_KEY = "googleDriveTokenCache";

type TokenCache = {
  accessToken: string;
  expiresAt: number;
  clientId: string;
  refreshToken?: string;
};

function hasIdentityApi(): boolean {
  return (
    typeof chrome?.identity?.getAuthToken === "function" &&
    typeof chrome?.identity?.launchWebAuthFlow === "function"
  );
}

async function readTokenCache(): Promise<TokenCache | null> {
  const data = await storageGet(TOKEN_CACHE_KEY);
  const cache = data[TOKEN_CACHE_KEY] as TokenCache | undefined;
  return cache?.accessToken || cache?.refreshToken ? cache : null;
}

async function writeTokenCache(cache: TokenCache | null) {
  if (!cache) {
    await storageRemove(TOKEN_CACHE_KEY);
    return;
  }
  await storageSet({ [TOKEN_CACHE_KEY]: cache });
}

export async function clearGoogleTokenCache() {
  await writeTokenCache(null);
}

function parseTokenFromResponseUrl(responseUrl: string): { token: string; expiresAt: number } {
  const url = new URL(responseUrl);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.search.slice(1));
  const oauthError = params.get("error");
  if (oauthError) {
    const desc = params.get("error_description")?.trim();
    throw new Error(desc ? `Google 授权失败：${oauthError}（${desc}）` : `Google 授权失败：${oauthError}`);
  }
  const token = params.get("access_token");
  if (!token) throw new Error("Google 授权未完成，未返回 access_token。");
  const expiresIn = Number(params.get("expires_in") || 3600);
  return { token, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 };
}

/** @internal exported for tests */
export function parseOAuthTokenFromResponseUrl(responseUrl: string): { token: string; expiresAt: number } {
  return parseTokenFromResponseUrl(responseUrl);
}

type WebAuthPrompt = "none" | "select_account" | "consent_select_account";

async function launchWebAuthFlow(url: string, interactive: boolean): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive }, (redirectedTo) => {
      const err = chrome.runtime.lastError;
      if (err || !redirectedTo) {
        reject(new Error(err?.message || "Google 授权被取消或失败"));
        return;
      }
      resolve(redirectedTo);
    });
  });
}

async function cacheTokens(
  clientId: string,
  tokens: { access_token: string; expires_in: number; refresh_token?: string },
  previousRefreshToken?: string
): Promise<string> {
  const next: TokenCache = {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + Math.max(60, tokens.expires_in) * 1000,
    clientId,
    refreshToken: tokens.refresh_token ?? previousRefreshToken
  };
  await writeTokenCache(next);
  return next.accessToken;
}

async function refreshWithStoredRefreshToken(
  clientId: string,
  clientSecret: string,
  cached: TokenCache
): Promise<string | null> {
  if (!cached.refreshToken) return null;
  try {
    const tokens = await refreshOAuthAccessToken({
      refreshToken: cached.refreshToken,
      clientId,
      clientSecret
    });
    return cacheTokens(clientId, tokens, cached.refreshToken);
  } catch {
    return null;
  }
}

async function getAuthTokenViaAuthCodeFlow(
  clientId: string,
  clientSecret: string,
  options: { interactive: boolean; prompt?: WebAuthPrompt; needRefreshToken?: boolean }
): Promise<string> {
  const prompt =
    options.prompt ??
    (options.needRefreshToken ? "consent_select_account" : options.interactive ? "select_account" : "none");
  const redirectUri = getGoogleRedirectUri();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", DRIVE_SCOPES.join(" "));
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set(
    "prompt",
    prompt === "consent_select_account" ? "consent select_account" : prompt
  );

  const responseUrl = await launchWebAuthFlow(authUrl.toString(), options.interactive);
  const code = parseOAuthCodeFromResponseUrl(responseUrl);
  const tokens = await exchangeAuthorizationCode({
    code,
    clientId,
    redirectUri,
    clientSecret
  });
  const cached = await readTokenCache();
  return cacheTokens(clientId, tokens, cached?.refreshToken);
}

async function getAuthTokenViaImplicitWebAuthFlow(
  clientId: string,
  options: { interactive: boolean; prompt?: WebAuthPrompt }
): Promise<string> {
  const prompt =
    options.prompt ?? (options.interactive ? "consent_select_account" : "none");
  const redirectUri = getGoogleRedirectUri();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", DRIVE_SCOPES.join(" "));
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set(
    "prompt",
    prompt === "consent_select_account" ? "consent select_account" : prompt
  );

  const responseUrl = await launchWebAuthFlow(authUrl.toString(), options.interactive);
  const { token, expiresAt } = parseTokenFromResponseUrl(responseUrl);
  await writeTokenCache({ accessToken: token, expiresAt, clientId });
  return token;
}

/** Silent refresh with fallbacks when the browser already has a Google session. */
async function acquireWebFlowToken(clientId: string, interactive: boolean): Promise<string> {
  const settings = await getSettings();
  const clientSecret = await resolveGoogleClientSecretAsync(settings);
  const cached = await readTokenCache();

  if (cached && cached.clientId === clientId && cached.expiresAt > Date.now() + 60_000 && cached.accessToken) {
    return cached.accessToken;
  }

  if (clientSecret) {
    if (cached?.refreshToken && cached.clientId === clientId) {
      const refreshed = await refreshWithStoredRefreshToken(clientId, clientSecret, cached);
      if (refreshed) return refreshed;
    }

    if (interactive) {
      const needRefreshToken = !cached?.refreshToken;
      return getAuthTokenViaAuthCodeFlow(clientId, clientSecret, {
        interactive: true,
        needRefreshToken,
        prompt: needRefreshToken ? "consent_select_account" : "select_account"
      });
    }

    const codeAttempts: Array<{ interactive: boolean; prompt: WebAuthPrompt; needRefreshToken?: boolean }> = [
      { interactive: false, prompt: "none" },
      { interactive: true, prompt: "none" },
      { interactive: true, prompt: "select_account" },
      { interactive: true, prompt: "consent_select_account", needRefreshToken: true }
    ];
    let lastError: Error | undefined;
    for (const attempt of codeAttempts) {
      try {
        return await getAuthTokenViaAuthCodeFlow(clientId, clientSecret, attempt);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastError ?? new Error("Google 授权失败，请点「连接 Google 账号」。");
  }

  if (interactive) {
    return getAuthTokenViaImplicitWebAuthFlow(clientId, {
      interactive: true,
      prompt: "consent_select_account"
    });
  }

  const refreshAttempts: Array<{ interactive: boolean; prompt: WebAuthPrompt }> = [
    { interactive: false, prompt: "none" },
    { interactive: true, prompt: "none" },
    { interactive: true, prompt: "select_account" }
  ];

  let lastError: Error | undefined;
  for (const attempt of refreshAttempts) {
    try {
      return await getAuthTokenViaImplicitWebAuthFlow(clientId, attempt);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error("Google 授权失败，请点「连接 Google 账号」。");
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

async function requestAuthTokenViaServiceWorker(interactive: boolean): Promise<string> {
  const response = await chrome.runtime.sendMessage({
    type: MessageType.GoogleDriveGetAuthToken,
    target: "service-worker",
    requestId: requestId(),
    payload: { interactive }
  } satisfies Request);
  const res = response as Response;
  if (!res?.ok) {
    throw new Error(res?.error?.message || "无法从后台获取 Google 授权令牌");
  }
  const token = (res.data as { token?: string } | undefined)?.token;
  if (!token) throw new Error("无法从后台获取 Google 授权令牌");
  return token;
}

/** Token acquisition for contexts without chrome.identity (e.g. offscreen document). */
export async function getGoogleAuthTokenInBackground(interactive: boolean): Promise<string> {
  const settings = await getSettings();
  const clientId = await resolveGoogleClientId(settings);
  if (!clientId) throw new Error(googleDriveSetupHint());
  if (!hasIdentityApi()) {
    throw new Error("当前环境不支持 Google 登录（需要 Chrome 扩展 identity 权限）。");
  }

  const useWebFlow = usesUiOAuthClientId(settings) || !getManifestOAuthClientId();
  if (useWebFlow) {
    return acquireWebFlowToken(clientId, interactive);
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

export async function getGoogleAuthToken(interactive: boolean): Promise<string> {
  const settings = await getSettings();
  const clientId = await resolveGoogleClientId(settings);
  if (!clientId) throw new Error(googleDriveSetupHint());

  const useWebFlow = usesUiOAuthClientId(settings) || !getManifestOAuthClientId();
  if (useWebFlow) {
    try {
      const cached = await readTokenCache();
      if (cached && cached.clientId === clientId && cached.expiresAt > Date.now() + 60_000 && cached.accessToken) {
        return cached.accessToken;
      }
    } catch {
      /* storage proxy may fail briefly — fall through to SW auth */
    }
  }

  if (!hasIdentityApi()) {
    return requestAuthTokenViaServiceWorker(interactive);
  }

  return getGoogleAuthTokenInBackground(interactive);
}

export async function revokeGoogleAuthToken(): Promise<void> {
  const cached = await readTokenCache();
  await clearGoogleTokenCache();
  for (const token of [cached?.accessToken, cached?.refreshToken]) {
    if (!token) continue;
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
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

/** Persist Gmail on settings when OAuth works but email was not saved (e.g. older scopes). */
export async function ensureGoogleAccountEmailSaved(): Promise<string | undefined> {
  const settings = await getSettings();
  const existing = settings.googleDriveAccountEmail?.trim();
  if (existing) return existing;
  try {
    const token = await getGoogleAuthToken(false);
    const email = (await fetchGoogleAccountEmail(token))?.trim();
    if (!email) return undefined;
    await setSettings({ googleDriveAccountEmail: email });
    return email;
  } catch {
    return undefined;
  }
}

export function getExtensionAuthInfo() {
  return {
    extensionId: chrome.runtime.id,
    redirectUri: getGoogleRedirectUri(),
    manifestClientConfigured: Boolean(getManifestOAuthClientId())
  };
}

export async function hasGoogleAuthRefreshToken(): Promise<boolean> {
  const settings = await getSettings();
  const clientId = await resolveGoogleClientId(settings);
  if (!clientId) return false;
  const cached = await readTokenCache();
  return Boolean(cached?.refreshToken && cached.clientId === clientId);
}

/** Whether cached OAuth tokens can still upload without reconnecting. */
export async function isGoogleAuthSessionValid(): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.googleDriveAccountEmail?.trim()) return false;
  const clientId = await resolveGoogleClientId(settings);
  if (!clientId) return false;
  const cached = await readTokenCache();
  if (!cached || cached.clientId !== clientId) return false;
  if (cached.refreshToken?.trim()) return true;
  return Boolean(cached.accessToken && cached.expiresAt > Date.now() + 30_000);
}

/** Unix ms when cached Web OAuth token expires, or null if none / wrong client / refresh token active. */
export async function getGoogleAuthSessionExpiry(): Promise<number | null> {
  if (await hasGoogleAuthRefreshToken()) return null;
  const settings = await getSettings();
  const clientId = await resolveGoogleClientId(settings);
  if (!clientId) return null;
  const cached = await readTokenCache();
  if (!cached || cached.clientId !== clientId) return null;
  return cached.expiresAt;
}

/** Include in exported config when OAuth session or refresh token is available. */
export async function getAuthSessionForExport(): Promise<GoogleDriveAuthSessionExport | null> {
  const settings = await getSettings();
  const clientId = await resolveGoogleClientId(settings);
  if (!clientId) return null;
  const cached = await readTokenCache();
  if (!cached || cached.clientId !== clientId) return null;
  if (cached.refreshToken) {
    return {
      accessToken: cached.accessToken || "",
      expiresAt: cached.expiresAt || 0,
      clientId: cached.clientId,
      refreshToken: cached.refreshToken
    };
  }
  if (!cached.accessToken || cached.expiresAt <= Date.now() + 30_000) return null;
  return {
    accessToken: cached.accessToken,
    expiresAt: cached.expiresAt,
    clientId: cached.clientId
  };
}

export async function restoreAuthSessionFromExport(
  session: GoogleDriveAuthSessionExport
): Promise<{ ok: boolean; email?: string }> {
  const settings = await getSettings();
  const clientId = await resolveGoogleClientId(settings);
  if (!clientId || session.clientId !== clientId) return { ok: false };

  const clientSecret = await resolveGoogleClientSecretAsync(settings);
  const refreshToken = session.refreshToken?.trim();

  if (refreshToken && clientSecret) {
    await writeTokenCache({
      accessToken: session.accessToken || "",
      expiresAt: session.expiresAt || 0,
      clientId: session.clientId,
      refreshToken
    });
    try {
      const accessToken = await refreshWithStoredRefreshToken(clientId, clientSecret, {
        accessToken: session.accessToken || "",
        expiresAt: session.expiresAt || 0,
        clientId: session.clientId,
        refreshToken
      });
      if (!accessToken) return { ok: false };
      const email = (await fetchGoogleAccountEmail(accessToken))?.trim();
      if (!email) {
        await clearGoogleTokenCache();
        return { ok: false };
      }
      await setSettings({ googleDriveAccountEmail: email });
      return { ok: true, email };
    } catch {
      await clearGoogleTokenCache();
      return { ok: false };
    }
  }

  if (!session.accessToken?.trim() || session.expiresAt <= Date.now() + 30_000) {
    return { ok: false };
  }

  await writeTokenCache({
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    clientId: session.clientId
  });

  const email = (await fetchGoogleAccountEmail(session.accessToken))?.trim();
  if (!email) {
    await clearGoogleTokenCache();
    return { ok: false };
  }
  await setSettings({ googleDriveAccountEmail: email });
  return { ok: true, email };
}
