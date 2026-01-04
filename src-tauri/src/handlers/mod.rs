//! Tauri 命令处理器模块
//!
//! 按功能域拆分的命令处理器集合

// 共享辅助函数
pub mod helpers;
pub mod shared;

// 功能域模块
pub mod analysis;
pub mod calendar;
pub mod diagnostics;
pub mod practice;
pub mod statistics;
pub mod study_plan;
pub mod word;
pub mod wordbook;

// 重新导出所有命令,保持向后兼容
pub use analysis::*;
pub use calendar::*;
pub use diagnostics::*;
pub use practice::*;
pub use statistics::*;
pub use study_plan::*;
pub use word::*;
pub use wordbook::*;
