# 本地保存与恢复
每个非空 `dataavailable` Blob 立即在 IndexedDB 事务中写入。事务完成后才增加 Session 的“已安全保存”时长；并非严格每两秒，取决于浏览器调度。

浏览器崩溃、任务管理器结束或断电后，已提交 Chunk 会保留，尚未触发或尚未提交的最后一小段可能丢失。下次打开管理页时，`starting`、`recording`、`paused`、`exporting` Session 会变为 `interrupted`，可导出已保存 Part。

继续录制必须建立新 Part，绝不覆盖旧 Chunk。第一版分别下载每个 Part 的 WebM 及 session.json；不会把多个 WebM Blob 简单拼接而冒险损坏录音。数据位于扩展的 IndexedDB（浏览器用户资料中），不是普通可浏览文件夹。卸载扩展会删除此数据，请先导出。
