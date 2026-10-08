//! 内置 agent harness：pi（`redlark-agent` sidecar，RPC 模式）的 Rust 侧。
//!
//! - `protocol`：RPC 命令 / 事件（纯函数，有录制 fixture 测试）
//! - `config`：模型配置 + 任务定义 → 启动参数（密钥只走环境变量）
//! - `session`：子进程与 JSONL 通信（超时、进程退出、stderr 收集）
//! - `follow_up`：讲解 / 答疑末尾的推荐追问（拆分、校正、流式闸门）
//! - `run_log`：每次运行的执行日志（开始 / 重试 / 工具退回 / 结束与用量 / 失败）
//!
//! 设计与决策：docs/agent-harness/DESIGN.md、docs/agent-harness/DECISIONS.md

pub mod catalog;
pub mod config;
pub mod follow_up;
pub mod protocol;
pub mod run_log;
pub mod session;
pub mod tasks;

pub use config::AgentPaths;
