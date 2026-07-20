/** Unified bitrate presets — UI, history, and encoders must read from here only. */

export type BitratePreset = {
  bitrate: number;
  label: string;
  shortTitle: string;
  shortDescription: string;
  detailedDescription: string;
  suitableFor: string[];
  notSuitableFor?: string[];
  /** Approximate MB per hour for one track at this target average bitrate (kbps × 0.45). */
  estimatedMbPerHour: number;
  badge: string;
  warning?: string;
  recommend?: string;
  tip?: string;
};

export const DEFAULT_BITRATE = 64000;

export const BITRATE_PRESETS: BitratePreset[] = [
  {
    bitrate: 16000,
    label: "16 kbps · 最小文件",
    shortTitle: "最小文件",
    shortDescription:
      "文件非常小，但声音会比较模糊。安静环境中的普通讲话通常可以听懂，低声、口音、噪声或多人同时讲话时可能听不清。",
    detailedDescription:
      "文件非常小，但声音会比较模糊。安静环境中的普通讲话通常可以听懂，低声说话、口音、背景噪声或多人同时讲话时，可能出现听不清的情况。",
    suitableFor: ["非重要的超长时间录音", "只需要了解大概内容", "磁盘空间非常有限"],
    notSuitableFor: ["重要通话", "多人会议", "背景噪声较大的录音", "需要反复核对每句话的录音", "音乐或系统声音"],
    estimatedMbPerHour: 7.2,
    badge: "可能听不清",
    warning: "该比特率可能导致部分讲话听不清，重要录音不建议使用。"
  },
  {
    bitrate: 32000,
    label: "32 kbps · 节省空间",
    shortTitle: "节省空间",
    shortDescription: "普通讲话通常可以听清，文件较小。复杂背景、多人重叠和较小声音的细节会有所损失。",
    detailedDescription:
      "普通讲话通常可以听清，文件较小。复杂背景声音、多人重叠讲话和较小声音的细节会有所损失。",
    suitableFor: ["一般语音通话", "长时间语音记录", "磁盘空间有限", "非常安静的会议"],
    estimatedMbPerHour: 14.4,
    badge: "文件较小",
    tip: "适合普通语音，但重要内容建议使用 48 或 64 kbps。"
  },
  {
    bitrate: 48000,
    label: "48 kbps · 日常通话",
    shortTitle: "日常通话",
    shortDescription: "语音清晰度和文件大小比较平衡，普通通话、会议和语音聊天通常都能清楚听懂。",
    detailedDescription:
      "语音清晰度和文件大小比较平衡，普通通话、会议和语音聊天通常都能清楚听懂。",
    suitableFor: ["日常通话", "一般会议", "VK、Telegram、WhatsApp 和 Facebook 语音", "长时间录音"],
    estimatedMbPerHour: 21.6,
    badge: "均衡推荐",
    recommend: "推荐用于普通通话。"
  },
  {
    bitrate: 64000,
    label: "64 kbps · 重要通话",
    shortTitle: "重要通话",
    shortDescription: "人声更清楚，适合重要录音和反复听取。",
    detailedDescription:
      "人声更清楚，可以更好保留轻声讲话、口音、多人交流和部分背景声音，适合需要反复听取的重要录音。",
    suitableFor: ["重要通话", "重要会议", "需要反复核对内容", "VoiceMeeter 或虚拟声卡语音录音", "多人讲话"],
    estimatedMbPerHour: 28.8,
    badge: "默认推荐",
    recommend: "默认推荐，适合大多数重要语音录音。"
  },
  {
    bitrate: 96000,
    label: "96 kbps · 高质量",
    shortTitle: "高质量",
    shortDescription: "保留更多人声和背景细节，适合多人讲话、视频声音和较复杂声音。",
    detailedDescription:
      "能够保留更多人声和背景声音细节，适合多人讲话、视频声音、游戏声音以及包含音乐的通话。",
    suitableFor: ["多人会议", "视频和语音同时存在", "背景声音较复杂", "需要较高音质", "后续简单处理"],
    estimatedMbPerHour: 43.2,
    badge: "细节更多",
    tip: "纯语音通常使用 64 kbps 已经足够。"
  },
  {
    bitrate: 128000,
    label: "128 kbps · 高质量立体声",
    shortTitle: "高质量立体声",
    shortDescription: "适合立体声系统声音、音乐、视频和复杂声音；普通语音通常不必用这么高。",
    detailedDescription:
      "适合立体声系统声音、音乐、视频和复杂声音。文件较大，普通语音通话通常没有必要使用这么高的比特率。",
    suitableFor: ["音乐", "视频声音", "游戏声音", "立体声 VoiceMeeter 输出", "左右声道内容不同的录音"],
    estimatedMbPerHour: 57.6,
    badge: "适合立体声",
    tip: "普通语音录音会占用更多空间，但听感提升可能不明显。"
  }
];

export const SUPPORTED_BITRATES = BITRATE_PRESETS.map((p) => p.bitrate);

export function getBitratePreset(bitrate: number): BitratePreset {
  return BITRATE_PRESETS.find((p) => p.bitrate === bitrate) || BITRATE_PRESETS.find((p) => p.bitrate === DEFAULT_BITRATE)!;
}

export function resolveBitrate(bitrate: number): number {
  if (SUPPORTED_BITRATES.includes(bitrate as (typeof SUPPORTED_BITRATES)[number])) return bitrate;
  // Nearest supported value
  let best = DEFAULT_BITRATE;
  let bestDist = Infinity;
  for (const b of SUPPORTED_BITRATES) {
    const d = Math.abs(b - bitrate);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

/** Estimated final MP3 size in MB for a duration (total bitrate, not × channels). */
export function estimateMp3Mb(bitrate: number, durationMs: number): number {
  const preset = getBitratePreset(resolveBitrate(bitrate));
  return preset.estimatedMbPerHour * (Math.max(0, durationMs) / 3_600_000);
}

export function formatBitrateHistory(bitrate: number, hasMp3: boolean | undefined): string {
  const p = getBitratePreset(resolveBitrate(bitrate));
  const core = `${Math.round(p.bitrate / 1000)} kbps · ${p.shortTitle}`;
  return hasMp3 ? core : `目标：${core}`;
}

/**
 * Capture WebM/Opus must not be lower than the user's MP3 target,
 * otherwise raising export bitrate cannot recover lost detail.
 * Floor at 96 kbps for safety on low targets (e.g. 16/32).
 */
export function captureAudioBitsPerSecond(targetMp3Bitrate: number): number {
  const target = resolveBitrate(targetMp3Bitrate);
  return Math.max(target, 96000);
}

/** @deprecated Use BITRATE_PRESETS */
export const BITRATE_OPTIONS = BITRATE_PRESETS.map((p) => ({
  value: p.bitrate,
  label: p.label,
  hint: p.shortDescription,
  size: `约${p.estimatedMbPerHour} MB/小时`
}));
