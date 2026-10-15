// bun 编译时嵌入的文件（`import path from "x.wasm" with { type: "file" }`），导入得到运行时可读的路径
declare module "*.wasm" {
  const path: string;
  export default path;
}
