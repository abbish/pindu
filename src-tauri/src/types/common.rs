use serde::{Deserialize, Serialize};

/// 通用 ID 类型
pub type Id = i64;

/// 时间戳类型
pub type Timestamp = String;

/// 单词保存结果统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordSaveResult {
    pub book_id: Id,
    pub added_count: i32,
    pub updated_count: i32,
    pub skipped_count: i32,
}

/// 分页响应
#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub data: Vec<T>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
}

impl<T> PaginatedResponse<T> {
    pub fn new(data: Vec<T>, total: u32, page: u32, page_size: u32) -> Self {
        let total_pages = if total == 0 {
            0
        } else {
            total.div_ceil(page_size)
        };
        Self {
            data,
            total,
            page,
            page_size,
            total_pages,
        }
    }
}

/// 启动失败的原因（数据库打不开或升级失败）：前端只显示错误页，不调用其它命令
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupFailure {
    /// connect / interrupted / newer_database / modified_migration / backup / migrate
    pub kind: String,
    pub title: String,
    /// 给用户看的说明
    pub message: String,
    /// 原始错误（日志与反馈用）
    pub detail: Option<String>,
    pub data_dir: String,
    /// 升级前备份所在目录
    pub backup_dir: String,
}

/// 启动状态
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    pub ok: bool,
    pub failure: Option<StartupFailure>,
}

/// 检查到的新版本
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    /// 更新说明（latest.json 的 notes，来自 docs/releases/vX.md）
    pub notes: Option<String>,
    /// 能否在应用内安装（Linux deb / rpm 不能，只提示去下载）
    pub can_install: bool,
}

/// 下载进度
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}
