const fs = require("fs");
const vm = require("vm");
const code = fs.readFileSync("node_modules/lamejs/lame.min.js", "utf8");
const sandbox = { console };
sandbox.self = sandbox;
sandbox.window = sandbox;
sandbox.module = { exports: {} };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(code, sandbox);
const lame = sandbox.lamejs || sandbox.module.exports;
console.log("has Mp3Encoder", typeof lame?.Mp3Encoder);
const e = new lame.Mp3Encoder(1, 44100, 16);
const left = new Int16Array(2304);
let n = 0;
for (let i = 0; i < left.length; i += 1152) {
  n += e.encodeBuffer(left.subarray(i, i + 1152)).length;
}
n += e.flush().length;
console.log("lame.min.js mono 16 ok", n);
