//! 学习计划业务逻辑服务
//!
//! 封装学习计划相关的业务逻辑
//!
//! # 注意
//! 此模块当前独立实现,未来将集成到 handlers



use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::study_plan_repository::StudyPlanRepository;
use crate::types::common::Id;
use crate::types::study::*;
use sqlx::SqlitePool;
use std::sync::Arc;

/// 学习计划服务
///
/// 负责学习计划的业务逻辑处理
pub struct StudyPlanService {
    repository: StudyPlanRepository,
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl StudyPlanService {
    /// 创建新的服务实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: StudyPlanRepository::new(pool.clone(), logger.clone()),
            pool,
            logger,
        }
    }

    /// 获取学习计划列表（带进度）
    pub async fn get_study_plans_with_progress(&self, include_deleted: bool) -> AppResult<Vec<StudyPlanWithProgress>> {
        // 使用 Repository 层
        self.repository.find_all_with_progress(include_deleted).await
    }

    /// 获取学习计划详情
    pub async fn get_study_plan(&self, id: Id) -> AppResult<StudyPlanWithProgress> {
        // 使用 Repository 层
        self.repository
            .find_by_id_with_progress(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("学习计划 {} 不存在", id)))
    }

    /// 开始学习计划
    pub async fn start_study_plan(&self, plan_id: Id) -> AppResult<()> {
        // 检查状态
        let (_, current_unified_status) = self
            .repository
            .find_status(plan_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("学习计划 {} 不存在", plan_id)))?;

        // 验证状态转换
        if current_unified_status != "Pending" {
            let error_msg = match current_unified_status.as_str() {
                "Draft" => "学习计划还未完成配置，请先完成配置",
                "Active" => "学习计划已经在进行中",
                "Paused" => "学习计划已暂停，请使用恢复功能",
                "Completed" => "学习计划已完成",
                "Terminated" => "学习计划已终止",
                "Deleted" => "学习计划已删除",
                _ => "学习计划状态不允许开始学习",
            };
            return Err(AppError::ValidationError(error_msg.to_string()));
        }

        // 更新状态
        self.repository
            .update_status(plan_id, "Active", true, false, false)
            .await?;

        // 记录状态变更历史
        self.repository
            .add_status_history(plan_id, &current_unified_status, "Active", "用户手动开始学习")
            .await?;

        Ok(())
    }

    /// 完成学习计划
    pub async fn complete_study_plan(&self, plan_id: Id) -> AppResult<()> {
        // 检查状态
        let (current_status, current_unified_status) = self
            .repository
            .find_status(plan_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("学习计划 {} 不存在", plan_id)))?;

        // 验证状态转换
        if current_status != "normal" {
            return Err(AppError::ValidationError(
                "只有正常状态的学习计划才能完成".to_string(),
            ));
        }

        if current_unified_status != "Active" {
            return Err(AppError::ValidationError(
                "只有进行中的学习计划才能完成".to_string(),
            ));
        }

        // 更新状态
        self.repository
            .update_status(plan_id, "Completed", false, true, false)
            .await?;

        // 记录状态变更历史
        self.repository
            .add_status_history(plan_id, &current_unified_status, "Completed", "用户手动完成学习")
            .await?;

        Ok(())
    }

    /// 终止学习计划
    pub async fn terminate_study_plan(&self, plan_id: Id) -> AppResult<()> {
        // 检查状态
        let (_, current_unified_status) = self
            .repository
            .find_status(plan_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("学习计划 {} 不存在", plan_id)))?;

        // 验证状态转换
        if current_unified_status != "Active" && current_unified_status != "Paused" {
            return Err(AppError::ValidationError(
                "只有Active或Paused状态的学习计划才能终止".to_string(),
            ));
        }

        // 更新状态
        self.repository
            .update_status(plan_id, "Terminated", false, false, true)
            .await?;

        // 记录状态变更历史
        self.repository
            .add_status_history(plan_id, &current_unified_status, "Terminated", "用户手动终止学习")
            .await?;

        Ok(())
    }

    /// 删除学习计划（软删除）
    pub async fn delete_study_plan(&self, plan_id: Id) -> AppResult<()> {
        // 获取当前状态
        let (_, current_unified_status) = self
            .repository
            .find_status(plan_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("学习计划 {} 不存在", plan_id)))?;

        // 删除
        self.repository.delete(plan_id).await?;

        // 记录状态变更历史
        self.repository
            .add_status_history(plan_id, &current_unified_status, "Deleted", "用户删除学习计划")
            .await?;

        Ok(())
    }

    /// 获取状态变更历史
    pub async fn get_status_history(&self, plan_id: Id) -> AppResult<Vec<StudyPlanStatusHistory>> {
        self.repository.find_status_history(plan_id).await
    }

    /// 重新开始学习计划
    pub async fn restart_study_plan(&self, plan_id: Id) -> AppResult<()> {
        // 检查状态
        let (current_status, current_unified_status) = self
            .repository
            .find_status(plan_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("学习计划 {} 不存在", plan_id)))?;

        // 验证状态转换
        if current_status != "normal" {
            return Err(AppError::ValidationError(
                "只有正常状态的学习计划才能重新学习".to_string(),
            ));
        }

        if current_unified_status != "Completed" && current_unified_status != "Terminated" {
            return Err(AppError::ValidationError(
                "只有已完成或已终止的学习计划才能重新学习".to_string(),
            ));
        }

        // 重置状态和数据
        self.repository
            .update_status_and_clear_dates(plan_id, "Pending")
            .await?;

        // 清空所有相关数据
        self.repository.reset_plan_data(plan_id).await?;

        // 记录状态变更历史
        self.repository
            .add_status_history(plan_id, &current_unified_status, "Pending", "用户重新开始学习，清空历史进度")
            .await?;

        Ok(())
    }

    /// 编辑学习计划（转为草稿状态）
    pub async fn edit_study_plan(&self, plan_id: Id) -> AppResult<()> {
        // 检查状态
        let (current_status, current_unified_status) = self
            .repository
            .find_status(plan_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("学习计划 {} 不存在", plan_id)))?;

        // 验证状态转换
        if current_status != "normal" {
            return Err(AppError::ValidationError(
                "只有正常状态的学习计划才能编辑".to_string(),
            ));
        }

        // 更新状态并清空实际日期
        self.repository
            .update_status_and_clear_dates(plan_id, "Draft")
            .await?;

        // 重置学习进度（保留单词关联）
        self.repository.reset_plan_progress(plan_id).await?;

        // 记录状态变更历史
        self.repository
            .add_status_history(plan_id, &current_unified_status, "Draft", "用户编辑学习计划，重置学习进度")
            .await?;

        Ok(())
    }

    /// 发布学习计划（从草稿转为待开始）
    pub async fn publish_study_plan(&self, plan_id: Id) -> AppResult<()> {
        // 检查状态
        let (_, current_unified_status) = self
            .repository
            .find_status(plan_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("学习计划 {} 不存在", plan_id)))?;

        // 验证状态转换
        if current_unified_status != "Draft" {
            return Err(AppError::ValidationError(
                "只有草稿状态的学习计划才能发布".to_string(),
            ));
        }

        // 更新状态
        self.repository.update_status_for_publish(plan_id).await?;

        // 记录状态变更历史
        self.repository
            .add_status_history(plan_id, &current_unified_status, "Pending", "用户发布学习计划")
            .await?;

        Ok(())
    }

    /// 部分更新学习计划
    pub async fn partial_update(
        &self,
        plan_id: Id,
        updates: &serde_json::Value,
    ) -> AppResult<()> {
        let name = updates.get("name").and_then(|v| v.as_str());
        let description = updates.get("description").and_then(|v| v.as_str());
        let status = updates.get("status").and_then(|v| v.as_str());
        let intensity_level = updates.get("intensity_level").and_then(|v| v.as_str());
        let review_frequency = updates.get("review_frequency").and_then(|v| v.as_i64()).map(|v| v as i32);

        // 计算 unified_status
        let unified_status = if let Some(status) = status {
            Some(match status {
                "draft" => "Draft",
                "normal" => "Pending",
                _ => "Draft",
            })
        } else {
            None
        };

        self.repository
            .partial_update(plan_id, name, description, status, unified_status.as_deref(), intensity_level, review_frequency)
            .await
    }

    /// 获取学习计划的单词
    pub async fn get_plan_words(&self, plan_id: Id) -> AppResult<Vec<StudyPlanWord>> {
        self.repository.find_plan_words(plan_id).await
    }

    /// 获取学习计划的日程列表
    pub async fn get_plan_schedules(&self, plan_id: Id) -> AppResult<Vec<serde_json::Value>> {
        self.repository.find_plan_schedules(plan_id).await
    }

    /// 获取关联到指定单词本的学习计划
    pub async fn get_linked_plans_by_wordbook(&self, wordbook_id: Id) -> AppResult<Vec<StudyPlanWithProgress>> {
        self.repository.find_linked_plans_by_wordbook(wordbook_id).await
    }

    /// 创建学习计划
    pub async fn create_study_plan(
        &self,
        name: String,
        description: String,
        word_ids: Vec<Id>,
        mastery_level: Option<i32>,
    ) -> AppResult<Id> {
        use crate::repositories::word_repository::WordRepository;

        // 验证输入
        if name.trim().is_empty() {
            return Err(AppError::ValidationError("学习计划名称不能为空".to_string()));
        }

        if word_ids.is_empty() {
            return Err(AppError::ValidationError("学习计划必须包含至少一个单词".to_string()));
        }

        // 验证单词是否存在
        let word_repo = WordRepository::new(
            self.pool.clone(),
            self.logger.clone(),
        );
        let valid_word_count = word_repo.validate_word_ids(&word_ids).await?;

        if valid_word_count != word_ids.len() {
            return Err(AppError::ValidationError(format!(
                "部分单词不存在。期望: {}，找到: {}",
                word_ids.len(),
                valid_word_count
            )));
        }

        // 创建学习计划
        let total_words = word_ids.len() as i32;
        let mastery_level = mastery_level.unwrap_or(1);

        let plan = StudyPlan {
            id: 0,
            name,
            description,
            status: "draft".to_string(),
            unified_status: Some(UnifiedStudyPlanStatus::Draft),
            total_words,
            mastery_level,
            intensity_level: None,
            study_period_days: None,
            review_frequency: None,
            start_date: None,
            end_date: None,
            actual_start_date: None,
            actual_end_date: None,
            actual_terminated_date: None,
            ai_plan_data: None,
            deleted_at: None,
            total_schedules: None,
            completed_schedules: None,
            overdue_schedules: None,
            created_at: String::new(),
            updated_at: String::new(),
        };

        let plan_id = self.repository.create(&plan).await?;

        // 创建学习计划单词关联
        self.repository.create_plan_words(plan_id, &word_ids).await?;

        Ok(plan_id)
    }

    /// 创建带 AI 规划的学习计划（批量操作）
    pub async fn create_study_plan_with_schedule(
        &self,
        request: CreateStudyPlanWithScheduleRequest,
    ) -> AppResult<Id> {
        use crate::repositories::study_schedule_repository::StudyScheduleRepository;
        use crate::types::study::{DailyStudyPlan, StudyPlanAIResult};

        // 解析 AI 规划数据
        let ai_result: StudyPlanAIResult = serde_json::from_str(&request.ai_plan_data)
            .map_err(|e| AppError::ValidationError(format!("Invalid AI plan data: {}", e)))?;

        // 开始数据库事务
        let mut tx = self.repository.begin_transaction().await?;

        // 确定状态
        let request_status_param = request.status.as_deref().unwrap_or("draft");
        let unified_status = match request_status_param {
            "draft" => "Draft",
            "active" => "Pending",
            "normal" => "Pending",
            _ => "Draft",
        };
        let status = if unified_status == "Draft" { "draft" } else { "normal" };

        // 创建学习计划
        let total_words = ai_result.plan_metadata.total_words;
        let plan = StudyPlan {
            id: 0,
            name: request.name,
            description: request.description,
            status: status.to_string(),
            unified_status: Some(match unified_status {
                "Draft" => UnifiedStudyPlanStatus::Draft,
                "Pending" => UnifiedStudyPlanStatus::Pending,
                _ => UnifiedStudyPlanStatus::Draft,
            }),
            total_words,
            mastery_level: 1,
            intensity_level: Some(request.intensity_level),
            study_period_days: Some(request.study_period_days),
            review_frequency: Some(request.review_frequency),
            start_date: Some(request.start_date),
            end_date: Some(request.end_date),
            actual_start_date: None,
            actual_end_date: None,
            actual_terminated_date: None,
            ai_plan_data: Some(request.ai_plan_data),
            deleted_at: None,
            total_schedules: None,
            completed_schedules: None,
            overdue_schedules: None,
            created_at: String::new(),
            updated_at: String::new(),
        };

        let plan_id = self.repository.create_in_transaction(&mut tx, &plan).await?;

        // 创建学习计划日程
        let schedule_repo = StudyScheduleRepository::new(
            self.repository.get_pool(),
            self.logger.clone(),
        );

        let schedule_ids = schedule_repo
            .create_schedule_batch(&mut tx, plan_id, &ai_result.daily_plans)
            .await?;

        // 创建日程单词
        for (schedule_idx, daily_plan) in ai_result.daily_plans.iter().enumerate() {
            if schedule_idx < schedule_ids.len() {
                schedule_repo
                    .create_schedule_words_batch(&mut tx, schedule_ids[schedule_idx], &daily_plan.words)
                    .await?;
            }
        }

        // 创建学习计划单词关联
        let mut all_word_ids = std::collections::HashSet::new();
        for daily_plan in &ai_result.daily_plans {
            for word in &daily_plan.words {
                if let Ok(word_id) = word.word_id.parse::<i64>() {
                    all_word_ids.insert(word_id);
                }
            }
        }

        let word_ids: Vec<Id> = all_word_ids.into_iter().collect();
        self.repository
            .create_plan_words_batch(&mut tx, plan_id, &word_ids)
            .await?;

        // 提交事务
        tx.commit().await.map_err(|e| {
            self.logger.database_operation("COMMIT", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(format!("Failed to commit transaction: {}", e))
        })?;

        // 更新相关单词本的关联计划数量（在事务外执行，失败不影响主流程）
        let wordbook_service = crate::services::wordbook::WordBookService::new(
            self.pool.clone(),
            self.logger.clone(),
        );
        if let Err(e) = wordbook_service.update_all_counts().await {
            self.logger.error(
                "STUDY_PLAN_SERVICE",
                &format!("Failed to update wordbook linked_plans: {}", e),
                Some(&e.to_string()),
            );
        }

        Ok(plan_id)
    }

    /// 从学习计划中移除单词
    pub async fn remove_word_from_plan(&self, plan_id: Id, word_id: Id) -> AppResult<()> {
        use crate::repositories::study_schedule_repository::StudyScheduleRepository;

        // 删除学习计划单词关联
        self.repository.remove_word_from_plan(plan_id, word_id).await?;

        // 删除该单词在学习计划中的所有日程安排
        let schedule_repo = StudyScheduleRepository::new(
            self.repository.get_pool(),
            self.logger.clone(),
        );
        schedule_repo
            .delete_schedule_words_by_word_and_plan(word_id, plan_id)
            .await?;

        Ok(())
    }

    /// 批量从学习计划中移除单词
    pub async fn batch_remove_words_from_plan(
        &self,
        plan_id: Id,
        word_ids: &[Id],
    ) -> AppResult<usize> {
        use crate::repositories::study_schedule_repository::StudyScheduleRepository;

        // 批量删除学习计划单词关联
        let deleted_count = self
            .repository
            .batch_remove_words_from_plan(plan_id, word_ids)
            .await?;

        // 删除这些单词在学习计划中的所有日程安排
        let schedule_repo = StudyScheduleRepository::new(
            self.repository.get_pool(),
            self.logger.clone(),
        );
        for word_id in word_ids {
            schedule_repo
                .delete_schedule_words_by_word_and_plan(*word_id, plan_id)
                .await?;
        }

        Ok(deleted_count)
    }

    /// 获取学习计划日历数据
    pub async fn get_plan_calendar_data(
        &self,
        plan_id: Id,
        year: i32,
        month: i32,
    ) -> AppResult<Vec<crate::types::study::CalendarDayData>> {
        use crate::repositories::study_schedule_repository::StudyScheduleRepository;

        // 验证学习计划是否存在
        let _plan = self.get_study_plan(plan_id).await?;

        // 计算月份的日期范围
        let start_date = chrono::NaiveDate::from_ymd_opt(year, month as u32, 1)
            .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?;

        let _end_date = if month == 12 {
            chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
        } else {
            chrono::NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)
        }
        .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
        .pred_opt()
        .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?;

        // 扩展到包含完整的日历视图（6周）
        // 计算从周日开始的天数
        use chrono::Datelike;
        let days_from_sunday = start_date.weekday().num_days_from_sunday() as i64;
        let calendar_start = start_date - chrono::Duration::days(days_from_sunday);
        let calendar_end = calendar_start + chrono::Duration::days(41); // 6周 = 42天

        // 查询该学习计划在日期范围内的日程数据
        let schedule_repo = StudyScheduleRepository::new(
            self.repository.get_pool(),
            self.logger.clone(),
        );
        let schedules = schedule_repo
            .find_schedules_by_date_range(
                plan_id,
                &calendar_start.format("%Y-%m-%d").to_string(),
                &calendar_end.format("%Y-%m-%d").to_string(),
            )
            .await?;

        // 创建日程数据映射
        let mut schedule_map = std::collections::HashMap::new();
        for (date, total_words, new_words, review_words, completed_words) in schedules {
            schedule_map.insert(
                date,
                (total_words, new_words, review_words, completed_words),
            );
        }

        // 生成完整的日历数据
        let mut calendar_data = Vec::new();
        let today = chrono::Local::now().date_naive();
        let mut current_date = calendar_start;

        while current_date <= calendar_end {
            let date_str = current_date.format("%Y-%m-%d").to_string();
            let is_today = current_date == today;

            let (total_words, new_words, review_words, completed_words) =
                schedule_map.get(&date_str).copied().unwrap_or((0, 0, 0, 0));

            let is_in_plan = total_words > 0;

            let status = if !is_in_plan {
                "not-started"
            } else if completed_words >= total_words {
                "completed"
            } else if completed_words > 0 {
                "in-progress"
            } else if current_date < today {
                "overdue"
            } else {
                "not-started"
            };

            let progress_percentage = if total_words > 0 {
                (completed_words as f64 / total_words as f64 * 100.0).round() as i32
            } else {
                0
            };

            calendar_data.push(crate::types::study::CalendarDayData {
                date: date_str,
                is_today,
                is_in_plan,
                status: status.to_string(),
                new_words_count: new_words,
                review_words_count: review_words,
                total_words_count: total_words,
                completed_words_count: completed_words,
                progress_percentage: progress_percentage as f64,
                study_plans: None,
                study_time_minutes: None,
                study_sessions: None,
            });

            current_date = current_date
                .succ_opt()
                .ok_or_else(|| AppError::InternalError("Date overflow".to_string()))?;
        }

        Ok(calendar_data)
    }
}
