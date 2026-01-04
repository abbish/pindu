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
            (total + page_size - 1) / page_size
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

