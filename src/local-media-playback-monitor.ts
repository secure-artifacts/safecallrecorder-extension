import {
  AnalyserLevelMonitor,
  StreamLevelMonitor,
  type AudioLevelUpdate
} from "./stream-level-monitor";

type MediaElementWithCapture = HTMLMediaElement & { captureStream?: () => MediaStream };

export class LocalMediaPlaybackMonitor {
  private streamMonitor?: StreamLevelMonitor;
  private analyserMonitor?: AnalyserLevelMonitor;
  private detachListener?: () => void;

  startFromMediaElement(el: HTMLMediaElement, label: string, onUpdate: (update: AudioLevelUpdate) => void) {
    this.stop();
    const capture = (el as MediaElementWithCapture).captureStream;
    if (typeof capture !== "function") return false;
    let stream: MediaStream;
    try {
      stream = capture.call(el);
    } catch {
      return false;
    }
    if (!stream.getAudioTracks().length) return false;
    const monitor = new StreamLevelMonitor("localMedia", "test", label, stream);
    this.detachListener = monitor.onUpdate(onUpdate);
    monitor.start();
    this.streamMonitor = monitor;
    return true;
  }

  startFromAnalyser(analyser: AnalyserNode, label: string, onUpdate: (update: AudioLevelUpdate) => void) {
    this.stop();
    const monitor = new AnalyserLevelMonitor("localMedia", "test", label, analyser);
    this.detachListener = monitor.onUpdate(onUpdate);
    monitor.start();
    this.analyserMonitor = monitor;
    return true;
  }

  stop() {
    this.detachListener?.();
    this.detachListener = undefined;
    this.streamMonitor?.stop();
    this.analyserMonitor?.stop();
    this.streamMonitor = undefined;
    this.analyserMonitor = undefined;
  }
}
