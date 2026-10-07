//! 内置 agent harness：pi（`redlark-agent` sidecar，RPC 模式）的 Rust 侧。
//!
//! - `protocol`：RPC 命令 / 事件（纯函数，有录制 fixture 测试）
//! - `config`：模型配置 + 任务定义 → 启动参数（密钥只走环境变量）
//! - `session`：子进程与 JSONL 通信（超时、进程退出、stderr 收集）
//!
//! 设计与决策：docs/agent-harness/DESIGN.md、docs/agent-harness/DECISIONS.md

pub mod catalog;
pub mod config;
pub mod protocol;
pub mod session;
pub mod tasks;

pub use config::AgentPaths;
