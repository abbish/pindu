// pi 发送图片前用 Photon（WASM）缩放。photon-node 按 `__dirname/photon_rs_bg.wasm` 读 wasm，
// 编译成单文件后 __dirname 在 bun 的内嵌文件系统里，读不到，pi 就把每张图都丢掉
// （「[Image omitted: could not be resized below the inline image size limit.]」）。
// 这里把 wasm 嵌进程序，读原路径找不到时改读嵌入的那份；要在 pi 加载 Photon 之前导入。
import { createRequire } from "node:module";
import wasmPath from "@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" };

const WASM_FILENAME = "photon_rs_bg.wasm";
const fs = createRequire(import.meta.url)("fs") as typeof import("node:fs");
const readFileSync = fs.readFileSync.bind(fs);

fs.readFileSync = ((file: unknown, ...rest: unknown[]) =>
  (readFileSync as (...args: unknown[]) => unknown)(
    typeof file === "string" && file.endsWith(WASM_FILENAME) && file !== wasmPath && !fs.existsSync(file) ? wasmPath : file,
    ...rest,
  )) as typeof fs.readFileSync;
