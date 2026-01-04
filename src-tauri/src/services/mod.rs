//! 业务逻辑服务层
//!
//! Service 层负责:
//! - 业务逻辑封装
//! - 跨 Repository 的协调
//! - 事务管理
//! - 数据验证和转换

pub mod ai_model;
pub mod analysis;
pub mod calendar;
pub mod diagnostics;
pub mod practice;
pub mod statistics;
pub mod study_plan;
pub mod theme_tag;
pub mod word;
pub mod wordbook;

// 重新导出服务
pub use ai_model::*;
pub use calendar::*;
pub use practice::*;
pub use statistics::*;
pub use word::*;
