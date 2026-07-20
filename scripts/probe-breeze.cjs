const m = require("@breezystack/lamejs");
console.log("keys", Object.keys(m));
console.log("default keys", m.default ? Object.keys(m.default) : null);
const Enc = m.Mp3Encoder || (m.default && m.default.Mp3Encoder);
console.log("Enc", typeof Enc);
if (Enc) {
  const e = new Enc(1, 44100, 16);
  const left = new Int16Array(1152);
  console.log("encode", e.encodeBuffer(left).length);
}
