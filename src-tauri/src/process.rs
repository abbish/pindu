//! 子进程（AI sidecar、ffmpeg / ffprobe）的唯一创建入口。
//!
//! Windows 上图形应用启动控制台程序时，系统默认给它开一个命令行窗口：常驻的 AI 老师对话会一直留着这个窗口，
//! 学习者关掉它进程就被结束、对话中断；短任务则一闪而过。这里统一加上 `CREATE_NO_WINDOW`，
//! 新增子进程一律经 [`command`] 创建，不直接 `Command::new`。

use std::ffi::OsStr;
use tokio::process::Command;

/// Windows `CREATE_NO_WINDOW`：子进程不创建控制台窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 创建子进程命令（Windows 上不弹命令行窗口）
pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
