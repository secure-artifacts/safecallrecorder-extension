import { getSettings } from "../extension-storage";
import type { AppSettings } from "../types";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly"
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

export function usesUiOAuthClientId(settings?: AppSettings): boolean {
  const id = settings?.googleDriveClientId?.trim();
  return Boolean(id);
}

export function googleDriveSetupHint(): string {
  return "请在下方填写 Google Cloud OAuth 客户端 ID，并在 Google Cloud Console 启用 Drive API。";
}

export function googleDriveClientIdHint(): string {
  return "在 Google Cloud 创建 OAuth 客户端（Chrome 应用或 Web 应用）。Web 应用的重定向 URI 需填：https://<扩展ID>.chromiumapp.org/";
}
