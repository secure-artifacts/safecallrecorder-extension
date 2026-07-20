# 已知限制

- 主界面仅录制用户选择的 `audioinput` 设备；网页标签页模式与双轨混合已从主界面移除（底层代码可扩展，但不作为默认产品路径）。
- 纯浏览器扩展不能直接录制播放设备（扬声器、VoiceMeeter Input、CABLE Input 等），请选择对应录音端点（如 VoiceMeeter Out B1、CABLE Output）。
- 浏览器关闭或崩溃后不能继续产生新音频；仅保留已成功写入 IndexedDB 的分块。
- MP3 由停止后本机解码 WebM/Opus 再用 lamejs（LGPL-3.0）编码；超长录音受内存限制，失败时原始分块保留，可稍后重试或下载可恢复 WebM。
- 本环境未实际接入 VoiceMeeter / 真实通话；请按 `manual-test-plan.md` 在本机验证音浪与 MP3。
