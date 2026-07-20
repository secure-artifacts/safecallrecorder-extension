# 设备路由
“可录制声音设备”仅列出浏览器给扩展访问的 `audioinput`。所有这类设备均可选：普通/USB 麦克风、Stereo Mix、VoiceMeeter Out B1/B2/B3、CABLE Output 等。名称仅用于提示，绝不限制选择。

“电脑播放设备，仅供核对”中的 `audiooutput` 不能被纯扩展直接录制。若浏览器输出到 VoiceMeeter Input，请在 VoiceMeeter 将该声音送到 B1、B2 或 B3，然后选择对应的 VoiceMeeter Out B1/B2/B3。若输出到 CABLE Input，选择 CABLE Output。

没有音量时检查：浏览器声音是否进入 VoiceMeeter Input、对应 B 总线是否开启、Windows 录音端点是否启用、设备是否静音、采样率是否兼容、VoiceMeeter 是否运行，以及是否被其他软件独占。扩展不会修改 VoiceMeeter。
