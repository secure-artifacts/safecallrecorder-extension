import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../public/help");
mkdirSync(outDir, { recursive: true });

const FF = "Segoe UI, Microsoft YaHei, sans-serif";
const C = {
  page: "#eef3f8",
  card: "#ffffff",
  line: "#e2e8f0",
  text: "#152033",
  muted: "#64748b",
  label: "#334155",
  accent: "#0f766e",
  accentSoft: "#ccfbf1",
  accentBorder: "#99f6e4",
  chipText: "#115e59",
  grip: "#99f6e4",
  start: "#0d9488",
  danger: "#dc2626",
  helpBg: "#e0f2fe",
  helpText: "#1769aa",
  helpBorder: "#bae6fd",
  panel: "#f8fafc",
  link: "#1769aa",
  okBg: "#f0fdfa",
  okBorder: "#99f6e4",
  meterGrad1: "#e0f2fe",
  meterGrad2: "#ede9fe",
  meterBorder: "#e0e7ff",
  indigo: "#6366f1"
};

function t(x, y, text, opts = {}) {
  const {
    size = 11,
    weight = 600,
    fill = C.text,
    anchor = "start",
    family = FF
  } = opts;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${text}</text>`;
}

function rect(x, y, w, h, opts = {}) {
  const { fill = C.card, stroke = C.line, rx = 8, sw = 1 } = opts;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

function btn(x, y, w, h, label, opts = {}) {
  const { fill = "#fff", stroke = C.line, text = C.label, rx = 8, size = 11, weight = 600 } = opts;
  return `${rect(x, y, w, h, { fill, stroke, rx })}
  ${t(x + w / 2, y + h / 2 + 4, label, { size, weight, fill: text, anchor: "middle" })}`;
}

function chip(x, y, label, w = 88) {
  return `${rect(x, y, w, 32, { fill: C.accentSoft, stroke: C.accentBorder, rx: 10 })}
  ${rect(x, y, 24, 32, { fill: C.grip, stroke: C.accentBorder, rx: 10 })}
  ${t(x + 12, y + 20, "⠿", { size: 14, fill: C.chipText, anchor: "middle" })}
  ${t(x + 34, y + 20, label, { size: 13, weight: 700, fill: C.chipText })}
  ${t(x + w - 12, y + 20, "×", { size: 16, weight: 700, fill: C.accent, anchor: "middle" })}`;
}

const files = {
  "img-dashboard.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 700" role="img" aria-label="控制面板界面示意">
  <rect width="760" height="700" fill="${C.page}"/>
  ${rect(20, 16, 720, 56, { rx: 12, fill: C.card })}
  ${rect(36, 28, 36, 36, { rx: 8, fill: C.accent, stroke: "none" })}
  ${t(84, 44, "SafeCallRecorder", { size: 18, weight: 700 })}
  ${t(84, 60, "录音仅保存在本机，不会上传。", { size: 11, fill: C.accent, weight: 600 })}
  ${btn(588, 30, 96, 28, "？ 使用说明", { fill: C.helpBg, stroke: C.helpBorder, text: C.helpText, rx: 10, size: 11, weight: 800 })}
  ${btn(692, 30, 32, 28, "⚙", { rx: 10, size: 14 })}

  ${rect(20, 84, 720, 600, { rx: 16, fill: C.card, stroke: "#ffffffaa" })}

  ${rect(42, 104, 676, 52, { fill: C.panel, stroke: C.line, rx: 12 })}
  ${t(54, 122, "录音名称", { size: 12, fill: C.muted })}
  ${t(54, 144, "0823VK1", { size: 16, weight: 700 })}
  ${btn(628, 116, 78, 28, "修改", { rx: 8, size: 13 })}

  ${t(42, 178, "声音设备", { size: 13, weight: 600, fill: C.label })}
  ${rect(42, 184, 632, 38, { fill: "#f8fafc", stroke: C.line, rx: 10 })}
  ${t(54, 208, "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)", { size: 11 })}
  ${btn(682, 190, 36, 36, "↻", { rx: 10, size: 16 })}
  ${t(42, 232, "不会选设备？", { size: 12, fill: C.link, weight: 600 })}

  ${rect(42, 246, 676, 148, { fill: C.panel, stroke: C.line, rx: 12 })}
  ${t(56, 268, "设备核对", { size: 14, weight: 700 })}
  ${t(660, 268, "重新核对", { size: 11, fill: C.link, anchor: "end" })}
  ${t(56, 292, "插件当前选择", { size: 11, fill: C.muted })}
  ${t(172, 292, "Voicemeeter Out B1（VoiceMeeter）", { size: 11, weight: 700 })}
  ${t(56, 312, "浏览器默认输入", { size: 11, fill: C.muted })}
  ${t(172, 312, "Voicemeeter Out B1（VoiceMeeter）", { size: 11, weight: 700 })}
  ${t(56, 332, "声道", { size: 11, fill: C.muted })}
  ${t(172, 332, "2 声道", { size: 11, weight: 700 })}
  ${t(56, 352, "立体声", { size: 11, fill: C.muted })}
  ${t(172, 352, "立体声 L/R 正常", { size: 11, weight: 700, fill: C.accent })}
  ${rect(56, 364, 648, 22, { fill: C.okBg, stroke: C.okBorder, rx: 8 })}
  ${t(66, 379, "一致。插件选择与浏览器默认输入相同。", { size: 10, fill: C.accent, weight: 700 })}

  ${rect(42, 406, 676, 118, { fill: C.panel, stroke: C.line, rx: 12 })}
  ${t(56, 428, "本地媒体播放", { size: 14, weight: 700 })}
  ${t(560, 428, "播完后自动开始录音", { size: 12, fill: C.muted, weight: 600 })}
  ${btn(56, 438, 96, 28, "选择本地文件", { rx: 8, size: 11 })}
  ${btn(160, 438, 48, 28, "播放", { fill: C.accent, stroke: C.accent, text: "#fff", rx: 8, size: 11 })}
  ${t(56, 482, "未选择文件", { size: 13, weight: 600, fill: C.label })}
  ${t(56, 508, "选择 mp4、mp3 等本地文件并播放；播放结束后将自动开始录音（需在设置中开启）。", { size: 10, fill: C.muted, weight: 600 })}

  ${rect(42, 536, 676, 108, { fill: `url(#meterGrad)`, stroke: C.meterBorder, rx: 18 })}
  <defs><linearGradient id="meterGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${C.meterGrad1}"/><stop offset="55%" stop-color="${C.meterGrad2}"/><stop offset="100%" stop-color="#faf5ff"/></linearGradient></defs>
  <circle cx="68" cy="560" r="4.5" fill="#14b8a6"/>
  ${t(82, 564, "检测到声音", { size: 13, weight: 700, fill: C.accent })}
  ${rect(588, 550, 72, 20, { fill: "#ccfbf1", stroke: "#99f6e4", rx: 999 })}
  ${t(624, 564, "声音正常", { size: 10, fill: C.accent, weight: 700, anchor: "middle" })}
  ${t(56, 586, "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)", { size: 13, fill: "#475569" })}
  ${rect(56, 596, 648, 28, { fill: "#fff", stroke: "#c7d2fe", rx: 10 })}
  ${rect(64, 608, 12, 16, { fill: C.indigo, stroke: "none", rx: 3 })}
  ${rect(80, 602, 12, 22, { fill: "#818cf8", stroke: "none", rx: 3 })}
  ${rect(96, 606, 12, 18, { fill: C.indigo, stroke: "none", rx: 3 })}
  ${rect(112, 600, 12, 24, { fill: "#a78bfa", stroke: "none", rx: 3 })}
  ${rect(128, 604, 12, 20, { fill: C.indigo, stroke: "none", rx: 3 })}

  ${btn(42, 656, 120, 36, "开始录音", { fill: C.start, stroke: C.start, text: "#fff", rx: 12, size: 12, weight: 700 })}
  ${btn(174, 656, 120, 36, "停止录音", { fill: C.danger, stroke: C.danger, text: "#fff", rx: 12, size: 12, weight: 700 })}
</svg>`,

  "img-rec-name.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img" aria-label="录音名称编辑示意">
  <rect width="640" height="400" fill="${C.page}"/>
  ${rect(20, 16, 600, 368, { rx: 16, fill: C.card })}
  ${rect(36, 32, 568, 52, { fill: C.panel, stroke: C.line, rx: 12 })}
  ${t(48, 50, "录音名称", { size: 12, fill: C.muted })}
  ${t(48, 72, "0823VK1", { size: 16, weight: 700 })}
  ${btn(510, 44, 78, 28, "修改", { rx: 8, size: 13 })}

  ${chip(36, 96, "日期", 82)}
  ${chip(126, 96, "编号", 82)}
  ${chip(216, 96, "自定义", 94)}
  ${btn(324, 98, 56, 28, "添加", { rx: 8, size: 13 })}
  ${t(36, 142, "各段直接相连，不会自动加横线。需要间隔时添加空格。点 × 去掉；拖动 ⠿ 调整顺序。", { size: 10, fill: C.muted, weight: 600 })}

  ${t(36, 168, "日期格式", { size: 13, weight: 600, fill: C.label })}
  ${btn(36, 176, 108, 28, "月日 0829", { fill: C.accentSoft, stroke: C.accentBorder, text: C.chipText, rx: 8, size: 11, weight: 700 })}
  ${btn(152, 176, 132, 28, "年月日 20260829", { rx: 8, size: 11 })}
  ${t(36, 218, "中间不加横杠，只保留数字。可选择带年份或不带年份。", { size: 10, fill: C.muted, weight: 600 })}

  ${t(36, 244, "起始编号", { size: 13, weight: 600, fill: C.label })}
  ${rect(36, 252, 260, 34, { fill: "#f8fafc", stroke: C.line, rx: 10 })}
  ${t(48, 274, "1", { size: 11 })}
  ${t(320, 244, "一轮最大值", { size: 13, weight: 600, fill: C.label })}
  ${rect(320, 252, 260, 34, { fill: "#f8fafc", stroke: C.line, rx: 10 })}
  ${t(332, 274, "8", { size: 11 })}
  ${t(36, 302, "每天自动加 1；若一轮设为 8，编号到 8 后下一天回到 1（9 不会出现）。留空表示一直递增。", { size: 10, fill: C.muted, weight: 600 })}
</svg>`,

  "img-device-verify.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 220" role="img" aria-label="设备核对示意">
  <rect width="640" height="220" fill="${C.page}"/>
  ${rect(20, 16, 600, 188, { rx: 12, fill: C.panel, stroke: C.line })}
  ${t(36, 40, "设备核对", { size: 14, weight: 700 })}
  ${t(596, 40, "重新核对", { size: 11, fill: C.link, anchor: "end" })}
  ${t(36, 64, "插件当前选择", { size: 11, fill: C.muted, weight: 600 })}
  ${t(152, 64, "Voicemeeter Out B1（VoiceMeeter）", { size: 11, weight: 700 })}
  ${t(36, 84, "浏览器默认输入", { size: 11, fill: C.muted, weight: 600 })}
  ${t(152, 84, "Voicemeeter Out B1（VoiceMeeter）", { size: 11, weight: 700 })}
  ${t(36, 104, "声道", { size: 11, fill: C.muted, weight: 600 })}
  ${t(152, 104, "2 声道", { size: 11, weight: 700 })}
  ${t(36, 124, "立体声", { size: 11, fill: C.muted, weight: 600 })}
  ${t(152, 124, "立体声 L/R 正常", { size: 11, weight: 700, fill: C.accent })}
  ${rect(36, 144, 568, 44, { fill: C.okBg, stroke: C.okBorder, rx: 8 })}
  ${t(48, 162, "一致", { size: 11, weight: 700, fill: C.accent })}
  ${t(48, 178, "插件选择与浏览器默认输入相同，立体声路由应能对应。", { size: 10, fill: C.accent, weight: 600 })}
</svg>`,

  "img-local-media.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 200" role="img" aria-label="本地媒体播放示意">
  <rect width="640" height="200" fill="${C.page}"/>
  ${rect(20, 16, 600, 168, { rx: 12, fill: C.panel, stroke: C.line })}
  ${t(36, 40, "本地媒体播放", { size: 14, weight: 700 })}
  ${t(468, 40, "播完后自动开始录音", { size: 12, fill: C.muted, weight: 600 })}
  ${btn(36, 50, 96, 28, "选择本地文件", { rx: 8, size: 11 })}
  ${btn(140, 50, 48, 28, "播放", { fill: C.accent, stroke: C.accent, text: "#fff", rx: 8, size: 11 })}
  ${t(36, 94, "lecture.mp4", { size: 13, weight: 600, fill: C.label })}
  ${rect(36, 104, 568, 44, { fill: "#000", stroke: "none", rx: 10 })}
  <polygon points="300,118 300,134 316,126" fill="#fff" opacity="0.9"/>
  ${t(36, 164, "选择 mp4、mp3 等本地文件并播放；播放结束后将自动开始录音（需在设置中开启）。", { size: 10, fill: C.muted, weight: 600 })}
</svg>`,

  "img-auto-start.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="自动录音设置示意">
  <rect width="640" height="360" fill="${C.page}"/>
  ${rect(20, 16, 600, 328, { rx: 12, fill: C.card, stroke: C.line })}
  ${t(36, 44, "停止录音后的下载方式", { size: 13, weight: 600, fill: C.label })}
  ${rect(36, 50, 568, 34, { fill: "#f8fafc", stroke: C.line, rx: 10 })}
  ${t(48, 72, "立即下载原始录音，并在后台生成MP3（推荐）", { size: 10 })}
  ${t(36, 92, "停止后立即下载原始录音", { size: 11, fill: C.label, weight: 600 })}
  ${rect(572, 98, 22, 14, { fill: C.accent, stroke: "none", rx: 4 })}
  ${t(36, 118, "MP3生成成功后自动下载", { size: 11, fill: C.label, weight: 600 })}
  ${rect(572, 124, 22, 14, { fill: C.accent, stroke: "none", rx: 4 })}
  ${t(36, 144, "默认比特率", { size: 11, fill: C.label, weight: 600 })}
  ${rect(430, 138, 174, 28, { fill: "#f8fafc", stroke: C.line, rx: 8 })}
  ${t(442, 156, "64 kbps · 重要通话", { size: 10 })}
  ${t(36, 176, "声音识别灵敏度", { size: 11, fill: C.label, weight: 600 })}
  ${rect(430, 170, 174, 28, { fill: "#f8fafc", stroke: C.line, rx: 8 })}
  ${t(442, 188, "标准", { size: 10 })}
  ${rect(36, 206, 568, 1, { fill: C.line, stroke: "none", rx: 0 })}
  ${t(36, 228, "检测到声音后自动开始录音", { size: 11, fill: C.label, weight: 600 })}
  ${rect(572, 222, 22, 14, { fill: C.accent, stroke: "none", rx: 4 })}
  ${t(36, 254, "浏览器标签页播放本地媒体时自动开始", { size: 11, fill: C.label, weight: 600 })}
  ${rect(572, 248, 22, 14, { fill: C.line, stroke: "none", rx: 4 })}
  ${t(36, 280, "插件内播放结束后自动开始", { size: 11, fill: C.label, weight: 600 })}
  ${rect(572, 274, 22, 14, { fill: C.accent, stroke: "none", rx: 4 })}
  ${t(36, 304, "「标签页」：在浏览器中打开 mp3/mp4 并开始播放时自动录音。「插件内」：在下方播放器播完后再自动开始。", { size: 10, fill: C.muted, weight: 600 })}
</svg>`,

  "img-waveform.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 200" role="img" aria-label="音浪监测示意">
  <rect width="640" height="200" fill="${C.page}"/>
  ${rect(20, 20, 600, 160, { fill: `url(#waveGrad)`, stroke: C.meterBorder, rx: 18 })}
  <defs><linearGradient id="waveGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${C.meterGrad1}"/><stop offset="55%" stop-color="${C.meterGrad2}"/><stop offset="100%" stop-color="#faf5ff"/></linearGradient></defs>
  <circle cx="44" cy="44" r="4.5" fill="#14b8a6"/>
  ${t(58, 48, "检测到声音", { size: 13, weight: 700, fill: C.accent })}
  ${rect(520, 34, 72, 20, { fill: "#fef3c7", stroke: "#fde68a", rx: 999 })}
  ${t(556, 48, "声音较小", { size: 10, fill: "#a16207", weight: 700, anchor: "middle" })}
  ${t(36, 72, "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)", { size: 13, fill: "#475569", weight: 600 })}
  ${rect(36, 82, 568, 44, { fill: "#fff", stroke: "#c7d2fe", rx: 10 })}
  ${rect(44, 98, 12, 14, { fill: C.indigo, stroke: "none", rx: 3 })}
  ${rect(60, 92, 12, 20, { fill: "#818cf8", stroke: "none", rx: 3 })}
  ${rect(76, 96, 12, 16, { fill: C.indigo, stroke: "none", rx: 3 })}
  ${rect(92, 88, 12, 24, { fill: "#a78bfa", stroke: "none", rx: 3 })}
  ${rect(108, 94, 12, 18, { fill: C.indigo, stroke: "none", rx: 3 })}
  ${rect(124, 90, 12, 22, { fill: "#818cf8", stroke: "none", rx: 3 })}
  ${t(36, 140, "当前音量：42%", { size: 11, fill: "#475569", weight: 600 })}
  ${t(160, 140, "峰值：58%", { size: 11, fill: "#475569", weight: 600 })}
  ${t(36, 162, "音浪跳动表示插件已收到该设备里的声音，可以开始录音。", { size: 10, fill: "#065f46", weight: 600 })}
</svg>`
};

for (const [name, svg] of Object.entries(files)) {
  writeFileSync(join(outDir, name), svg, { encoding: "utf8" });
  console.log("wrote", name);
}
