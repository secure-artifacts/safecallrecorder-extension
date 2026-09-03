import type { RecordingNameConfig } from "./recording-name";
import type { RecordingNameProfile } from "./recording-name-profiles";

export type SourceMode = "tab" | "device" | "both";

/** Active capture / finalize lifecycle (independent of MP3). */
export type SessionStatus =
  | "starting"
  | "recording"
  | "paused"
  | "interrupted"
  | "exporting"
  | "completed"
  | "error";

/** Recording finalize state (MP3 is not required for completion). */
export type RecordingStatus = "starting" | "recording" | "paused" | "completed" | "interrupted" | "error";

export type OriginalStatus = "pending" | "available" | "download_failed" | "missing";

export type Mp3Status =
  | "idle"
  | "queued"
  | "decoding"
  | "encoding"
  | "validating"
  | "completed"
  | "failed"
  | "skipped";

export type TrackKind = "tab_audio" | "selected_device" | "mixed";

/** Legacy UI label field — prefer recordingStatus + mp3Status. */
export type HistoryStatus =
  | "recording"
  | "processing_mp3"
  | "completed"
  | "mp3_failed"
  | "mp3_missing"
  | "mp3_corrupted"
  | "interrupted"
  | "partial"
  | "deleting";

/** What to download / convert after stop. */
export type StopDownloadMode =
  | "original_then_mp3"
  | "original_only"
  | "mp3_only"
  /** Generate consolidated MP3 and upload to Google Drive only (no local save). */
  | "cloud_only";

export interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
  hint: string;
}

export interface Session {
  id: string;
  name: string;
  mode: SourceMode;
  status: SessionStatus;
  startedAt: number;
  endedAt?: number;
  selectedDeviceId?: string;
  selectedDeviceLabel?: string;
  tabTitle?: string;
  safeDurationMs: number;
  lastSavedAt?: number;
  recoveryCount: number;
  interruptionReason?: string;
  bitrate: number;
  mixed: boolean;
  /** User-facing optional title (may differ from auto name). */
  displayName?: string;
  historyStatus?: HistoryStatus;
  durationMs?: number;
  fileSize?: number;
  mp3FileName?: string;
  mp3MimeType?: string;
  hasMp3?: boolean;
  mp3Error?: string;
  /** Split status fields (recording vs original export vs MP3). */
  recordingStatus?: RecordingStatus;
  originalStatus?: OriginalStatus;
  mp3Status?: Mp3Status;
  /** 0–100 while mp3Status is decoding/encoding. */
  mp3Progress?: number;
  /** Human-readable MP3 stage, e.g. "已处理 01:20:00 / 03:25:39". */
  mp3ProgressLabel?: string;
  originalError?: string;
  originalFileName?: string;
  originalMimeType?: string;
  /** Google Drive MP3 upload state. */
  driveMp3Status?: "idle" | "uploading" | "uploaded" | "failed" | "skipped";
  driveMp3FileId?: string;
  driveMp3FileName?: string;
  /** Browser URL to open the uploaded MP3 in Google Drive. */
  driveMp3WebUrl?: string;
  driveMp3Error?: string;
  driveMp3UploadedAt?: number;
}

export interface Part {
  id: string;
  sessionId: string;
  trackId: TrackKind;
  startedAt: number;
  endedAt?: number;
  mimeType: string;
  completed: boolean;
  interruptionReason?: string;
}

export interface Chunk {
  id: string;
  sessionId: string;
  partId: string;
  trackId: TrackKind;
  index: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  size: number;
  mimeType: string;
  blob: Blob;
}

export interface Mp3File {
  id: string;
  sessionId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  blob: Blob;
}

export interface AppSettings {
  /** @deprecated Prefer stopDownloadMode + autoDownloadMp3AfterSuccess */
  autoDownloadMp3: boolean;
  /** Default: original_then_mp3 */
  stopDownloadMode: StopDownloadMode;
  /** Immediately download WebM/ZIP after stop. */
  autoDownloadOriginal: boolean;
  /** After background MP3 succeeds, download MP3. */
  autoDownloadMp3AfterSuccess: boolean;
  /** Keep original file as backup after MP3 download. */
  keepOriginalAfterMp3: boolean;
  defaultBitrate: number;
  defaultDeviceId?: string;
  /** Sound detection sensitivity: sensitive | standard | stable */
  detectionSensitivity?: "sensitive" | "standard" | "stable";
  /** When true, first-run onboarding card is hidden. */
  onboardingDismissed?: boolean;
  /** Master switch: allow automatic recording start. */
  autoStartRecording?: boolean;
  /** Auto start when preview monitor detects stable sound on selected device. */
  autoStartOnSound?: boolean;
  /** Auto start when a local media tab (file://, video/audio file) begins playing. */
  autoStartOnLocalMediaTab?: boolean;
  /** Auto start when in-dashboard local media player reaches end. */
  autoStartOnLocalMediaEnded?: boolean;
  /** Subfolder under the chosen or default download directory, e.g. SafeCallRecorder/会议 */
  downloadFolder?: string;
  /** Display name of the user-picked download directory (handle stored in IndexedDB). */
  customDownloadDirectoryName?: string;
  /** Enable uploading MP3 to Google Drive. */
  googleDriveEnabled?: boolean;
  /** local_and_cloud = save locally + upload; cloud_only = auto upload without local save. */
  googleDriveUploadMode?: "local_and_cloud" | "cloud_only";
  /** Auto upload MP3 to Drive when stop recording and MP3 is ready. */
  googleDriveAutoUploadOnStop?: boolean;
  googleDriveFolderId?: string;
  googleDriveFolderName?: string;
  googleDriveAccountEmail?: string;
  /** OAuth client ID entered in UI; overrides manifest when set. */
  googleDriveClientId?: string;
  /** OAuth client secret for Web app — enables refresh-token (long-lived) auth. */
  googleDriveClientSecret?: string;
  /** Recording name builder (date / daily number / custom). */
  recordingName?: Partial<RecordingNameConfig>;
  /** Multiple naming schemes; active profile used when starting new recordings. */
  recordingNameProfiles?: RecordingNameProfile[];
  activeRecordingNameProfileId?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoDownloadMp3: true,
  stopDownloadMode: "original_then_mp3",
  autoDownloadOriginal: true,
  autoDownloadMp3AfterSuccess: true,
  keepOriginalAfterMp3: true,
  defaultBitrate: 64000,
  detectionSensitivity: "standard",
  onboardingDismissed: false,
  autoStartRecording: false,
  autoStartOnSound: true,
  autoStartOnLocalMediaTab: true,
  autoStartOnLocalMediaEnded: true,
  downloadFolder: "",
  googleDriveEnabled: false,
  googleDriveUploadMode: "local_and_cloud",
  googleDriveAutoUploadOnStop: true
};

export const id = () => crypto.randomUUID();
