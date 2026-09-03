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

2. **新版界面**：左侧为「Google Auth Platform」菜单。

   - **概览** 页没有「开始」按钮是正常的，只会显示「尚未配置 OAuth 客户端」。

   - **先不要点「创建 OAuth 客户端」**，请直接点左侧 **目标对象**。

3. **旧版界面**：概览页若有 **开始** 或 **配置同意屏幕**，点它进入向导。

4. 在 **目标对象** 选 **外部**（个人 Gmail）；Google Workspace 可选 **内部**。

5. 点 **品牌塑造**，填写应用名称、用户支持邮箱、开发者联系邮箱 → **保存**。

6. **数据访问** 页可直接 **保存并继续**（可不添加范围）。

7. 回到 **目标对象** → **测试用户** → 添加你用来连接 Google 的 Gmail → **保存**。

8. 仍在 **目标对象** 页查看 **发布状态**（**不在概览页**显示）：应为 **测试中** / **In testing**。个人使用保持此状态，**不要点「发布应用」**。



## 步骤 3：启用 Google Drive API



1. 打开 [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)。

2. 确认顶部项目正确。

3. 点 **启用**。



## 步骤 4：创建 OAuth 客户端（推荐 · Web 应用）

**重要：** 在控制面板填写客户端 ID 时，必须创建 **Web 应用** 类型。若创建的是 **Chrome 扩展程序** 类型，连接时会报 `redirect_uri_mismatch`（错误 400）。

1. 打开 [凭据 / 客户端](https://console.cloud.google.com/apis/credentials) → **客户端** → **创建客户端**。
2. 应用类型选 **Web 应用**（不要选 Chrome 扩展程序）。
3. **已授权的重定向 URI** → **添加 URI**，粘贴控制面板显示的链接。**必须添加**，格式如下：
   - `https://` + 你的扩展 ID + `.chromiumapp.org/`
   - 示例（本地加载扩展）：`https://emelhfpkanogoiegfanfbbgmglhiblfp.chromiumapp.org/`
   - **以控制面板「Web 应用重定向 URI」那一行为准**（每人扩展 ID 不同）
   - **不要**填 `chrome-extension://…/dashboard.html`
4. **创建** → 复制 **客户端 ID** → 粘贴到控制面板 **OAuth 客户端 ID** 输入框。

## 步骤 4B（备选）：Chrome 扩展程序 — 不推荐

此类型不能与「控制面板粘贴客户端 ID」一起使用。仅适合高级用户直接修改 `manifest.json` 中的 `oauth2.client_id`。



## 步骤 5：在插件中连接并使用



1. 确认 **OAuth 客户端 ID** 已保存（输入框内容完整，底部有「已保存」提示）。

2. 勾选 **启用 Google Drive 上传**。

3. 点 **连接 Google 账号** 并完成授权。

4. **选择 Drive 文件夹** 或 **使用默认文件夹**（自动创建 `SafeCallRecorder`）。

5. 选择上传方式；勾选「停止录音后自动上传 MP3」可在 MP3 生成后自动上传。



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

| 粘贴客户端 ID 后输入框变空 | 重新加载扩展后再粘贴；粘贴后等约 1 秒自动保存，或点击输入框外 |

| 概览页没有「开始」/「测试中」 | 正常；去 **目标对象** 页配置，发布状态也在该页 |

| 扩展 ID 填哪个 | 控制面板显示的 32 位扩展 ID，不是 Cloud 项目 ID |

| `redirect_uri_mismatch` / 错误 400 | 须创建 **Web 应用** 客户端，并把控制面板显示的重定向 URI 完整加入「已授权的重定向 URI」；Chrome 扩展程序类型不适用 |

| `access blocked` / 403 | 在 **目标对象** → **测试用户** 中添加你的 Gmail |

| 连接失败 / invalid client | 检查客户端 ID；Chrome 扩展类型须绑定当前扩展 ID |

| 无法列出文件夹 | 确认已启用 Drive API，并重新授权 |

| 停止后没有自动上传 | 确认已勾选「停止录音后自动上传 MP3」，且 MP3 已生成完成 |

