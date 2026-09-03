export const DRIVE_UPLOAD_CHANNEL = "safe-call-recorder-drive-upload";

export type DriveUploadEvent =
  | { type: "start"; sessionId: string; fileName: string; total: number }
  | { type: "progress"; sessionId: string; loaded: number; total: number }
  | { type: "done"; sessionId: string; fileName: string; webUrl: string }
  | { type: "failed"; sessionId: string; message: string };

let channel: BroadcastChannel | undefined;
try {
  channel = new BroadcastChannel(DRIVE_UPLOAD_CHANNEL);
} catch {
  channel = undefined;
}

export function postDriveUploadEvent(event: DriveUploadEvent) {
  channel?.postMessage(event);
}

export function onDriveUploadEvent(handler: (event: DriveUploadEvent) => void): () => void {
  if (!channel) return () => undefined;
  const listener = (ev: MessageEvent) => {
    const data = ev.data as DriveUploadEvent;
    if (data && typeof data.type === "string") handler(data);
  };
  channel.addEventListener("message", listener);
  return () => channel?.removeEventListener("message", listener);
}
