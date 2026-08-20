import { deviceHint } from "./device-manager";

export type DeviceMatchStatus =
  | "match_id"
  | "match_label"
  | "mismatch"
  | "browser_unknown"
  | "no_selection";

export type InputDeviceInfo = {
  deviceId: string;
  label: string;
  hint: string;
  channelCount?: number;
  sampleRate?: number;
};

export type StereoCheckState =
  | "stereo_balanced"
  | "stereo_left_only"
  | "stereo_right_only"
  | "mono"
  | "silent"
  | "unknown";

export type StereoCheck = {
  channels: number;
  leftLevel: number;
  rightLevel: number;
  state: StereoCheckState;
  label: string;
};

function normalizeLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function readInputFromStream(stream: MediaStream | undefined): InputDeviceInfo | null {
  const track = stream?.getAudioTracks()[0];
  if (!track) return null;
  const settings = track.getSettings();
  const label = track.label || settings.deviceId || "声音设备";
  return {
    deviceId: settings.deviceId || track.id,
    label,
    hint: deviceHint(label),
    channelCount: settings.channelCount,
    sampleRate: settings.sampleRate
  };
}

/** Opens browser default microphone briefly to read its deviceId/label. */
export async function probeBrowserDefaultInput(): Promise<InputDeviceInfo | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const info = readInputFromStream(stream);
    return info;
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

function formatChannels(count?: number): string {
  if (count == null || count <= 0) return "未知";
  if (count === 1) return "单声道 (1)";
  if (count === 2) return "立体声 (2)";
  return `${count} 声道`;
}

export function compareSelectedWithBrowser(
  selected: InputDeviceInfo | null,
  browser: InputDeviceInfo | null
): {
  status: DeviceMatchStatus;
  ok: boolean;
  title: string;
  detail: string;
  channelNote: string;
} {
  if (!selected?.deviceId) {
    return {
      status: "no_selection",
      ok: false,
      title: "请先选择录音设备",
      detail: "选择 VoiceMeeter Out B1 等设备后，可与此处浏览器默认输入对照。",
      channelNote: ""
    };
  }
  if (!browser?.deviceId) {
    return {
      status: "browser_unknown",
      ok: false,
      title: "无法读取浏览器默认输入",
      detail: "请授权声音设备权限，然后点击「重新核对」。",
      channelNote: `插件选择：${formatChannels(selected.channelCount)}`
    };
  }

  const sameId = selected.deviceId === browser.deviceId;
  const sameLabel = normalizeLabel(selected.label) === normalizeLabel(browser.label);
  const channelNote = `插件 ${formatChannels(selected.channelCount)} · 浏览器默认 ${formatChannels(browser.channelCount)}`;

  if (sameId) {
    return {
      status: "match_id",
      ok: true,
      title: "一致：插件选择与浏览器默认输入相同",
      detail: `当前均为「${selected.label}」。立体声路由应能对应。`,
      channelNote
    };
  }
  if (sameLabel) {
    return {
      status: "match_label",
      ok: true,
      title: "名称一致（设备 ID 不同，通常仍可用）",
      detail: `插件：${selected.label}；浏览器默认：${browser.label}。若音浪正常，一般无需更改。`,
      channelNote
    };
  }

  return {
    status: "mismatch",
    ok: false,
    title: "不一致：插件选择与浏览器默认输入不同",
    detail: `插件当前选择「${selected.label}」，但浏览器默认输入是「${browser.label}」。若你要录 VoiceMeeter 立体声，请在浏览器设置中将默认麦克风改为同一设备，或确认插件选择的就是你要录的设备。`,
    channelNote
  };
}

function rmsFromAnalyser(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

/** Sample L/R levels on a stereo stream (uses a short-lived AudioContext). */
export async function probeStereoFromStream(stream: MediaStream, sampleMs = 250): Promise<StereoCheck> {
  const track = stream.getAudioTracks()[0];
  if (!track) {
    return { channels: 0, leftLevel: 0, rightLevel: 0, state: "unknown", label: "无法读取声道" };
  }
  const settings = track.getSettings();
  const channels = settings.channelCount || 1;
  if (channels < 2) {
    return {
      channels: 1,
      leftLevel: 0,
      rightLevel: 0,
      state: "mono",
      label: "当前输入为单声道"
    };
  }

  const ctx = new AudioContext();
  try {
    const source = ctx.createMediaStreamSource(stream);
    const splitter = ctx.createChannelSplitter(2);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = 512;
    analyserR.fftSize = 512;
    source.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    await new Promise((r) => setTimeout(r, sampleMs));
    const leftLevel = rmsFromAnalyser(analyserL);
    const rightLevel = rmsFromAnalyser(analyserR);
    const threshold = 0.008;
    const leftActive = leftLevel >= threshold;
    const rightActive = rightLevel >= threshold;

    let state: StereoCheckState = "silent";
    let label = "立体声：暂未检测到左右声道信号";
    if (leftActive && rightActive) {
      state = "stereo_balanced";
      label = "立体声：左、右声道均有信号";
    } else if (leftActive) {
      state = "stereo_left_only";
      label = "立体声：目前仅左声道有信号，请检查 VoiceMeeter 路由或平衡";
    } else if (rightActive) {
      state = "stereo_right_only";
      label = "立体声：目前仅右声道有信号，请检查 VoiceMeeter 路由或平衡";
    }

    return { channels: 2, leftLevel, rightLevel, state, label };
  } catch {
    return { channels: 2, leftLevel: 0, rightLevel: 0, state: "unknown", label: "立体声检测失败" };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

export function stereoStateLabel(check: StereoCheck): string {
  return check.label;
}

export { formatChannels, normalizeLabel };
