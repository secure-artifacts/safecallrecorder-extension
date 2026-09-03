const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type OAuthTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export function parseOAuthCodeFromResponseUrl(responseUrl: string): string {
  const url = new URL(responseUrl);
  const params = new URLSearchParams(
    url.search ? url.search.slice(1) : url.hash.startsWith("#") ? url.hash.slice(1) : ""
  );
  const oauthError = params.get("error");
  if (oauthError) {
    const desc = params.get("error_description")?.trim();
    throw new Error(desc ? `Google 授权失败：${oauthError}（${desc}）` : `Google 授权失败：${oauthError}`);
  }
  const code = params.get("code");
  if (!code) throw new Error("Google 授权未完成，未返回 authorization code。");
  return code;
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  clientSecret?: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code"
  });
  if (params.clientSecret?.trim()) body.set("client_secret", params.clientSecret.trim());
  return postTokenRequest(body);
}

export async function refreshOAuthAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    grant_type: "refresh_token"
  });
  if (params.clientSecret?.trim()) body.set("client_secret", params.clientSecret.trim());
  return postTokenRequest(body);
}

async function postTokenRequest(body: URLSearchParams): Promise<OAuthTokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = (await res.json()) as OAuthTokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    const msg = data.error_description || data.error || res.statusText;
    if (data.error === "invalid_client" && !body.has("client_secret")) {
      throw new Error(
        "需要填写 OAuth 客户端密钥才能长期授权。请在 Google 云端设置中填写客户端密钥后重新连接。"
      );
    }
    throw new Error(`Google 令牌交换失败：${msg}`);
  }
  if (!data.access_token) throw new Error("Google 未返回 access_token。");
  return data;
}
