import {
  buildRecordingName,
  DEFAULT_RECORDING_NAME_CONFIG,
  normalizeRecordingNameConfig,
  type RecordingNameConfig
} from "./recording-name";
import type { AppSettings } from "./types";

export type RecordingNameProfile = {
  id: string;
  label: string;
  config: RecordingNameConfig;
  updatedAt: number;
};

export const DEFAULT_PROFILE_LABEL = "默认方案";
export const MAX_RECORDING_NAME_PROFILES = 12;

export function newRecordingNameProfileId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `rnp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRecordingNameProfile(
  label: string,
  config?: Partial<RecordingNameConfig>
): RecordingNameProfile {
  return {
    id: newRecordingNameProfileId(),
    label: label.trim() || DEFAULT_PROFILE_LABEL,
    config: normalizeRecordingNameConfig(config ?? DEFAULT_RECORDING_NAME_CONFIG),
    updatedAt: Date.now()
  };
}

function sanitizeProfile(raw: unknown): RecordingNameProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Partial<RecordingNameProfile>;
  const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : newRecordingNameProfileId();
  const label = typeof rec.label === "string" && rec.label.trim() ? rec.label.trim() : DEFAULT_PROFILE_LABEL;
  return {
    id,
    label,
    config: normalizeRecordingNameConfig(rec.config),
    updatedAt: typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt) ? rec.updatedAt : Date.now()
  };
}

/** Migrate legacy single `recordingName` into profile list. */
export function normalizeRecordingNameProfiles(settings: Partial<AppSettings>): {
  profiles: RecordingNameProfile[];
  activeId: string;
} {
  const fromList = Array.isArray(settings.recordingNameProfiles)
    ? settings.recordingNameProfiles.map(sanitizeProfile).filter(Boolean) as RecordingNameProfile[]
    : [];

  let profiles = fromList.slice(0, MAX_RECORDING_NAME_PROFILES);
  if (!profiles.length) {
    profiles = [
      createRecordingNameProfile(DEFAULT_PROFILE_LABEL, normalizeRecordingNameConfig(settings.recordingName))
    ];
  }

  const activeRaw = settings.activeRecordingNameProfileId;
  let activeId =
    typeof activeRaw === "string" && profiles.some((p) => p.id === activeRaw)
      ? activeRaw
      : profiles[0]!.id;

  return { profiles, activeId };
}

export function getActiveRecordingNameProfile(settings: AppSettings): RecordingNameProfile {
  const { profiles, activeId } = normalizeRecordingNameProfiles(settings);
  return profiles.find((p) => p.id === activeId) ?? profiles[0]!;
}

export function findRecordingNameProfile(
  settings: AppSettings,
  profileId?: string | null
): RecordingNameProfile {
  const { profiles } = normalizeRecordingNameProfiles(settings);
  if (profileId && profiles.some((p) => p.id === profileId)) {
    return profiles.find((p) => p.id === profileId)!;
  }
  return getActiveRecordingNameProfile(settings);
}

/** Name for a session at record or export time (uses session start date for date/number parts). */
export function buildSessionRecordingName(profile: RecordingNameProfile, startedAtMs?: number): string {
  const when = startedAtMs != null && Number.isFinite(startedAtMs) ? new Date(startedAtMs) : new Date();
  return buildRecordingName(profile.config, when);
}

export function applyRecordingNameProfilesToSettings(settings: AppSettings): AppSettings {
  const { profiles, activeId } = normalizeRecordingNameProfiles(settings);
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0]!;
  return {
    ...settings,
    recordingNameProfiles: profiles,
    activeRecordingNameProfileId: activeId,
    recordingName: active.config
  };
}

export function updateProfileConfig(
  settings: AppSettings,
  profileId: string,
  config: RecordingNameConfig
): AppSettings {
  const normalized = normalizeRecordingNameConfig(config);
  const { profiles, activeId } = normalizeRecordingNameProfiles(settings);
  const nextProfiles = profiles.map((p) =>
    p.id === profileId ? { ...p, config: normalized, updatedAt: Date.now() } : p
  );
  const active = nextProfiles.find((p) => p.id === activeId) ?? nextProfiles[0]!;
  return {
    ...settings,
    recordingNameProfiles: nextProfiles,
    activeRecordingNameProfileId: activeId,
    recordingName: active.config
  };
}

export function setActiveRecordingNameProfile(settings: AppSettings, profileId: string): AppSettings {
  const { profiles } = normalizeRecordingNameProfiles(settings);
  if (!profiles.some((p) => p.id === profileId)) return applyRecordingNameProfilesToSettings(settings);
  const active = profiles.find((p) => p.id === profileId)!;
  return {
    ...settings,
    recordingNameProfiles: profiles,
    activeRecordingNameProfileId: profileId,
    recordingName: active.config
  };
}

export function addRecordingNameProfile(settings: AppSettings, label?: string): AppSettings {
  const { profiles, activeId } = normalizeRecordingNameProfiles(settings);
  if (profiles.length >= MAX_RECORDING_NAME_PROFILES) return applyRecordingNameProfilesToSettings(settings);
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0]!;
  const next = [
    ...profiles,
    createRecordingNameProfile(label || `方案 ${profiles.length + 1}`, active.config)
  ];
  return { ...settings, recordingNameProfiles: next, activeRecordingNameProfileId: activeId };
}

export function renameRecordingNameProfile(
  settings: AppSettings,
  profileId: string,
  label: string
): AppSettings {
  const trimmed = label.trim();
  if (!trimmed) return applyRecordingNameProfilesToSettings(settings);
  const { profiles, activeId } = normalizeRecordingNameProfiles(settings);
  return {
    ...settings,
    recordingNameProfiles: profiles.map((p) =>
      p.id === profileId ? { ...p, label: trimmed, updatedAt: Date.now() } : p
    ),
    activeRecordingNameProfileId: activeId
  };
}

export function removeRecordingNameProfile(settings: AppSettings, profileId: string): AppSettings {
  const { profiles, activeId } = normalizeRecordingNameProfiles(settings);
  if (profiles.length <= 1) return applyRecordingNameProfilesToSettings(settings);
  const next = profiles.filter((p) => p.id !== profileId);
  const nextActive = activeId === profileId ? next[0]!.id : activeId;
  const active = next.find((p) => p.id === nextActive)!;
  return {
    ...settings,
    recordingNameProfiles: next,
    activeRecordingNameProfileId: nextActive,
    recordingName: active.config
  };
}
