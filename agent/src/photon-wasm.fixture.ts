// photon-wasm.test.ts 编译成单文件后运行：模拟用户电脑上没有编译机器的路径，
// 读 Photon 的 wasm 应拿到嵌入的那份；其他找不到的文件照常报错。
import "./photon-wasm.ts";
import { createRequire } from "node:module";

const fs = createRequire(import.meta.url)("fs") as typeof import("node:fs");
const wasm = fs.readFileSync("/Users/runner/work/pindu/pindu/agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm");
let other = "read";
try {
  fs.readFileSync("/nonexistent-redlark/other.txt");
} catch (error) {
  other = (error as NodeJS.ErrnoException).code ?? "error";
}
console.log(JSON.stringify({ valid: WebAssembly.validate(wasm), other }));
