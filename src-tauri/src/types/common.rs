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

/// 分页查询参数
#[derive(Debug, Serialize, Deserialize)]
pub struct PaginationQuery {
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

impl Default for PaginationQuery {
    fn default() -> Self {
        Self {
            page: Some(1),
            page_size: Some(20),
        }
    }
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
        let total_pages = if total == 0 { 0 } else { (total + page_size - 1) / page_size };
        Self {
            data,
            total,
            page,
            page_size,
            total_pages,
        }
    }
}

/// 排序参数
#[derive(Debug, Serialize, Deserialize)]
pub struct SortQuery {
    pub field: String,
    pub direction: SortDirection,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum SortDirection {
    #[serde(rename = "asc")]
    Ascending,
    #[serde(rename = "desc")]
    Descending,
}

/// 搜索查询参数
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchQuery {
    pub keyword: Option<String>,
    pub filters: Option<serde_json::Value>,
}


