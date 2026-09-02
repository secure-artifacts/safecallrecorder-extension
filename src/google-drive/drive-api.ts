import { DRIVE_API, DRIVE_UPLOAD } from "./config";
import { getGoogleAuthToken } from "./auth";

export type DriveFolder = { id: string; name: string; parents?: string[] };

async function authHeaders(interactive: boolean): Promise<HeadersInit> {
  const token = await getGoogleAuthToken(interactive);
  return { Authorization: `Bearer ${token}` };
}

export async function listDriveFolders(parentId?: string): Promise<DriveFolder[]> {
  const q = parentId
    ? `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)&pageSize=100&orderBy=folder,name`;
  const res = await fetch(url, { headers: await authHeaders(false) });
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
  const res = await fetch(`${DRIVE_API}/files`, {
    method: "POST",
    headers: {
      ...(await authHeaders(true)),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
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
  folderId: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const init = await fetch(`${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id,name,webViewLink`, {
    method: "POST",
    headers: {
      ...(await authHeaders(false)),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: fileName,
      parents: [folderId],
      mimeType
    })
  });
  if (!init.ok) {
    const text = await init.text();
    throw new Error(`无法开始上传：${text || init.statusText}`);
  }
  const uploadUrl = init.headers.get("Location");
  if (!uploadUrl) throw new Error("Google Drive 未返回上传地址");

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType || "application/octet-stream",
      "Content-Length": String(blob.size)
    },
    body: blob
  });
  if (!put.ok) {
    const text = await put.text();
    throw new Error(`上传失败：${text || put.statusText}`);
  }
  const file = (await put.json()) as { id: string; name: string; webViewLink?: string };
  return file;
}
