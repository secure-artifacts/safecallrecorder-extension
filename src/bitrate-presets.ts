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

/** kbps × 0.45 MB/h for mono/stereo stream total bitrate */
function mbPerHour(kbps: number): number {
  return kbps * 0.45;
}

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
    estimatedMbPerHour: mbPerHour(16),
    badge: "可能听不清",
    warning: "该比特率可能导致部分讲话听不清，重要录音不建议使用。"
  },
  {
    bitrate: 24000,
    label: "24 kbps · 超省空间",
    shortTitle: "超省空间",
    shortDescription: "比 16 kbps 更清楚一些，文件仍然很小。适合能听清大意、但对每字每句要求不高的长录音。",
    detailedDescription:
      "在极小文件体积下略好于 16 kbps，普通讲话在安静环境通常能听懂，但轻声、口音和背景噪声仍可能损失细节。",
    suitableFor: ["超长语音备忘", "磁盘空间紧张", "只需把握主要内容"],
    notSuitableFor: ["重要法律或商务通话", "多人重叠讲话", "音乐或复杂系统声"],
    estimatedMbPerHour: mbPerHour(24),
    badge: "极小文件",
    tip: "若仍觉得模糊，可试 32 或 40 kbps。"
  },
  {
    bitrate: 32000,
    label: "32 kbps · 节省空间",
    shortTitle: "节省空间",
    shortDescription: "普通讲话通常可以听清，文件较小。复杂背景、多人重叠和较小声音的细节会有所损失。",
    detailedDescription:
      "普通讲话通常可以听清，文件较小。复杂背景声音、多人重叠讲话和较小声音的细节会有所损失。",
    suitableFor: ["一般语音通话", "长时间语音记录", "磁盘空间有限", "非常安静的会议"],
    estimatedMbPerHour: mbPerHour(32),
    badge: "文件较小",
    tip: "适合普通语音，但重要内容建议使用 48 或 64 kbps。"
  },
  {
    bitrate: 40000,
    label: "40 kbps · 紧凑清晰",
    shortTitle: "紧凑清晰",
    shortDescription: "在较小文件下比 32 kbps 保留更多辅音和轻声，适合日常通话又想再省一点空间的情况。",
    detailedDescription:
      "介于 32 与 48 kbps 之间，普通通话通常更清楚，背景稍复杂时也比 32 kbps 更稳。",
    suitableFor: ["日常语音", "较长会议", "希望文件略小但可听性更好"],
    estimatedMbPerHour: mbPerHour(40),
    badge: "紧凑均衡",
    tip: "若通话较重要，建议直接选 48 或 56 kbps。"
  },
  {
    bitrate: 48000,
    label: "48 kbps · 日常通话",
    shortTitle: "日常通话",
    shortDescription: "语音清晰度和文件大小比较平衡，普通通话、会议和语音聊天通常都能清楚听懂。",
    detailedDescription:
      "语音清晰度和文件大小比较平衡，普通通话、会议和语音聊天通常都能清楚听懂。",
    suitableFor: ["日常通话", "一般会议", "VK、Telegram、WhatsApp 和 Facebook 语音", "长时间录音"],
    estimatedMbPerHour: mbPerHour(48),
    badge: "均衡推荐",
    recommend: "推荐用于普通通话。"
  },
  {
    bitrate: 56000,
    label: "56 kbps · 清晰通话",
    shortTitle: "清晰通话",
    shortDescription: "比 48 kbps 人声更饱满，文件仍适中。适合希望再清楚一点、又不想上到 64 kbps 的通话。",
    detailedDescription:
      "接近重要通话档位，轻声和口音通常比 48 kbps 更好，适合稍重要的日常录音。",
    suitableFor: ["较重要的日常通话", "需要稍高可懂度的会议", "VoiceMeeter 语音路由"],
    estimatedMbPerHour: mbPerHour(56),
    badge: "清晰均衡",
    tip: "重要内容仍建议 64 kbps 及以上。"
  },
  {
    bitrate: 64000,
    label: "64 kbps · 重要通话",
    shortTitle: "重要通话",
    shortDescription: "人声更清楚，适合重要录音和反复听取。",
    detailedDescription:
      "人声更清楚，可以更好保留轻声讲话、口音、多人交流和部分背景声音，适合需要反复听取的重要录音。",
    suitableFor: ["重要通话", "重要会议", "需要反复核对内容", "VoiceMeeter 或虚拟声卡语音录音", "多人讲话"],
    estimatedMbPerHour: mbPerHour(64),
    badge: "默认推荐",
    recommend: "默认推荐，适合大多数重要语音录音。"
  },
  {
    bitrate: 80000,
    label: "80 kbps · 高清晰",
    shortTitle: "高清晰",
    shortDescription: "重要通话与高质量之间的折中，人声和背景细节比 64 kbps 更丰富，文件仍可控。",
    detailedDescription:
      "适合重要且背景略复杂的通话，或需要更好保留系统提示音、多人交替讲话的场景。",
    suitableFor: ["重要会议", "含系统提示音的通话", "希望比 64 kbps 更细一点"],
    estimatedMbPerHour: mbPerHour(80),
    badge: "高清晰",
    tip: "纯单人语音通常 64 kbps 已够；复杂场景可选 80 或 96 kbps。"
  },
  {
    bitrate: 96000,
    label: "96 kbps · 高质量",
    shortTitle: "高质量",
    shortDescription: "保留更多人声和背景细节，适合多人讲话、视频声音和较复杂声音。",
    detailedDescription:
      "能够保留更多人声和背景声音细节，适合多人讲话、视频声音、游戏声音以及包含音乐的通话。",
    suitableFor: ["多人会议", "视频和语音同时存在", "背景声音较复杂", "需要较高音质", "后续简单处理"],
    estimatedMbPerHour: mbPerHour(96),
    badge: "细节更多",
    tip: "纯语音通常使用 64 kbps 已经足够。"
  },
  {
    bitrate: 112000,
    label: "112 kbps · 近立体声",
    shortTitle: "近立体声",
    shortDescription: "接近 128 kbps 的立体声表现，文件略小。适合视频、游戏或 VoiceMeeter 立体声路由。",
    detailedDescription:
      "在立体声或复杂系统声场景下接近最高档，普通纯语音通常不必选这么高。",
    suitableFor: ["立体声系统声", "视频伴音", "游戏录音", "左右声道内容不同"],
    estimatedMbPerHour: mbPerHour(112),
    badge: "立体声优选",
    tip: "若文件体积不敏感，可直接选 128 kbps。"
  },
  {
    bitrate: 128000,
    label: "128 kbps · 高质量立体声",
    shortTitle: "高质量立体声",
    shortDescription: "适合立体声系统声音、音乐、视频和复杂声音；普通语音通常不必用这么高。",
    detailedDescription:
      "适合立体声系统声音、音乐、视频和复杂声音。文件较大，普通语音通话通常没有必要使用这么高的比特率。",
    suitableFor: ["音乐", "视频声音", "游戏声音", "立体声 VoiceMeeter 输出", "左右声道内容不同的录音"],
    estimatedMbPerHour: mbPerHour(128),
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
