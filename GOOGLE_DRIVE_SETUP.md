# Google Drive 上传配置

SafeCallRecorder 可将 MP3 上传到 **Google Drive**（用户自己的 Google 账号，不是 Google Cloud Storage 存储桶）。

控制面板「Google 云端上传」区域有完整分步指引与直达链接；下文为相同流程的文字版。

## 步骤 1：打开 Google Cloud 并创建项目

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，用要上传 Drive 的 Google 账号登录。
2. 页面顶部项目下拉框 → **新建项目**（若已有项目也可直接选用）。
3. 项目名称可填 `SafeCallRecorder` → **创建**，等待几秒。
4. 确认顶部工具栏选中的是刚创建的项目。

## 步骤 2：配置 OAuth 同意屏幕（首次必做）

1. 打开 [OAuth 同意屏幕](https://console.cloud.google.com/apis/credentials/consent)。
2. 个人 Google 账号选 **外部**；Google Workspace 可选 **内部**。
3. 填写应用名称、用户支持邮箱、开发者联系邮箱 → **保存并继续**。
4. **范围** 页可直接 **保存并继续**。
5. **测试用户** 页添加你用来连接 Google 的 Gmail → **保存并继续**。
6. 发布状态为「测试中」即可个人使用。

## 步骤 3：启用 Google Drive API

1. 打开 [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)。
2. 确认顶部项目正确。
3. 点 **启用**。

## 步骤 4A：创建 OAuth 客户端（推荐 · Chrome 扩展程序）

1. 打开 [创建 OAuth 客户端 ID](https://console.cloud.google.com/apis/credentials/oauthclient)。
2. 应用类型选 **Chrome 扩展程序**。
3. **扩展 ID** 填控制面板中显示的扩展 ID（与 `chrome://extensions` 一致）。
4. **创建** → 复制 **客户端 ID** → 粘贴到控制面板 **OAuth 客户端 ID** 输入框。

## 步骤 4B：创建 OAuth 客户端（备选 · Web 应用）

1. 应用类型选 **Web 应用**。
2. **已授权的重定向 URI** 添加控制面板显示的重定向 URI（形如 `https://<扩展ID>.chromiumapp.org/`，须完全一致）。
3. **创建** → 复制客户端 ID → 粘贴到控制面板。

## 步骤 5：在插件中连接并使用

1. 勾选 **启用 Google Drive 上传**。
2. 点 **连接 Google 账号** 并完成授权。
3. **选择 Drive 文件夹** 或 **使用默认文件夹**（自动创建 `SafeCallRecorder`）。
4. 选择上传方式；勾选「停止录音后自动上传 MP3」可在 MP3 生成后自动上传。

无需编辑 `manifest.json`。若 manifest 中已有有效 `oauth2.client_id`，不填控制面板输入框时会自动沿用。

## 权限说明

- `drive.file`：上传文件到你选择/创建的文件夹
- `drive.readonly`：浏览文件夹以便选择目标目录
- 录音原始数据仍保存在本机 IndexedDB；只有 MP3 会上传到 Google Drive

## 换浏览器

1. 旧浏览器 **导出云端配置**
2. 新浏览器 **导入云端配置**（客户端 ID 与文件夹一并恢复）
3. **连接 Google 账号** 重新授权

## 故障排查

| 问题 | 处理 |
|------|------|
| `redirect_uri_mismatch` | Web 应用类型的重定向 URI 须与控制面板显示完全一致 |
| `access blocked` / 403 | 在 OAuth 同意屏幕的测试用户中添加你的 Gmail |
| 连接失败 / invalid client | 检查客户端 ID；Chrome 扩展类型须绑定当前扩展 ID |
| 无法列出文件夹 | 确认已启用 Drive API，并重新授权 |
| 停止后没有自动上传 | 确认已勾选「停止录音后自动上传 MP3」，且 MP3 已生成完成 |
