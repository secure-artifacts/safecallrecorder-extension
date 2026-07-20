export function createMixer(tab?: MediaStream, device?: MediaStream) {
  const context = new AudioContext(), destination = context.createMediaStreamDestination();
  if (tab) context.createMediaStreamSource(tab).connect(destination); // Tab is separately routed to destination by caller.
  if (device) { const gain = context.createGain(); gain.gain.value = 0.7; context.createMediaStreamSource(device).connect(gain).connect(destination); } // Never route device input to speakers.
  return { context, stream: destination.stream };
}
