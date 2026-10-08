import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import { apiClient } from "./api/client";

// 界面里没被接住的异常写进应用日志（发布版没有控制台，不记就查不到）
window.addEventListener("error", (e) => {
  // 控制台执行的代码没有来源文件，WebKit 给的是字符串 "undefined"
  const at = e.filename && e.filename !== "undefined" ? `${e.filename}:${e.lineno}:${e.colno}\n` : "";
  apiClient.log("ERROR", "window", e.message || "未知错误", `${at}${e.error?.stack ?? ""}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason as { message?: string; stack?: string } | undefined;
  apiClient.log("ERROR", "promise", reason?.message ?? String(e.reason), reason?.stack);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
