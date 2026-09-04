import { getSettings } from "../extension-storage";
import type { AppSettings } from "../types";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email"
] as const;

const PLACEHOLDER_MARKERS = ["CONFIGURE_", "YOUR_CLIENT_ID"];

export function getManifestOAuthClientId(): string | undefined {
  const oauth = chrome.runtime.getManifest().oauth2 as { client_id?: string } | undefined;
  const id = oauth?.client_id?.trim();
  if (!id) return undefined;
  if (PLACEHOLDER_MARKERS.some((m) => id.includes(m))) return undefined;
  return id;
}

export function getGoogleRedirectUri(): string {
  return `https://${chrome.runtime.id}.chromiumapp.org/`;
}

export function isGoogleDriveConfigured(settings?: AppSettings): boolean {
  if (settings?.googleDriveClientId?.trim()) return true;
  return Boolean(getManifestOAuthClientId());
}

export async function resolveGoogleClientId(settings?: AppSettings): Promise<string | undefined> {
  const fromSettings = settings?.googleDriveClientId?.trim();
  if (fromSettings) return fromSettings;
  const loaded = await getSettings();
  if (loaded.googleDriveClientId?.trim()) return loaded.googleDriveClientId.trim();
  return getManifestOAuthClientId();
}

export function resolveGoogleClientSecret(settings?: AppSettings): string | undefined {
  const fromSettings = settings?.googleDriveClientSecret?.trim();
  if (fromSettings) return fromSettings;
  return undefined;
}

export async function resolveGoogleClientSecretAsync(settings?: AppSettings): Promise<string | undefined> {
  const fromSettings = settings?.googleDriveClientSecret?.trim();
  if (fromSettings) return fromSettings;
  const loaded = await getSettings();
  return loaded.googleDriveClientSecret?.trim() || undefined;
}

export function usesUiOAuthClientId(settings?: AppSettings): boolean {
  const id = settings?.googleDriveClientId?.trim();
  return Boolean(id);
}

export function googleDriveSetupHint(): string {
  return "请在下方填写 Google Cloud OAuth 客户端 ID，并在 Google Cloud Console 启用 Drive API。";
}

export function googleDriveClientIdHint(): string {
  return "在 Google Cloud 创建「Web 应用」OAuth 客户端，并把控制面板显示的重定向 URI 加入授权列表。";
}

export function friendlyGoogleConnectError(message: string, redirectUri?: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("redirect_uri_mismatch") || lower.includes("redirect_uri")) {
    const uri =
      redirectUri ??
      (typeof chrome !== "undefined" && chrome.runtime?.id
        ? getGoogleRedirectUri()
        : "https://<扩展ID>.chromiumapp.org/");
    return (
      `Google 授权失败：重定向 URI 不匹配。` +
      `在控制面板填写客户端 ID 时，必须创建「Web 应用」类型（不是「Chrome 扩展程序」或「Chrome 应用」）。` +
      `打开 Google Cloud → 客户端 → 编辑或新建 Web 应用 → 已授权的重定向 URI 添加：${uri} ` +
      `（须完全一致，含 https:// 和末尾 /）。保存后把该 Web 应用的客户端 ID 粘贴到控制面板，再点「连接 Google 账号」。`
    );
  }
  if (lower.includes("access_denied") || lower.includes("403")) {
    return "Google 访问遭拒。请在 Google Cloud → 目标对象 → 测试用户 中添加你的 Gmail，并确认发布状态为「测试中」。";
  }
  if (lower.includes("超时") || lower.includes("popup") || lower.includes("blocked") || lower.includes("shields")) {
    return message;
  }
  return message;
}
