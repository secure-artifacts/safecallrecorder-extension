# Google Drive 上传配置

SafeCallRecorder 可将 MP3 上传到 **Google Drive**（用户自己的 Google 账号，不是 Google Cloud Storage 存储桶）。

## 1. 在 Google Cloud Console 创建 OAuth 客户端

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建或选择一个项目
3. 启用 **Google Drive API**
4. 进入 **API 和服务 → 凭据 → 创建凭据 → OAuth 客户端 ID**

任选一种方式（推荐方式 A）：

### 方式 A：Chrome 扩展程序（推荐）

1. 应用类型选择 **Chrome 扩展程序**
2. 扩展 ID 填写插件控制面板「Google 云端上传」中显示的 **扩展 ID**（与 `chrome://extensions` 页面一致）
3. 复制生成的 **客户端 ID**（形如 `xxxx.apps.googleusercontent.com`）

### 方式 B：Web 应用

1. 应用类型选择 **Web 应用**
2. 在 **已授权的重定向 URI** 中加入控制面板显示的 **重定向 URI**（形如 `https://<扩展ID>.chromiumapp.org/`）
3. 复制生成的客户端 ID

## 2. 在插件中填写客户端 ID

1. 打开控制面板 → **Google 云端上传**
2. 在 **OAuth 客户端 ID** 输入框粘贴上一步复制的客户端 ID
3. 勾选 **启用 Google Drive 上传**
4. 点击 **连接 Google 账号** 并完成授权

无需再编辑 `manifest.json`。若你已在 manifest 中配置了有效的 `oauth2.client_id`，也可继续沿用（不填插件内输入框时自动使用 manifest 中的 ID）。

## 3. 选择文件夹与上传方式

1. **选择 Drive 文件夹** 或 **使用默认文件夹**（会在 Drive 根目录创建 `SafeCallRecorder`）
2. 选择上传方式：
   - **保存本地 + 上传云端**：停止后 MP3 既下载到本机，也上传 Drive
   - **仅上传云端**：停止后 MP3 只上传 Drive，不自动保存 MP3 到本地下载文件夹
3. 历史记录中也可对单条录音点 **上传云端**

## 权限说明

- `drive.file`：上传文件到你选择/创建的文件夹
- `drive.readonly`：浏览文件夹以便选择目标目录
- 录音原始数据仍保存在本机 IndexedDB；只有 MP3 会上传到 Google Drive

## 4. 换浏览器

1. 在旧浏览器控制面板 → **Google 云端上传** → **导出云端配置**
2. 在新浏览器加载扩展 → **导入云端配置**（客户端 ID 与文件夹会一并恢复）
3. 点 **连接 Google 账号** 完成授权
4. 文件夹与上传选项已恢复，可直接上传

配置 JSON 仅含文件夹 ID、客户端 ID 与选项，不含 Google 密码或令牌。

| 问题 | 处理 |
|------|------|
| 连接失败 / invalid client | 检查插件内客户端 ID 是否正确；Chrome 应用类型需绑定当前扩展 ID；Web 应用类型需加入重定向 URI |
| 无法列出文件夹 | 确认已启用 Drive API，并重新授权 |
| 上传失败 | 检查网络；确认已选择目标文件夹 |
| 停止后没有自动上传 | 确认已勾选「停止录音后自动上传 MP3」，且 MP3 已生成完成 |
