//! 应用错误类型与 IPC 错误 contract。
//!
//! Wire 形状（唯一允许）：`{"code": "VALIDATION_ERROR", "message": "验证错误: ..."}`。
//! 规范：`.claude/skills/deliver-contract-and-data/references/tauri-ipc-contract.md` §4。
//! 不要改回 `#[derive(Serialize)]`：外部标签形状 `{"ValidationError":"..."}` 前端无法解析。

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    DatabaseError(String),

    #[error("验证错误: {0}")]
    ValidationError(String),

    #[error("未找到资源: {0}")]
    NotFound(String),

    #[error("权限不足: {0}")]
    Unauthorized(String),

    #[error("内部服务器错误: {0}")]
    InternalError(String),

    #[error("外部服务错误: {0}")]
    ExternalServiceError(String),
}

impl AppError {
    /// 稳定的错误类别码，前端按它分支（不解析 message 文本）。
    pub fn code(&self) -> &'static str {
        match self {
            AppError::DatabaseError(_) => "DATABASE_ERROR",
            AppError::ValidationError(_) => "VALIDATION_ERROR",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Unauthorized(_) => "UNAUTHORIZED",
            AppError::InternalError(_) => "INTERNAL_ERROR",
            AppError::ExternalServiceError(_) => "EXTERNAL_SERVICE_ERROR",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl From<Box<dyn std::error::Error>> for AppError {
    fn from(err: Box<dyn std::error::Error>) -> Self {
        AppError::InternalError(err.to_string())
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => AppError::NotFound("记录未找到".to_string()),
            // Display 已带“数据库错误:”前缀，这里只传原始信息，避免重复
            other => AppError::DatabaseError(other.to_string()),
        }
    }
}

impl From<sqlx::migrate::MigrateError> for AppError {
    fn from(err: sqlx::migrate::MigrateError) -> Self {
        AppError::DatabaseError(format!("迁移错误: {}", err))
    }
}

impl From<AppError> for tauri::Error {
    fn from(err: AppError) -> Self {
        tauri::Error::Anyhow(anyhow::anyhow!(err.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_to_code_and_message() {
        let err = AppError::ValidationError("单词本标题不能为空".to_string());
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            json!({ "code": "VALIDATION_ERROR", "message": "验证错误: 单词本标题不能为空" })
        );
    }

    #[test]
    fn every_variant_has_distinct_code() {
        let all = [
            AppError::DatabaseError(String::new()),
            AppError::ValidationError(String::new()),
            AppError::NotFound(String::new()),
            AppError::Unauthorized(String::new()),
            AppError::InternalError(String::new()),
            AppError::ExternalServiceError(String::new()),
        ];
        let mut codes: Vec<&str> = all.iter().map(AppError::code).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), all.len());
    }

    #[test]
    fn sqlx_errors_are_not_double_prefixed() {
        let err: AppError = sqlx::Error::PoolTimedOut.into();
        assert_eq!(err.to_string().matches("数据库错误").count(), 1);
    }

    #[test]
    fn row_not_found_maps_to_not_found() {
        let err: AppError = sqlx::Error::RowNotFound.into();
        assert_eq!(err.code(), "NOT_FOUND");
    }
}
