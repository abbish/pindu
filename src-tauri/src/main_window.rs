//! 主窗口第一次显示时的大小与位置：默认 1600×1000（tauri.conf.json），屏幕放不下时缩到可用区域的 90%，然后居中。
//! 不处理时，窗口比屏幕大，系统没法居中，会有一部分跑到屏幕外。

use tauri::{LogicalSize, WebviewWindow};

const DEFAULT: (f64, f64) = (1600.0, 1000.0);
const MIN: (f64, f64) = (1200.0, 800.0);
/// 放不下时占可用区域的比例
const FILL: f64 = 0.9;

/// 屏幕可用区域（逻辑像素）→ (窗口大小, 最小大小)
fn fit(area: (f64, f64)) -> ((f64, f64), (f64, f64)) {
    let one = |default: f64, min: f64, avail: f64| {
        let min = min.min(avail).floor();
        let size = default.min(avail * FILL).max(min).floor();
        (size, min)
    };
    let (w, min_w) = one(DEFAULT.0, MIN.0, area.0);
    let (h, min_h) = one(DEFAULT.1, MIN.1, area.1);
    ((w, h), (min_w, min_h))
}

/// 按所在屏幕调整大小并居中；取不到屏幕信息时保持配置里的大小
pub fn fit_to_screen(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) else {
        return Ok(());
    };
    let area = monitor
        .work_area()
        .size
        .to_logical::<f64>(monitor.scale_factor());
    let ((w, h), (min_w, min_h)) = fit((area.width, area.height));
    window.set_min_size(Some(LogicalSize::new(min_w, min_h)))?;
    window.set_size(LogicalSize::new(w, h))?;
    window.center()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_screen_keeps_default_size() {
        assert_eq!(fit((2560.0, 1415.0)), ((1600.0, 1000.0), (1200.0, 800.0)));
    }

    #[test]
    fn laptop_screen_shrinks_to_fit() {
        // 14 英寸 MacBook Pro 默认缩放：1512×982，去掉菜单栏
        assert_eq!(fit((1512.0, 949.0)), ((1360.0, 854.0), (1200.0, 800.0)));
    }

    #[test]
    fn small_screen_lowers_minimum_too() {
        assert_eq!(fit((1280.0, 690.0)), ((1200.0, 690.0), (1200.0, 690.0)));
    }
}
