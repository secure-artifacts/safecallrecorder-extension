# 已知限制

- 主界面仅录制用户选择的 `audioinput` 设备；网页标签页模式与双轨混合已从主界面移除（底层代码可扩展，但不作为默认产品路径）。
- 纯浏览器扩展不能直接录制播放设备（扬声器、VoiceMeeter Input、CABLE Input 等），请选择对应录音端点（如 VoiceMeeter Out B1、CABLE Output）。
- 可通过历史记录中的 **继续录音** 在同一条录音上追加新内容（正常录完或异常中断均可）；已成功写入 IndexedDB 的旧分块不会丢失。
- MP3 由停止后本机解码 WebM/Opus 再用 lamejs（LGPL-3.0）编码；长录音按约 1 分钟分段转换。失败时原始分块保留，可稍后重试或下载可恢复 WebM。
- 本环境未实际接入 VoiceMeeter / 真实通话；请按 `manual-test-plan.md` 在本机验证音浪与 MP3。
