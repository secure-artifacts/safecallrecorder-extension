import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../public/help");
mkdirSync(outDir, { recursive: true });

const files = {
  "img-dashboard.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 420" role="img" aria-label="控制面板界面示意">
  <rect width="760" height="420" fill="#f1f5f9"/>
  <rect x="24" y="20" width="712" height="380" rx="16" fill="#fff" stroke="#e2e8f0"/>
  <rect x="44" y="36" width="36" height="36" rx="8" fill="#0f766e"/>
  <text x="90" y="52" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="18" font-weight="700" fill="#0f172a">SafeCallRecorder</text>
  <text x="90" y="68" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#64748b">录音仅保存在本机，不会上传</text>
  <rect x="560" y="34" width="88" height="28" rx="8" fill="#e0f2fe" stroke="#bae6fd"/>
  <text x="604" y="52" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#1769aa">使用说明</text>
  <rect x="656" y="34" width="32" height="28" rx="8" fill="#fff" stroke="#e2e8f0"/>
  <text x="44" y="98" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12" font-weight="700" fill="#334155">声音设备</text>
  <rect x="44" y="104" width="644" height="30" rx="8" fill="#fff" stroke="#cbd5e1"/>
  <text x="56" y="123" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#0f172a">Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)</text>
  <rect x="44" y="146" width="644" height="72" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="56" y="166" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12" font-weight="700" fill="#0f172a">设备核对</text>
  <rect x="56" y="194" width="620" height="18" rx="6" fill="#f0fdfa" stroke="#99f6e4"/>
  <text x="66" y="207" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10" fill="#0f766e">一致：插件选择与浏览器默认输入相同</text>
  <rect x="44" y="228" width="644" height="56" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="56" y="248" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12" font-weight="700" fill="#0f172a">本地媒体播放</text>
  <rect x="56" y="256" width="88" height="22" rx="6" fill="#fff" stroke="#cbd5e1"/>
  <text x="100" y="271" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10" fill="#334155">选择本地文件</text>
  <rect x="152" y="256" width="44" height="22" rx="6" fill="#0f766e"/>
  <text x="174" y="271" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10" fill="#fff">播放</text>
  <rect x="44" y="294" width="644" height="48" rx="10" fill="#f0fdfa" stroke="#99f6e4"/>
  <text x="56" y="314" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#0f766e">检测到声音</text>
  <rect x="130" y="322" width="520" height="10" rx="5" fill="#dbeafe"/>
  <rect x="130" y="322" width="360" height="10" rx="5" fill="#6366f1"/>
  <rect x="44" y="354" width="120" height="34" rx="10" fill="#0f766e"/>
  <text x="104" y="375" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12" font-weight="700" fill="#fff">开始录音</text>
  <rect x="176" y="354" width="120" height="34" rx="10" fill="#fff" stroke="#fecaca"/>
  <text x="236" y="375" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12" font-weight="700" fill="#b91c1c">停止录音</text>
</svg>`,
  "img-device-verify.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 260" role="img" aria-label="设备核对示意">
  <rect width="640" height="260" fill="#f8fafc"/>
  <rect x="20" y="16" width="600" height="228" rx="12" fill="#fff" stroke="#e2e8f0"/>
  <text x="36" y="42" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#0f172a">设备核对</text>
  <text x="560" y="42" text-anchor="end" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#1769aa">重新核对</text>
  <text x="36" y="72" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#64748b">插件当前选择</text>
  <text x="160" y="72" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#0f172a">Voicemeeter Out B1</text>
  <text x="36" y="98" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#64748b">浏览器默认输入</text>
  <text x="160" y="98" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#0f172a">Voicemeeter Out B1</text>
  <rect x="36" y="166" width="568" height="58" rx="8" fill="#f0fdfa" stroke="#99f6e4"/>
  <text x="48" y="188" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#0f766e">一致</text>
  <text x="48" y="208" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10" fill="#0f766e">插件选择与浏览器默认输入相同，立体声路由应能对应。</text>
</svg>`,
  "img-local-media.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300" role="img" aria-label="本地媒体播放示意">
  <rect width="640" height="300" fill="#f8fafc"/>
  <rect x="20" y="16" width="600" height="268" rx="12" fill="#fff" stroke="#e2e8f0"/>
  <text x="36" y="42" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="14" font-weight="700" fill="#0f172a">本地媒体播放</text>
  <text x="500" y="42" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#64748b">播完后自动开始录音</text>
  <rect x="36" y="56" width="96" height="26" rx="7" fill="#fff" stroke="#cbd5e1"/>
  <text x="84" y="73" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#334155">选择本地文件</text>
  <rect x="140" y="56" width="48" height="26" rx="7" fill="#0f766e"/>
  <text x="164" y="73" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#fff">播放</text>
  <text x="36" y="102" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#334155">lecture.mp4</text>
  <rect x="36" y="112" width="568" height="120" rx="10" fill="#000"/>
  <polygon points="300,152 300,192 340,172" fill="#fff" opacity="0.9"/>
  <rect x="36" y="244" width="568" height="24" rx="6" fill="#f0fdfa" stroke="#99f6e4"/>
  <text x="48" y="260" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10" fill="#0f766e">正在播放，结束后将自动开始录音。</text>
</svg>`,
  "img-auto-start.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320" role="img" aria-label="自动录音设置示意">
  <rect width="640" height="320" fill="#f1f5f9"/>
  <rect x="20" y="16" width="600" height="288" rx="14" fill="#fff" stroke="#e2e8f0"/>
  <text x="36" y="44" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="15" font-weight="700" fill="#0f172a">设置</text>
  <rect x="36" y="58" width="568" height="34" rx="8" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="48" y="79" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#334155">检测到声音后自动开始录音</text>
  <rect x="572" y="68" width="22" height="14" rx="4" fill="#0f766e"/>
  <rect x="36" y="100" width="568" height="34" rx="8" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="48" y="121" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#334155">浏览器标签页播放本地媒体时自动开始</text>
  <rect x="572" y="110" width="22" height="14" rx="4" fill="#cbd5e1"/>
  <rect x="36" y="142" width="568" height="34" rx="8" fill="#f0fdfa" stroke="#99f6e4"/>
  <text x="48" y="163" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" font-weight="700" fill="#0f766e">插件内播放结束后自动开始</text>
  <rect x="572" y="152" width="22" height="14" rx="4" fill="#0f766e"/>
  <text x="36" y="200" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10" fill="#64748b">标签页：播放时自动录音。插件内：播完后再自动开始。</text>
  <rect x="36" y="236" width="568" height="52" rx="8" fill="#fffbeb" stroke="#fde68a"/>
  <text x="48" y="258" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10" font-weight="700" fill="#92400e">新手推荐</text>
  <text x="48" y="276" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10" fill="#92400e">先播本地视频，播完再录通话：勾选插件内播放结束后自动开始。</text>
</svg>`,
  "img-waveform.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 180" role="img" aria-label="音浪监测示意">
  <rect width="640" height="180" fill="#f0fdfa"/>
  <rect x="20" y="20" width="600" height="140" rx="12" fill="#fff" stroke="#99f6e4"/>
  <text x="36" y="48" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#0f766e">检测到声音</text>
  <rect x="520" y="34" width="72" height="20" rx="999" fill="#fef3c7" stroke="#fde68a"/>
  <text x="556" y="48" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10" fill="#a16207">声音较小</text>
  <rect x="48" y="110" width="12" height="18" rx="3" fill="#6366f1"/>
  <rect x="64" y="98" width="12" height="30" rx="3" fill="#818cf8"/>
  <rect x="80" y="104" width="12" height="24" rx="3" fill="#6366f1"/>
  <rect x="96" y="92" width="12" height="36" rx="3" fill="#a78bfa"/>
  <rect x="112" y="100" width="12" height="28" rx="3" fill="#6366f1"/>
  <text x="36" y="156" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10" fill="#065f46">音浪跳动表示插件已收到该设备里的声音，可以开始录音。</text>
</svg>`
};

for (const [name, svg] of Object.entries(files)) {
  writeFileSync(join(outDir, name), svg, { encoding: "utf8" });
  console.log("wrote", name);
}
