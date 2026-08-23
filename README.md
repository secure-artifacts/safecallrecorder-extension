# SafeCallRecorder

本机浏览器录音扩展。选择声音设备 → 确认音浪 → 开始/停止 → 自动生成本机 MP3。不读取网页内容，不上传录音。

## 构建和安装

```powershell
cd SafeCallRecorder.Extension
npm install
npm run typecheck
npm test
npm run build
```

在 Chrome 打开 `chrome://extensions`，或 Edge 打开 `edge://extensions`；开启开发者模式，加载 `SafeCallRecorder.Extension/dist`。

## 使用

1. 点击扩展图标打开管理页。
2. 如需权限，点击“授权设备”。
3. 选择 VoiceMeeter Out B1 等录音设备。
4. 确认实时音浪有跳动。
5. 点「修改」用日期、自定义、编号、空格拼录音名称（各段直接相连，需要间隔时自己加空格），再选比特率。
6. 开始录音；停止后按设置下载原始录音，并在后台生成本机 MP3。
7. 录音永久保留在“录音历史”，可按任意音质重新导出 MP3、下载原始录音或删除。

## 比特率

用户选择的是最终 **MP3 目标比特率**（16–128 kbps，含 24/40/56/80/112 等中间档位）。录音过程中的临时 WebM/Opus 使用不低于目标的捕获质量（最低约 96 kbps），避免先用超低码率录制再“抬高”导出比特率伪造音质。说明文案统一来自 `src/bitrate-presets.ts`。

## MP3 编码

- 录音过程使用浏览器 `MediaRecorder`（优先 `audio/webm;codecs=opus`）并约每 1.5 秒写入 IndexedDB。
- 停止后在 Web Worker 中用 **lamejs 1.2.1**（`lame.min.js`，LGPL-3.0）将解码后的 PCM 编码为 MP3。通过 `importScripts` 加载，避免 esbuild 打包导致的 `MPEGMode is not defined`。
- 库已本地打包进 `dist/lame.min.js` + `dist/mp3-worker.js`，不从 CDN 加载。
- **16 kbps** 默认导出为单声道（左右混合），提高兼容性与语音可懂度。
- 长录音按约 1 分钟分段解码再编码；失败时原始分块保留，可稍后重试或下载原始 WebM。
- 下载原始 WebM 时会写入总时长和定位信息，播放器可显示进度条。

## 隐私

录音仅保存在本机扩展 IndexedDB。卸载扩展会删除本地数据，请先导出。

## 如何发布新版本

本项目使用 GitHub Actions 自动构建和发布。每次发布新版本只需要创建一个 Git Tag 并推送即可。

### 发布步骤

#### 1. 确保代码已提交并推送

```bash
git status
git add .
git commit -m "你的改动说明"
git push origin main
```

#### 2. 创建版本 Tag

版本号格式为 `v主版本.次版本.修订版本`，例如 `v1.0.0`、`v1.1.0`。

```bash
git tag -a v1.0.1 -m "Release version 1.0.1"
```

#### 3. 推送 Tag 触发自动构建

```bash
git push origin v1.0.1
```

推送后，GitHub Actions 会自动构建扩展 zip、生成 Attestation 并创建 Release。

#### 4. 查看构建结果

- 构建进度：仓库 **Actions** 页面
- 发布结果：仓库 **Releases** 页面

### 版本号说明

| 版本号 | 适用场景 | 示例 |
|--------|----------|------|
| `vX.0.0` | 重大更新 | `v2.0.0` |
| `vX.Y.0` | 新功能 | `v1.1.0` |
| `vX.Y.Z` | 修复问题 | `v1.0.1` |

### 如果构建失败怎么办

1. 在 **Actions** 页面查看错误日志
2. 修复代码或 workflow
3. 删除失败的 tag 并重新创建：

```bash
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1
git tag -a v1.0.1 -m "Release version 1.0.1"
git push origin v1.0.1
```
