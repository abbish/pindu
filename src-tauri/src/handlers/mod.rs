//! Tauri 命令处理器模块
//!
//! 此模块作为临时适配器,重新导出 ../handlers_impl.rs 的所有内容
//! 这允许我们保持现有的导入不变,同时逐步拆分模块

// 包含 handlers_impl.rs 文件(原 handlers.rs)
include!("../handlers_impl.rs");
