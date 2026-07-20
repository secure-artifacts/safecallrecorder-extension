const lame = require("@breezystack/lamejs");
function test(ch, rate, kbps) {
  const e = new lame.Mp3Encoder(ch, rate, kbps);
  const left = new Int16Array(2304);
  const right = new Int16Array(2304);
  let n = 0;
  for (let i = 0; i < left.length; i += 1152) {
    const buf =
      ch > 1
        ? e.encodeBuffer(left.subarray(i, i + 1152), right.subarray(i, i + 1152))
        : e.encodeBuffer(left.subarray(i, i + 1152));
    n += buf.length;
  }
  n += e.flush().length;
  console.log(`ok ch=${ch} rate=${rate} kbps=${kbps} bytes=${n}`);
}
test(1, 44100, 16);
test(1, 48000, 16);
test(2, 48000, 16);
test(2, 48000, 64);

