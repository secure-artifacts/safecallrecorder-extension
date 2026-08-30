# Google Drive 上传配置

SafeCallRecorder 可将 MP3 上传到 **Google Drive**（用户自己的 Google 账号，不是 Google Cloud Storage 存储桶）。

## 1. 在 Google Cloud Console 创建 OAuth 客户端

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建或选择一个项目
3. 启用 **Google Drive API**
4. 进入 **API 和服务 → 凭据 → 创建凭据 → OAuth 客户端 ID**
5. 应用类型选择 **Chrome 扩展程序**
6. 扩展 ID 填写你加载 `dist` 后，在 `chrome://extensions` 页面看到的 ID
7. 复制生成的 **客户端 ID**（形如 `xxxx.apps.googleusercontent.com`）

## 2. 写入 manifest

编辑 `public/manifest.json`（或构建前的 `dist/manifest.json`）：

```json
"oauth2": {
  "client_id": "你的客户端ID.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.readonly"
  ]
}
```

将 `CONFIGURE_IN_GOOGLE_CLOUD.apps.googleusercontent.com` 替换为你的真实客户端 ID。

重新 `npm run build` 并在 Chrome 中 **重新加载扩展**。

## 3. 在插件中使用

1. 打开控制面板 → **Google 云端上传**
2. 勾选 **启用 Google Drive 上传**
3. 点击 **连接 Google 账号** 并完成授权
4. **选择 Drive 文件夹** 或 **使用默认文件夹**（会在 Drive 根目录创建 `SafeCallRecorder`）
5. 选择上传方式：
   - **保存本地 + 上传云端**：停止后 MP3 既下载到本机，也上传 Drive
   - **仅上传云端**：停止后 MP3 只上传 Drive，不自动保存 MP3 到本地下载文件夹
6. 历史记录中也可对单条录音点 **上传云端**

## 权限说明

- `drive.file`：上传文件到你选择/创建的文件夹
- `drive.readonly`：浏览文件夹以便选择目标目录
- 录音原始数据仍保存在本机 IndexedDB；只有 MP3 会上传到 Google Drive

## 故障排查

| 问题 | 处理 |
|------|------|
| 连接失败 / invalid client | 检查 manifest 中的 client_id 是否与 Chrome 扩展 ID 匹配 |
| 无法列出文件夹 | 确认已启用 Drive API，并重新授权 |
| 上传失败 | 检查网络；确认已选择目标文件夹 |
| 停止后没有自动上传 | 确认已勾选「停止录音后自动上传 MP3」，且 MP3 已生成完成 |
