//! AI 老师的 pi skills：写到数据目录（每次启动覆盖，随应用更新），返回目录供 `--skill` 加载

use crate::error::{AppError, AppResult};
use crate::prompts::TUTOR_SKILLS;
use std::path::{Path, PathBuf};

pub fn write(root: &Path) -> AppResult<Vec<PathBuf>> {
    let io = |e: std::io::Error| AppError::InternalError(format!("准备 AI 老师的技能失败：{}", e));
    let mut dirs = Vec::new();
    for (name, body) in TUTOR_SKILLS {
        let dir = root.join("skills").join(name);
        std::fs::create_dir_all(&dir).map_err(io)?;
        std::fs::write(dir.join("SKILL.md"), body).map_err(io)?;
        dirs.push(dir);
    }
    Ok(dirs)
}
