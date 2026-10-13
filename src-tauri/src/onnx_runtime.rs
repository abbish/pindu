//! ONNX Runtime 的加载（发音评估、语音输入共用）：库不链接进程序，运行时加载随应用分发的微软官方库
//! （scripts/onnxruntime/ 准备，macOS 在 Contents/Frameworks，Windows 在资源目录）。
//! 加载不了（缺文件、系统版本太低）时这两项功能不可用，其余功能不受影响。

use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::sync::OnceLock;

/// 库文件名
#[cfg(target_os = "macos")]
const LIB_NAME: &str = "libonnxruntime.dylib";
#[cfg(target_os = "windows")]
const LIB_NAME: &str = "onnxruntime.dll";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const LIB_NAME: &str = "libonnxruntime.so";

/// 启动时找到的库位置
static LIBRARY: OnceLock<PathBuf> = OnceLock::new();
/// 加载结果（只加载一次）
static LOADED: OnceLock<Result<(), String>> = OnceLock::new();

/// 可能的位置：环境变量 `PINDU_ONNXRUNTIME` → 安装包里（macOS 的 Frameworks、Windows 的资源目录）→ 开发时的准备目录
fn candidates(resource_dir: Option<PathBuf>) -> Vec<PathBuf> {
    let mut list = Vec::new();
    if let Some(p) = std::env::var_os("PINDU_ONNXRUNTIME") {
        list.push(PathBuf::from(p));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            list.push(dir.join("..").join("Frameworks").join(LIB_NAME));
            list.push(dir.join(LIB_NAME));
        }
    }
    if let Some(dir) = resource_dir {
        list.push(dir.join(LIB_NAME));
    }
    list.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("onnxruntime")
            .join(LIB_NAME),
    );
    list
}

/// 启动时调用：记下库的位置（还不加载，第一次用模型时才加载）
pub fn locate(resource_dir: Option<PathBuf>) {
    if let Some(path) = candidates(resource_dir).into_iter().find(|p| p.is_file()) {
        let _ = LIBRARY.set(path);
    }
}

fn load() -> Result<(), String> {
    let path = match LIBRARY.get() {
        Some(p) => p.clone(),
        // 没调用过 locate（测试）：按默认位置找
        None => candidates(None)
            .into_iter()
            .find(|p| p.is_file())
            .ok_or_else(|| format!("没有找到 {LIB_NAME}"))?,
    };
    ort::init_from(&path)
        .map_err(|e| format!("{}：{e}", path.display()))?
        .commit();
    Ok(())
}

/// 能不能用（第一次调用时加载）
pub fn available() -> bool {
    ensure().is_ok()
}

/// 用模型前调用：加载 ONNX Runtime；加载不了时给出用户能懂的原因
pub fn ensure() -> AppResult<()> {
    match LOADED.get_or_init(|| {
        let result = load();
        if let Err(e) = &result {
            tracing::warn!("加载 ONNX Runtime 失败：{e}");
        }
        result
    }) {
        Ok(()) => Ok(()),
        Err(_) => Err(AppError::ExternalServiceError(
            "这台电脑上用不了发音评估和语音输入（缺少运行组件，或系统版本太低）".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    /// 准备过随应用分发的库（npm run onnxruntime:prepare）时：能加载（CI 的 Linux 上没有这个库，跳过）
    #[test]
    fn loads_the_prepared_runtime() {
        if super::candidates(None).iter().any(|p| p.is_file()) {
            super::ensure().expect("加载随应用分发的 ONNX Runtime");
            assert!(super::available());
        }
    }
}
