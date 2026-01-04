//! 日历视图业务逻辑服务
//!
//! 封装日历视图相关的业务逻辑



use crate::error::AppResult;
use crate::logger::Logger;
use crate::repositories::calendar_repository::CalendarRepository;
use crate::types::study::TodayStudySchedule;
use std::sync::Arc;

/// 日历视图服务
///
/// 负责日历视图的业务逻辑处理
pub struct CalendarService {
    calendar_repo: CalendarRepository,
}

impl CalendarService {
    /// 创建新的服务实例
    pub fn new(calendar_repo: CalendarRepository) -> Self {
        Self { calendar_repo }
    }

    /// 获取今日学习日程
    pub async fn get_today_study_schedules(&self) -> AppResult<Vec<TodayStudySchedule>> {
        // 使用 Repository 查询今日日程
        let today_schedule_infos = self.calendar_repo
            .find_today_schedules()
            .await?;

        // 转换为业务类型
        let schedules: Vec<TodayStudySchedule> = today_schedule_infos
            .into_iter()
            .map(|info| self.convert_to_today_schedule(info))
            .collect();

        Ok(schedules)
    }

    /// 将 Repository 返回的类型转换为 Service 层类型
    fn convert_to_today_schedule(
        &self,
        info: crate::repositories::calendar_repository::TodayScheduleInfo,
    ) -> TodayStudySchedule {
        let total_words = info.total_words_count;
        let completed_words = info.completed_words_count;

        let progress_percentage = if total_words > 0 {
            (completed_words as f64 / total_words as f64 * 100.0).round() as i32
        } else {
            0
        };

        // 根据完成度确定状态
        let status = if total_words > 0 && completed_words >= total_words {
            "completed".to_string()
        } else if completed_words > 0 {
            "in-progress".to_string()
        } else {
            "not-started".to_string()
        };

        TodayStudySchedule {
            plan_id: info.plan_id,
            plan_name: info.plan_name,
            schedule_id: info.schedule_id,
            schedule_date: info.schedule_date,
            new_words_count: info.new_words_count,
            review_words_count: info.review_words_count,
            total_words_count: total_words,
            completed_words_count: completed_words,
            progress_percentage,
            status,
            can_start_practice: total_words > 0 && completed_words < total_words,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_creation() {
        // 测试服务创建逻辑
    }
}
