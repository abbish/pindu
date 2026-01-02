use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

// 为 Box<dyn std::error::Error> 实现 From trait
impl From<Box<dyn std::error::Error>> for AppError {
    fn from(err: Box<dyn std::error::Error>) -> Self {
        AppError::InternalError(err.to_string())
    }
}

#[derive(Error, Debug, Serialize, Deserialize)]
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

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => AppError::NotFound("记录未找到".to_string()),
            sqlx::Error::Database(db_err) => {
                AppError::DatabaseError(format!("数据库错误: {}", db_err))
            }
            _ => AppError::DatabaseError(err.to_string()),
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

// 为了与前端兼容，提供转换到 serde_json::Value
impl From<AppError> for serde_json::Value {
    fn from(err: AppError) -> Self {
        serde_json::json!({
            "error": true,
            "message": err.to_string(),
            "code": match err {
                AppError::DatabaseError(_) => "DATABASE_ERROR",
                AppError::ValidationError(_) => "VALIDATION_ERROR",
                AppError::NotFound(_) => "NOT_FOUND",
                AppError::Unauthorized(_) => "UNAUTHORIZED",
                AppError::InternalError(_) => "INTERNAL_ERROR",
                AppError::ExternalServiceError(_) => "EXTERNAL_SERVICE_ERROR",
            }
        })
    }
}
