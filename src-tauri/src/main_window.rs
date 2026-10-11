//! 主窗口第一次显示时的大小与位置：默认 1600×1000（tauri.conf.json），屏幕放不下时缩到可用区域的 90%，
//! 然后在可用区域里居中。位置按算好的大小自己算（不用 `center()`：macOS 上改大小不是立刻生效，
//! `center()` 拿到的还是旧大小，窗口会偏左、跑到屏幕外）。

use tauri::{LogicalPosition, LogicalSize, WebviewWindow};

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

/// 在可用区域（左上角 x, y，宽高 width, height）里居中放一个 w × h 的窗口 → 左上角坐标
fn centered(area: (f64, f64, f64, f64), (w, h): (f64, f64)) -> (f64, f64) {
    let (x, y, width, height) = area;
    (
        (x + (width - w) / 2.0).max(x).floor(),
        (y + (height - h) / 2.0).max(y).floor(),
    )
}

/// 窗口放好后的（大小, 左上角位置），逻辑像素
pub type Placement = ((f64, f64), (f64, f64));

/// 按所在屏幕调整大小并居中；取不到屏幕信息时保持配置里的大小。返回放好的位置供日志
pub fn fit_to_screen(window: &WebviewWindow) -> tauri::Result<Option<Placement>> {
    let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) else {
        return Ok(None);
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let size = work.size.to_logical::<f64>(scale);
    let origin = work.position.to_logical::<f64>(scale);
    let ((w, h), (min_w, min_h)) = fit((size.width, size.height));
    let (x, y) = centered((origin.x, origin.y, size.width, size.height), (w, h));
    window.set_min_size(Some(LogicalSize::new(min_w, min_h)))?;
    window.set_size(LogicalSize::new(w, h))?;
    window.set_position(LogicalPosition::new(x, y))?;
    Ok(Some(((w, h), (x, y))))
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
    fn window_is_centered_in_work_area_and_never_starts_off_screen() {
        // 14 英寸笔记本：菜单栏下方 33 起，可用 1512×949
        assert_eq!(
            centered((0.0, 33.0, 1512.0, 949.0), (1360.0, 854.0)),
            (76.0, 80.0)
        );
        // 副屏在主屏左边（x 为负）
        assert_eq!(
            centered((-1920.0, 0.0, 1920.0, 1080.0), (1600.0, 1000.0)),
            (-1760.0, 40.0)
        );
        // 放不下时贴左上角，不跑到区域外
        assert_eq!(
            centered((0.0, 33.0, 1280.0, 690.0), (1300.0, 700.0)),
            (0.0, 33.0)
        );
    }

    #[test]
    fn small_screen_lowers_minimum_too() {
        assert_eq!(fit((1280.0, 690.0)), ((1200.0, 690.0), (1200.0, 690.0)));
    }
}
