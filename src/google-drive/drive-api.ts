import { DRIVE_API, DRIVE_UPLOAD } from "./config";
import { clearGoogleTokenCache, getGoogleAuthToken } from "./auth";

export type DriveFolder = { id: string; name: string; parents?: string[] };

async function authHeaders(interactive: boolean): Promise<HeadersInit> {
  const token = await getGoogleAuthToken(interactive);
  return { Authorization: `Bearer ${token}` };
}

async function fetchDrive(
  url: string,
  init: RequestInit,
  interactive: boolean
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(await authHeaders(interactive)), ...(init.headers as Record<string, string> | undefined) }
  });
  if (res.status !== 401 || interactive) return res;
  await clearGoogleTokenCache();
  return fetch(url, {
    ...init,
    headers: { ...(await authHeaders(false)), ...(init.headers as Record<string, string> | undefined) }
  });
}

export async function listDriveFolders(parentId?: string): Promise<DriveFolder[]> {
  const q = parentId
    ? `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)&pageSize=100&orderBy=folder,name`;
  const res = await fetchDrive(url, {}, false);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`无法列出 Google Drive 文件夹：${text || res.statusText}`);
  }
  const data = (await res.json()) as { files?: DriveFolder[] };
  return data.files || [];
}

export async function createDriveFolder(name: string, parentId?: string): Promise<DriveFolder> {
  const body: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder"
  };
  if (parentId) body.parents = [parentId];
  const res = await fetchDrive(`${DRIVE_API}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, true);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`无法创建文件夹：${text || res.statusText}`);
  }
  const folder = (await res.json()) as DriveFolder;
  return folder;
}

export async function ensureDefaultDriveFolder(): Promise<DriveFolder> {
  const existing = await listDriveFolders();
  const found = existing.find((f) => f.name === "SafeCallRecorder");
  if (found) return found;
  return createDriveFolder("SafeCallRecorder");
}

export async function uploadDriveFile(
  blob: Blob,
  fileName: string,
  mimeType: string,
  folderId: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const init = await fetchDrive(`${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id,name,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: fileName,
      parents: [folderId],
      mimeType
    })
  }, false);
  if (!init.ok) {
    const text = await init.text();
    throw new Error(`无法开始上传：${text || init.statusText}`);
  }
  const uploadUrl = init.headers.get("Location");
  if (!uploadUrl) throw new Error("Google Drive 未返回上传地址");

  const file = await putBlobWithProgress(uploadUrl, blob, mimeType, onProgress);
  return file;
}

function putBlobWithProgress(
  uploadUrl: string,
  blob: Blob,
  mimeType: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ id: string; name: string; webViewLink?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", mimeType || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      const total = event.lengthComputable ? event.total : blob.size;
      onProgress(event.loaded, total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { id: string; name: string; webViewLink?: string });
        } catch {
          reject(new Error("上传完成但无法解析 Google Drive 响应"));
        }
        return;
      }
      reject(new Error(`上传失败：${xhr.responseText || xhr.statusText || xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("上传失败：网络错误"));
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.send(blob);
  });
}
