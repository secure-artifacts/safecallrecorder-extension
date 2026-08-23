export type RecordingNamePart = "date" | "number" | "custom" | "space";

export type RecordingNameItem = {
  id: string;
  kind: RecordingNamePart;
  /** Custom text; stored exactly as typed. */
  text?: string;
  numberSeed?: number;
  numberSeedDate?: string;
};

export type RecordingNameConfig = {
  items: RecordingNameItem[];
  /** When true, date is YYYYMMDD; when false, MMDD with no separators. */
  dateIncludeYear: boolean;
  /** Derived from items; kept so older saved settings still round-trip. */
  useDate: boolean;
  useNumber: boolean;
  useCustom: boolean;
  customText: string;
  numberSeed: number;
  numberSeedDate?: string;
  partOrder: RecordingNamePart[];
};

export const DEFAULT_PART_ORDER: RecordingNamePart[] = ["date", "number", "custom"];
export const MAX_RECORDING_NAME_ITEMS = 24;

export function newRecordingNameItemId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `rn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRecordingNameItem(
  kind: RecordingNamePart,
  extras: Partial<Omit<RecordingNameItem, "kind">> = {}
): RecordingNameItem {
  const item: RecordingNameItem = { id: extras.id || newRecordingNameItemId(), kind };
  if (kind === "custom") item.text = extras.text ?? "";
  if (kind === "number") {
    const seed = extras.numberSeed;
    item.numberSeed = Number.isFinite(seed) ? Math.max(0, Math.floor(seed!)) : 1;
    if (extras.numberSeedDate) item.numberSeedDate = extras.numberSeedDate;
  }
  return item;
}

export const DEFAULT_RECORDING_NAME_CONFIG: RecordingNameConfig = {
  items: [{ id: "legacy-date", kind: "date" }],
  dateIncludeYear: false,
  useDate: true,
  useNumber: false,
  useCustom: false,
  customText: "",
  numberSeed: 1,
  partOrder: [...DEFAULT_PART_ORDER]
};

export function normalizePartOrder(order?: RecordingNamePart[] | null): RecordingNamePart[] {
  if (!order?.length) return [...DEFAULT_PART_ORDER];
  const seen = new Set<RecordingNamePart>();
  const out: RecordingNamePart[] = [];
  for (const p of order) {
    if ((p === "date" || p === "number" || p === "custom" || p === "space") && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  for (const p of DEFAULT_PART_ORDER) {
    if (!seen.has(p)) out.push(p);
  }
  return out;
}

export function formatDateOnly(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Recording-name date: MMDD or YYYYMMDD with no separators. */
export function formatRecordingDate(d: Date, includeYear: boolean): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const md = `${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return includeYear ? `${d.getFullYear()}${md}` : md;
}

function parseLocalDate(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, day!);
}

export function daysBetweenLocal(fromIso: string, toIso: string): number {
  const from = parseLocalDate(fromIso);
  const to = parseLocalDate(toIso);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function isPart(value: unknown): value is RecordingNamePart {
  return value === "date" || value === "number" || value === "custom" || value === "space";
}

function sanitizeItems(raw: unknown): RecordingNameItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RecordingNameItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as RecordingNameItem;
    if (!isPart(rec.kind)) continue;
    let id = typeof rec.id === "string" && rec.id ? rec.id : newRecordingNameItemId();
    if (seen.has(id)) id = newRecordingNameItemId();
    seen.add(id);
    out.push(createRecordingNameItem(rec.kind, { ...rec, id }));
    if (out.length >= MAX_RECORDING_NAME_ITEMS) break;
  }
  return out;
}

function migrateLegacyItems(src: Partial<RecordingNameConfig>): RecordingNameItem[] {
  const useDate = src.useDate ?? DEFAULT_RECORDING_NAME_CONFIG.useDate;
  const useNumber = src.useNumber ?? DEFAULT_RECORDING_NAME_CONFIG.useNumber;
  const useCustom = src.useCustom ?? DEFAULT_RECORDING_NAME_CONFIG.useCustom;
  const items: RecordingNameItem[] = [];
  for (const kind of normalizePartOrder(src.partOrder)) {
    if (kind === "date" && useDate) items.push(createRecordingNameItem("date", { id: "legacy-date" }));
    if (kind === "number" && useNumber) {
      items.push(
        createRecordingNameItem("number", {
          id: "legacy-number",
          numberSeed: src.numberSeed,
          numberSeedDate: src.numberSeedDate
        })
      );
    }
    if (kind === "custom" && useCustom) {
      items.push(createRecordingNameItem("custom", { id: "legacy-custom", text: src.customText ?? "" }));
    }
  }
  return items;
}

function legacyFromItems(items: RecordingNameItem[], src: Partial<RecordingNameConfig>): Omit<RecordingNameConfig, "items" | "dateIncludeYear"> {
  const firstNumber = items.find((i) => i.kind === "number");
  const firstCustom = items.find((i) => i.kind === "custom");
  const kinds = items.map((i) => i.kind);
  return {
    useDate: items.some((i) => i.kind === "date"),
    useNumber: Boolean(firstNumber),
    useCustom: Boolean(firstCustom),
    customText: firstCustom?.text ?? src.customText ?? "",
    numberSeed: firstNumber?.numberSeed ?? (Number.isFinite(src.numberSeed) ? Math.max(0, Math.floor(src.numberSeed!)) : 1),
    numberSeedDate: firstNumber?.numberSeedDate ?? src.numberSeedDate,
    partOrder: normalizePartOrder(kinds)
  };
}

export function normalizeRecordingNameConfig(
  partial?: Partial<RecordingNameConfig> | null
): RecordingNameConfig {
  const src = partial || {};
  const items = Array.isArray(src.items) ? sanitizeItems(src.items) : migrateLegacyItems(src);
  return {
    ...legacyFromItems(items, src),
    items,
    dateIncludeYear: (src.dateIncludeYear ?? DEFAULT_RECORDING_NAME_CONFIG.dateIncludeYear) === true
  };
}

export function resolveItemNumber(item: RecordingNameItem, now = new Date()): number {
  const seed = Number.isFinite(item.numberSeed) ? Math.max(0, Math.floor(item.numberSeed!)) : 1;
  if (!item.numberSeedDate) return seed;
  return seed + Math.max(0, daysBetweenLocal(item.numberSeedDate, formatDateOnly(now)));
}

/** Today's number: seed on seedDate, +1 for each full calendar day after. Uses the first number item. */
export function resolveDailyNumber(config: Partial<RecordingNameConfig>, now = new Date()): number {
  const c = normalizeRecordingNameConfig(config);
  const item = c.items.find((i) => i.kind === "number");
  if (!item) return c.numberSeed;
  return resolveItemNumber(item, now);
}

function itemText(item: RecordingNameItem, includeYear: boolean, now: Date): string | null {
  if (item.kind === "date") return formatRecordingDate(now, includeYear);
  if (item.kind === "number") return String(resolveItemNumber(item, now));
  if (item.kind === "custom") return item.text != null && item.text !== "" ? item.text : null;
  if (item.kind === "space") return " ";
  return null;
}

/** Compose the recording title from items in order. Types may repeat. No automatic separator. */
export function buildRecordingName(config: Partial<RecordingNameConfig>, now = new Date()): string {
  const c = normalizeRecordingNameConfig(config);
  const parts: string[] = [];
  for (const item of c.items) {
    const text = itemText(item, c.dateIncludeYear, now);
    if (text != null && text !== "") parts.push(text);
  }
  const name = parts.join("");
  return /\S/.test(name) ? name : "未命名录音";
}

export function recordingNameIsEmpty(config: Partial<RecordingNameConfig>, now = new Date()): boolean {
  const c = normalizeRecordingNameConfig(config);
  return c.items.every((item) => item.kind === "space" || itemText(item, c.dateIncludeYear, now) == null);
}

export function sessionDisplayTitle(displayName?: string, name?: string): string {
  if (displayName != null && displayName !== "") return displayName;
  if (name != null && name !== "") return name;
  return "未命名录音";
}
