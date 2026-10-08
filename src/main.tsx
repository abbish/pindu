import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import { apiClient } from "./api/client";

// 界面里没被接住的异常写进应用日志（发布版没有控制台，不记就查不到）
window.addEventListener("error", (e) => {
  apiClient.log("ERROR", "window", e.message || "未知错误", `${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack ?? ""}`);
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
