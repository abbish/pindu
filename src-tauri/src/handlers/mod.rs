//! Tauri 命令处理器模块
//!
//! 按功能域拆分的命令处理器集合

use crate::agent::AgentPaths;
use crate::error::AppResult;
use crate::logger::Logger;
use tauri::AppHandle;

/// 命令出口日志：记录成功 / 失败（失败带用户可读的原因），原样返回结果
pub(crate) fn finish<T>(logger: &Logger, cmd: &str, result: AppResult<T>) -> AppResult<T> {
    logger.api_response(
        cmd,
        result.is_ok(),
        result.as_ref().err().map(|e| e.to_string()).as_deref(),
    );
    result
}

/// agent sidecar 的程序与工作目录（在应用数据目录下）
pub(crate) fn agent_paths(app: &AppHandle) -> AppResult<AgentPaths> {
    AgentPaths::resolve(&crate::app_paths::dirs(app).data)
}

// 功能域模块
pub mod agent_settings;
pub mod ai_model;
pub mod analysis;
pub mod calendar;
// 只在开发构建里注册（前端不调用，见 CLAUDE.md §4.2）
#[cfg(debug_assertions)]
pub mod diagnostics;
pub mod jobs;
pub mod passage;
pub mod passage_import;
pub mod plan_passage;
pub mod practice;
pub mod prompt_profile;
pub mod statistics;
pub mod study_plan;
pub mod system;
pub mod tts;
pub mod updater;
pub mod word;
pub mod word_analysis;
pub mod word_explanation;
pub mod wordbook;

// 重新导出所有命令,保持向后兼容
pub use agent_settings::*;
pub use ai_model::*;
pub use analysis::*;
pub use calendar::*;
#[cfg(debug_assertions)]
pub use diagnostics::*;
pub use jobs::*;
pub use passage::*;
pub use passage_import::*;
pub use plan_passage::*;
pub use practice::*;
pub use prompt_profile::*;
pub use statistics::*;
pub use study_plan::*;
pub use system::*;
pub use tts::*;
pub use updater::*;
pub use word::*;
pub use word_analysis::*;
pub use word_explanation::*;
pub use wordbook::*;
