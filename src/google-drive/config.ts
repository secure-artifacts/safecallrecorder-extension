export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly"
] as const;

export function getOAuthClientId(): string | undefined {
  const oauth = chrome.runtime.getManifest().oauth2 as { client_id?: string } | undefined;
  const id = oauth?.client_id?.trim();
  if (!id || id.startsWith("CONFIGURE_") || id.includes("YOUR_CLIENT_ID")) return undefined;
  return id;
}

export function isGoogleDriveConfigured(): boolean {
  return Boolean(getOAuthClientId());
}

export function googleDriveSetupHint(): string {
  return "请先在 manifest.json 的 oauth2.client_id 中配置 Google Cloud OAuth 客户端 ID，并在 Google Cloud Console 启用 Drive API。";
}
