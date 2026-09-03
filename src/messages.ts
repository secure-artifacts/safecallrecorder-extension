export const MessageType = {
  GetState: "GET_STATE",
  StartRecording: "START_RECORDING",
  PauseRecording: "PAUSE_RECORDING",
  ResumeRecording: "RESUME_RECORDING",
  StopRecording: "STOP_RECORDING",
  ExportSession: "EXPORT_SESSION",
  DeleteSession: "DELETE_SESSION",
  TestDevice: "TEST_DEVICE",
  SubscribeLevels: "SUBSCRIBE_LEVELS",
  UnsubscribeLevels: "UNSUBSCRIBE_LEVELS",
  AudioLevelUpdate: "AUDIO_LEVEL_UPDATE",
  DownloadRecoverable: "DOWNLOAD_RECOVERABLE",
  ClearAllHistory: "CLEAR_ALL_HISTORY",
  GetMp3Url: "GET_MP3_URL",
  SaveSettings: "SAVE_SETTINGS",
  OpenHelp: "OPEN_HELP",
  RequestAutoStart: "REQUEST_AUTO_START",
  RecordingHistoryChanged: "RECORDING_HISTORY_CHANGED",
  UpdateSessionDisplayName: "UPDATE_SESSION_DISPLAY_NAME",
  GoogleDriveGetStatus: "GOOGLE_DRIVE_GET_STATUS",
  GoogleDriveConnect: "GOOGLE_DRIVE_CONNECT",
  GoogleDriveDisconnect: "GOOGLE_DRIVE_DISCONNECT",
  GoogleDriveListFolders: "GOOGLE_DRIVE_LIST_FOLDERS",
  GoogleDriveSetFolder: "GOOGLE_DRIVE_SET_FOLDER",
  GoogleDriveCreateFolder: "GOOGLE_DRIVE_CREATE_FOLDER",
  GoogleDriveEnsureDefaultFolder: "GOOGLE_DRIVE_ENSURE_DEFAULT_FOLDER",
  GoogleDriveUploadMp3: "GOOGLE_DRIVE_UPLOAD_MP3",
  GoogleDriveGetAuthToken: "GOOGLE_DRIVE_GET_AUTH_TOKEN",
  GoogleDriveRevokeAuth: "GOOGLE_DRIVE_REVOKE_AUTH",
  SaveDownloadBlob: "SAVE_DOWNLOAD_BLOB",
  SaveDownloadUrl: "SAVE_DOWNLOAD_URL",
  StorageGet: "STORAGE_GET",
  StorageSet: "STORAGE_SET",
  StorageRemove: "STORAGE_REMOVE"
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface Request {
  type: MessageType;
  target: "service-worker" | "offscreen" | "dashboard";
  requestId: string;
  payload?: Record<string, unknown>;
}

export interface Response {
  ok: boolean;
  requestId: string;
  data?: unknown;
  error?: { code: string; message: string; details?: string };
}

export const requestId = () => crypto.randomUUID();

export const failure = (request: Partial<Request>, context: string, error: unknown): Response => ({
  ok: false,
  requestId: request.requestId || "",
  error: {
    code: "MESSAGE_ERROR",
    message: error instanceof Error ? error.message : String(error),
    details: `context=${context}; type=${request.type || "missing"}; target=${request.target || "missing"}; supported=${Object.values(MessageType).join(",")}`
  }
});
