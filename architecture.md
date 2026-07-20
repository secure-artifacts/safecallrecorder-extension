# 架构
SafeCallRecorder 是 Manifest V3 扩展。弹窗和管理页只发送命令及显示状态；service worker 取得当前标签页捕获 ID，并以带互斥锁的方式创建唯一 offscreen document。长期 MediaRecorder、MediaStream 与音量分析只在 offscreen document 内运行，因此关闭弹窗后录音继续。

每个 Session 可以有多个 Part；每个 Part 按 `tab_audio`、`selected_device` 或 `mixed` 轨道记录约两秒一个 Chunk。Session、Part、Chunk 元数据和 Blob 均存于 IndexedDB。chrome.storage.local 仅保存活动 Session 的小型状态镜像，不能保存 Blob。

标签页捕获使用 tabCapture 流 ID；offscreen document 用 getUserMedia 取得流，并仅把标签页流连接到 AudioContext.destination，确保网页仍可听见。设备输入绝不回放到扬声器。混合轨通过 MediaStreamDestination 生成，且始终保留两条原始轨。
