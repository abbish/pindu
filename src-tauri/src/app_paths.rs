//! 应用在本机的目录：数据目录、缓存目录、数据库文件、升级备份（唯一 owner，启动时解析一次后 `app.manage`）。
//!
//! 数据目录由 Tauri 按 bundle identifier（`com.redlark.pindu-app`）定位。**identifier 与 [`DB_FILE`] 发布后永不修改**：
//! 改了就会在新位置建一个空库，用户看起来像数据全丢了（`scripts/check-release-invariants.py` 守护）。
//!
//! - 发布版：`<系统数据目录>/com.redlark.pindu-app/`
//! - 开发版（debug 构建）：`<系统数据目录>/com.redlark.pindu-app-dev/`，与安装版互不影响
//! - 环境变量 [`DATA_DIR_ENV`] 可指定任意目录（测试、演示数据），缓存放在它下面的 `cache/`

use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 数据库文件名（发布后不可修改）
pub const DB_FILE: &str = "vocabulary.db";
/// 覆盖数据目录的环境变量
pub const DATA_DIR_ENV: &str = "PINDU_DATA_DIR";
/// 开发版目录名后缀
const DEV_SUFFIX: &str = "-dev";

/// 本机目录
#[derive(Debug, Clone)]
pub struct AppDirs {
    /// 数据目录：数据库、日志、升级备份、agent 工作目录
    pub data: PathBuf,
    /// 缓存目录：语音缓存等，可随时删除
    pub cache: PathBuf,
}

impl AppDirs {
    /// 按 环境变量 > 构建类型 解析目录（不创建）
    pub fn resolve(app: &AppHandle) -> AppResult<Self> {
        if let Some(dir) = std::env::var_os(DATA_DIR_ENV).filter(|v| !v.is_empty()) {
            let data = PathBuf::from(dir);
            return Ok(Self {
                cache: data.join("cache"),
                data,
            });
        }
        let path = app.path();
        let data = path
            .app_data_dir()
            .map_err(|e| AppError::InternalError(format!("无法获取应用数据目录：{e}")))?;
        let cache = path
            .app_cache_dir()
            .map_err(|e| AppError::InternalError(format!("无法获取应用缓存目录：{e}")))?;
        if cfg!(debug_assertions) {
            Ok(Self {
                data: with_suffix(&data, DEV_SUFFIX),
                cache: with_suffix(&cache, DEV_SUFFIX),
            })
        } else {
            Ok(Self { data, cache })
        }
    }

    /// 数据库文件
    pub fn db_path(&self) -> PathBuf {
        self.data.join(DB_FILE)
    }

    /// 升级前的自动备份
    pub fn backups_dir(&self) -> PathBuf {
        self.data.join("backups")
    }
}

/// 已解析的目录（启动时 `app.manage` 过）
pub fn dirs(app: &AppHandle) -> AppDirs {
    app.state::<AppDirs>().inner().clone()
}

/// 给目录名加后缀：`.../com.redlark.pindu-app` → `.../com.redlark.pindu-app-dev`
fn with_suffix(dir: &Path, suffix: &str) -> PathBuf {
    let mut name = dir.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    dir.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_dir_is_a_sibling_with_suffix() {
        let dir = Path::new("/Users/me/Library/Application Support/com.redlark.pindu-app");
        assert_eq!(
            with_suffix(dir, DEV_SUFFIX),
            Path::new("/Users/me/Library/Application Support/com.redlark.pindu-app-dev")
        );
    }
}
