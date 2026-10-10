//! 学习计划业务逻辑服务
//!
//! 封装学习计划相关的业务逻辑
//!
//! # 注意
//! 此模块当前独立实现,未来将集成到 handlers

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::plan_passage_repository::PlanPassageRepository;
use crate::repositories::study_plan_repository::{StatusChange, StudyPlanRepository};
use crate::services::calendar::{day_status, plan_can_be_overdue, DayScheduleState};
use crate::services::plan_passages;
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
    pub async fn get_study_plans_with_progress(
        &self,
        include_deleted: bool,
    ) -> AppResult<Vec<StudyPlanWithProgress>> {
        // 使用 Repository 层
        self.repository
            .find_all_with_progress(include_deleted)
            .await
    }

    /// 获取学习计划详情
    pub async fn get_study_plan(&self, id: Id) -> AppResult<StudyPlanWithProgress> {
        // 使用 Repository 层
        self.repository
            .find_by_id_with_progress(id)
            .await?
            .ok_or_else(|| AppError::NotFound("学习计划不存在，可能已被删除".to_string()))
    }

    /// 在一个事务里完成一次状态转换（校验 + 条件更新 + 状态历史）
    async fn transition(
        &self,
        plan_id: Id,
        allowed_from: &[&str],
        to: &str,
        change: StatusChange,
        action: &str,
        reason: &str,
    ) -> AppResult<()> {
        let mut tx = self.repository.begin_transaction().await?;
        self.repository
            .transition_conn(&mut tx, plan_id, allowed_from, to, change, action, reason)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    /// 开始学习计划（待开始 → 进行中）：日程平移到从今天开始
    pub async fn start_study_plan(&self, plan_id: Id) -> AppResult<()> {
        let mut tx = self.repository.begin_transaction().await?;
        self.repository
            .transition_conn(
                &mut tx,
                plan_id,
                &["Pending"],
                "Active",
                StatusChange {
                    set_actual_start: true,
                    ..Default::default()
                },
                "开始学习",
                "用户手动开始学习",
            )
            .await?;
        let today = crate::time::local_today();
        self.repository
            .start_now_conn(&mut tx, plan_id, today)
            .await?;
        plan_passages::reschedule_conn(&mut tx, plan_id, today).await?;
        tx.commit().await?;
        Ok(())
    }

    /// 暂停（进行中 → 已暂停）：暂停期间不能练习、不安排复习、不算逾期
    pub async fn pause_study_plan(&self, plan_id: Id) -> AppResult<()> {
        self.transition(
            plan_id,
            &["Active"],
            "Paused",
            StatusChange::default(),
            "暂停",
            "用户暂停学习",
        )
        .await
    }

    /// 继续（已暂停 → 进行中）：暂停了几天，还没练的日程和复习到期日就往后顺延几天
    pub async fn resume_study_plan(&self, plan_id: Id) -> AppResult<()> {
        let today = crate::time::local_today();
        let mut tx = self.repository.begin_transaction().await?;
        let paused_from = self.repository.paused_since_conn(&mut tx, plan_id).await?;
        self.repository
            .transition_conn(
                &mut tx,
                plan_id,
                &["Paused"],
                "Active",
                StatusChange::default(),
                "继续学习",
                "用户结束暂停，未练的日程与复习顺延",
            )
            .await?;
        if let Some(from) = paused_from {
            let days = (today - from).num_days();
            self.repository
                .postpone_after_pause_conn(&mut tx, plan_id, from, days)
                .await?;
        }
        // 没完成的短文从今天起重新排期
        plan_passages::reschedule_conn(&mut tx, plan_id, today).await?;
        tx.commit().await?;
        Ok(())
    }

    /// 完成学习计划
    pub async fn complete_study_plan(&self, plan_id: Id) -> AppResult<()> {
        self.transition(
            plan_id,
            &["Active", "Paused"],
            "Completed",
            StatusChange {
                set_actual_end: true,
                ..Default::default()
            },
            "完成",
            "用户手动完成学习",
        )
        .await
    }

    /// 终止学习计划
    pub async fn terminate_study_plan(&self, plan_id: Id) -> AppResult<()> {
        self.transition(
            plan_id,
            &["Active", "Paused"],
            "Terminated",
            StatusChange {
                set_actual_terminated: true,
                ..Default::default()
            },
            "终止",
            "用户手动终止学习",
        )
        .await
    }

    /// 删除学习计划（软删除，任何状态都可以删）
    pub async fn delete_study_plan(&self, plan_id: Id) -> AppResult<()> {
        // 物理删除，不可恢复（用户决定，2026-10-07）：子表经外键级联删除
        let mut tx = self.repository.begin_transaction().await?;
        if !self.repository.delete_plan_conn(&mut tx, plan_id).await? {
            return Err(AppError::NotFound(
                "学习计划不存在，可能已被删除".to_string(),
            ));
        }
        tx.commit().await?;
        self.logger.info(
            "StudyPlanService",
            &format!("已永久删除学习计划 {}", plan_id),
        );

        // 刷新词汇本的关联计划数量（存储列；在事务外执行，失败不影响删除结果）
        let wordbook_service =
            crate::services::wordbook::WordBookService::new(self.pool.clone(), self.logger.clone());
        if let Err(e) = wordbook_service.update_all_counts().await {
            self.logger.warn(
                "STUDY_PLAN_SERVICE",
                &format!("Failed to update wordbook linked_plans: {}", e),
                Some(&e.to_string()),
            );
        }
        Ok(())
    }

    /// 获取学习计划关联的词汇本 ID
    pub async fn get_plan_word_book_ids(&self, plan_id: Id) -> AppResult<Vec<Id>> {
        self.repository.find_word_book_ids(plan_id).await
    }

    /// 更新计划的名称与描述（任何未删除的计划都可以改，不影响进度）
    pub async fn update_basic_info(
        &self,
        plan_id: Id,
        name: &str,
        description: Option<&str>,
    ) -> AppResult<()> {
        let mut tx = self.repository.begin_transaction().await?;

        if self
            .repository
            .find_unified_status_conn(&mut tx, plan_id)
            .await?
            .is_none()
        {
            return Err(AppError::NotFound("学习计划不存在".to_string()));
        }

        self.repository
            .update_basic_info_conn(&mut tx, plan_id, name, description)
            .await?;

        tx.commit().await?;
        Ok(())
    }

    /// 重新学习（已完成 / 已终止 → 待开始）：清空练习数据，保留单词与日程安排，
    /// 日程整体平移到从今天开始（本地日期），AI 规划里的日期同步平移。
    pub async fn restart_study_plan(&self, plan_id: Id) -> AppResult<()> {
        let today_date = crate::time::local_today();
        let today = crate::time::format_date(today_date);
        let mut tx = self.repository.begin_transaction().await?;
        self.repository
            .transition_conn(
                &mut tx,
                plan_id,
                &["Completed", "Terminated"],
                "Pending",
                StatusChange {
                    clear_actual_dates: true,
                    ..Default::default()
                },
                "重新学习",
                "用户重新开始学习，清空练习记录，日程从今天重新开始",
            )
            .await?;
        self.repository
            .clear_practice_data_conn(&mut tx, plan_id)
            .await?;
        self.repository
            .shift_schedules_conn(&mut tx, plan_id, &today)
            .await?;
        self.repository
            .shift_ai_plan_dates_conn(&mut tx, plan_id, &today)
            .await?;
        plan_passages::reschedule_conn(&mut tx, plan_id, today_date).await?;
        // 短文都已从短文库删除：只练短文的计划没法再练；两者都练的退回只练单词
        if let Some(settings) = PlanPassageRepository::settings_conn(&mut tx, plan_id).await? {
            if settings.practice_content != "words"
                && PlanPassageRepository::items_conn(&mut tx, plan_id)
                    .await?
                    .is_empty()
            {
                if settings.practice_content == "passages" {
                    return Err(AppError::ValidationError(
                        "这个计划里的短文都已从短文库删除，没法重新学习；可以新建一个计划"
                            .to_string(),
                    ));
                }
                PlanPassageRepository::update_settings_conn(
                    &mut tx,
                    plan_id,
                    "words",
                    settings.interval_days,
                )
                .await?;
            }
        }
        tx.commit().await?;
        Ok(())
    }

    /// 发布学习计划；没有日程的计划不能发布。
    /// 从未练习过：草稿 → 待开始（第一次练习时开始）；
    /// 已练习过（进行中的计划编辑后重新发布）：草稿 → 进行中，保留实际开始时间，日程不平移。
    pub async fn publish_study_plan(&self, plan_id: Id) -> AppResult<()> {
        let mut tx = self.repository.begin_transaction().await?;
        let content = PlanPassageRepository::settings_conn(&mut tx, plan_id)
            .await?
            .map(|s| s.practice_content)
            .unwrap_or_else(|| "words".to_string());
        if content != "passages"
            && self
                .repository
                .count_schedules_conn(&mut tx, plan_id)
                .await?
                == 0
        {
            return Err(AppError::ValidationError(
                "这个计划还没有学习日程，请先在编辑里生成日程再发布".to_string(),
            ));
        }
        if content != "words"
            && PlanPassageRepository::items_conn(&mut tx, plan_id)
                .await?
                .is_empty()
        {
            return Err(AppError::ValidationError(
                "这个计划还没有短文，请先加短文再发布".to_string(),
            ));
        }
        let practiced = self.repository.has_practice_conn(&mut tx, plan_id).await?;
        self.repository
            .transition_conn(
                &mut tx,
                plan_id,
                &["Draft"],
                if practiced { "Active" } else { "Pending" },
                StatusChange {
                    legacy_status: Some("normal"),
                    clear_actual_dates: !practiced,
                    ..Default::default()
                },
                "发布",
                if practiced {
                    "用户发布学习计划（已有练习，继续进行）"
                } else {
                    "用户发布学习计划"
                },
            )
            .await?;
        plan_passages::reschedule_conn(&mut tx, plan_id, crate::time::local_today()).await?;
        tx.commit().await?;
        Ok(())
    }

    /// 获取学习计划的单词
    pub async fn get_plan_words(&self, plan_id: Id) -> AppResult<Vec<StudyPlanWord>> {
        self.repository.find_plan_words(plan_id).await
    }

    /// 获取学习计划的日程列表
    pub async fn get_plan_schedules(&self, plan_id: Id) -> AppResult<Vec<PlanScheduleSummary>> {
        // 先把今天到期的复习放进今天的日程（自适应复习），“该练哪个日程”才看得到
        let mut tx = crate::services::srs::begin_write(&self.pool).await?;
        crate::services::srs::sync_today(&mut tx, plan_id, crate::time::local_today()).await?;
        tx.commit().await?;
        self.repository.find_plan_schedules(plan_id).await
    }

    /// 获取关联到指定词汇本的学习计划
    pub async fn get_linked_plans_by_wordbook(
        &self,
        wordbook_id: Id,
    ) -> AppResult<Vec<StudyPlanWithProgress>> {
        self.repository
            .find_linked_plans_by_wordbook(wordbook_id)
            .await
    }

    /// 创建带 AI 规划的学习计划（批量操作）
    pub async fn create_study_plan_with_schedule(
        &self,
        request: CreateStudyPlanWithScheduleRequest,
    ) -> AppResult<Id> {
        use crate::repositories::study_schedule_repository::StudyScheduleRepository;
        use crate::types::study::StudyPlanAIResult;

        // 练习内容与短文
        let content = request
            .practice_content
            .clone()
            .unwrap_or_else(|| "words".to_string());
        let interval_days = request
            .passage_interval_days
            .unwrap_or(plan_passages::DEFAULT_INTERVAL_DAYS);
        if crate::time::parse_date(&request.start_date).is_none() {
            return Err(AppError::ValidationError("开始日期格式不正确".to_string()));
        }
        plan_passages::validate_settings(&content, interval_days)?;
        plan_passages::validate_inputs(&content, &request.passages)?;

        // 解析 AI 规划数据（只练短文的计划没有单词日程）
        let ai_result: StudyPlanAIResult = if content == "passages" {
            StudyPlanAIResult {
                plan_metadata: Default::default(),
                daily_plans: Vec::new(),
            }
        } else {
            serde_json::from_str(&request.ai_plan_data)
                .map_err(|e| AppError::ValidationError(format!("学习日程数据格式不正确：{}", e)))?
        };
        if content != "passages" && ai_result.daily_plans.is_empty() {
            return Err(AppError::ValidationError(
                "规划没有任何学习日，请重新生成规划".to_string(),
            ));
        }
        // 计划单词：日程里出现的全部单词（去重）；总词数按实际单词计，不信任规划元数据
        let word_ids: Vec<Id> = ai_result
            .daily_plans
            .iter()
            .flat_map(|d| &d.words)
            .filter_map(|w| w.word_id.parse::<i64>().ok())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();

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
        let status = if unified_status == "Draft" {
            "draft"
        } else {
            "normal"
        };

        // 创建学习计划
        let total_words = word_ids.len() as i32;
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
            ai_plan_data: (content != "passages").then_some(request.ai_plan_data),
            daily_new_words: None, // 由规划元数据写入（apply_plan_metadata_conn）
            deleted_at: None,
            total_schedules: None,
            completed_schedules: None,
            overdue_schedules: None,
            created_at: String::new(),
            updated_at: String::new(),
        };

        let plan_id = self
            .repository
            .create_in_transaction(&mut tx, &plan)
            .await?;
        if ai_result.plan_metadata.daily_new_words.is_some() {
            self.repository
                .apply_plan_metadata_conn(&mut tx, plan_id, &ai_result.plan_metadata)
                .await?;
        }

        // 创建学习计划日程
        let schedule_repo =
            StudyScheduleRepository::new(self.repository.get_pool(), self.logger.clone());

        let schedule_ids = schedule_repo
            .create_schedule_batch(&mut tx, plan_id, &ai_result.daily_plans)
            .await?;

        // 创建日程单词
        for (schedule_idx, daily_plan) in ai_result.daily_plans.iter().enumerate() {
            if schedule_idx < schedule_ids.len() {
                schedule_repo
                    .create_schedule_words_batch(
                        &mut tx,
                        schedule_ids[schedule_idx],
                        &daily_plan.words,
                    )
                    .await?;
            }
        }

        // 创建学习计划单词关联
        self.repository
            .create_plan_words_batch(&mut tx, plan_id, &word_ids)
            .await?;

        // 练习内容与短文任务（排期从开始日起）
        plan_passages::check_inputs_exist_conn(&mut tx, &request.passages).await?;
        plan_passages::init_conn(
            &mut tx,
            plan_id,
            &content,
            interval_days,
            &request.passages,
            crate::time::local_today(),
        )
        .await?;

        // 提交事务
        tx.commit().await.map_err(|e| {
            self.logger
                .database_operation("COMMIT", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(format!("保存失败：{}", e))
        })?;

        // 更新相关词汇本的关联计划数量（在事务外执行，失败不影响主流程）
        let wordbook_service =
            crate::services::wordbook::WordBookService::new(self.pool.clone(), self.logger.clone());
        if let Err(e) = wordbook_service.update_all_counts().await {
            // 计划本身已创建成功，计数下次刷新会补上：记为警告
            self.logger.warn(
                "STUDY_PLAN_SERVICE",
                &format!("Failed to update wordbook linked_plans: {}", e),
                Some(&e.to_string()),
            );
        }

        Ok(plan_id)
    }

    /// 批量从学习计划中移除单词（一个事务）：日程计数、掌握数与计划总词数同步更新
    pub async fn batch_remove_words_from_plan(
        &self,
        plan_id: Id,
        word_ids: &[Id],
    ) -> AppResult<usize> {
        use crate::repositories::study_schedule_repository::StudyScheduleRepository;

        let mut tx = self.repository.begin_transaction().await?;
        if self
            .repository
            .find_unified_status_conn(&mut tx, plan_id)
            .await?
            .is_none()
        {
            return Err(AppError::NotFound(
                "学习计划不存在，可能已被删除".to_string(),
            ));
        }
        let (removed, schedules) = self
            .repository
            .remove_words_conn(&mut tx, plan_id, word_ids)
            .await?;
        let schedule_repo =
            StudyScheduleRepository::new(self.repository.get_pool(), self.logger.clone());
        for schedule_id in schedules {
            schedule_repo
                .refresh_completion(&mut tx, schedule_id)
                .await?;
        }
        tx.commit().await?;
        Ok(removed)
    }

    /// 获取学习计划日历数据
    pub async fn get_plan_calendar_data(
        &self,
        plan_id: Id,
        year: i32,
        month: i32,
    ) -> AppResult<Vec<crate::types::study::CalendarDayData>> {
        use crate::repositories::study_schedule_repository::StudyScheduleRepository;

        // 验证学习计划是否存在；计划状态决定没练的过期日程算不算逾期
        let plan = self.get_study_plan(plan_id).await?;
        let can_be_overdue = plan_can_be_overdue(&plan.unified_status);

        // 计算月份的日期范围
        let start_date = chrono::NaiveDate::from_ymd_opt(year, month as u32, 1)
            .ok_or_else(|| AppError::ValidationError("日期格式不正确".to_string()))?;

        let _end_date = if month == 12 {
            chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
        } else {
            chrono::NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)
        }
        .ok_or_else(|| AppError::ValidationError("日期格式不正确".to_string()))?
        .pred_opt()
        .ok_or_else(|| AppError::ValidationError("日期格式不正确".to_string()))?;

        // 扩展到包含完整的日历视图（6周）
        // 网格从月初所在周的周一开始（与全局日历一致）
        use chrono::Datelike;
        let days_from_monday = start_date.weekday().num_days_from_monday() as i64;
        let calendar_start = start_date - chrono::Duration::days(days_from_monday);
        let calendar_end = calendar_start + chrono::Duration::days(41); // 6周 = 42天

        // 查询该学习计划在日期范围内的日程数据
        let schedule_repo =
            StudyScheduleRepository::new(self.repository.get_pool(), self.logger.clone());
        let schedules = schedule_repo
            .find_schedules_by_date_range(
                plan_id,
                &calendar_start.format("%Y-%m-%d").to_string(),
                &calendar_end.format("%Y-%m-%d").to_string(),
            )
            .await?;

        // 这个计划在范围内的短文任务
        let passages = PlanPassageRepository::new(self.pool.clone())
            .in_range(
                &calendar_start.format("%Y-%m-%d").to_string(),
                &calendar_end.format("%Y-%m-%d").to_string(),
                Some(plan_id),
            )
            .await?;

        // 创建日程数据映射
        let schedule_map: std::collections::HashMap<_, _> = schedules
            .into_iter()
            .map(|s| (s.schedule_date.clone(), s))
            .collect();

        // 生成完整的日历数据
        let mut calendar_data = Vec::new();
        let today = crate::time::local_today();
        let mut current_date = calendar_start;

        while current_date <= calendar_end {
            let date_str = current_date.format("%Y-%m-%d").to_string();
            let is_today = current_date == today;

            let schedule = schedule_map.get(&date_str).filter(|s| s.total_words > 0);
            let (total_words, new_words, review_words, completed_words) = schedule
                .map(|s| {
                    (
                        s.total_words,
                        s.new_words,
                        s.review_words,
                        s.completed_words,
                    )
                })
                .unwrap_or((0, 0, 0, 0));
            let day_passages: Vec<_> = passages
                .iter()
                .filter(|p| p.scheduled_date == date_str)
                .collect();
            let passage_tasks = day_passages.len() as i32;
            let passage_completed = day_passages.iter().filter(|p| p.completed).count() as i32;
            let is_in_plan = schedule.is_some() || passage_tasks > 0;

            // 与全局日历同一套日状态规则（练完即完成，进度是掌握率）；短文任务完成算练完
            let states: Vec<DayScheduleState> = schedule
                .map(|s| DayScheduleState {
                    practiced: s.practiced,
                    started: s.has_open_session || s.completed_words > 0,
                    can_be_overdue,
                })
                .into_iter()
                .chain(day_passages.iter().map(|p| DayScheduleState {
                    practiced: p.completed,
                    started: false,
                    can_be_overdue,
                }))
                .collect();
            let status = day_status(current_date, today, &states);

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
                passage_tasks,
                passage_completed,
                passages: Vec::new(),
            });

            current_date = current_date
                .succ_opt()
                .ok_or_else(|| AppError::InternalError("日期超出范围".to_string()))?;
        }

        Ok(calendar_data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, seed_schedule, test_logger, ScheduleFixture};
    use serde_json::json;

    async fn setup(
        word_count: usize,
        status: &str,
    ) -> (StudyPlanService, Arc<SqlitePool>, ScheduleFixture, Id) {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, word_count).await;
        let unified = if status == "draft" { "Draft" } else { "Active" };
        sqlx::query("UPDATE study_plans SET status = ?, unified_status = ? WHERE id = ?")
            .bind(status)
            .bind(unified)
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        let book_id: Id = sqlx::query_scalar("SELECT word_book_id FROM words WHERE id = ?")
            .bind(fx.word_ids[0])
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        (
            StudyPlanService::new(pool.clone(), test_logger()),
            pool,
            fx,
            book_id,
        )
    }

    #[tokio::test]
    async fn delete_study_plan_removes_plan_and_all_child_rows() {
        let (service, pool, fx, _) = setup(2, "normal").await;
        crate::test_support::seed_session(&pool, &fx, "s1", false).await;
        crate::test_support::seed_step(
            &pool,
            "s1",
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            1,
            true,
            "2026-10-06T10:00:00+00:00",
        )
        .await;

        let words_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM words")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        // 词汇本的关联计划数（存储列）先刷新到 1
        let book_id: Id = sqlx::query_scalar("SELECT word_book_id FROM words WHERE id = ?")
            .bind(fx.word_ids[0])
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
            .bind(fx.plan_id)
            .bind(fx.word_ids[0])
            .execute(pool.as_ref())
            .await
            .unwrap();
        crate::services::wordbook::WordBookService::new(pool.clone(), test_logger())
            .update_all_counts()
            .await
            .unwrap();
        let linked = || async {
            sqlx::query_scalar::<_, i64>("SELECT linked_plans FROM word_books WHERE id = ?")
                .bind(book_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap()
        };
        assert_eq!(linked().await, 1);

        service.delete_study_plan(fx.plan_id).await.unwrap();

        for table in [
            "study_plans",
            "study_plan_schedules",
            "study_plan_schedule_words",
            "practice_sessions",
            "word_practice_records",
        ] {
            let n: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {}", table))
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
            assert_eq!(n, 0, "{} 应被级联删除", table);
        }
        // 词汇本与单词不受影响
        let words: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM words")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(words, words_before);
        // 删除后词汇本的关联计划数归零
        assert_eq!(linked().await, 0);
        // 再删一次：不存在
        assert!(matches!(
            service.delete_study_plan(fx.plan_id).await,
            Err(AppError::NotFound(_))
        ));
    }

    async fn count(pool: &SqlitePool, sql: &str, plan_id: Id) -> i64 {
        sqlx::query_scalar(sql)
            .bind(plan_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// 前端 `StudyPlanStatistics` 按 snake_case 读取；改 serde 属性须同步 TS 类型
    #[test]
    fn plan_statistics_wire_shape_is_snake_case() {
        let stats = StudyPlanStatistics {
            average_daily_study_minutes: 1,
            time_progress_percentage: 0.0,
            actual_progress_percentage: 0.0,
            average_accuracy_rate: 0.0,
            overdue_ratio: 0.0,
            streak_days: 3,
            total_days: 0,
            completed_days: 0,
            overdue_days: 0,
            total_words: 0,
            completed_words: 0,
            learned_words: 0,
            total_study_minutes: 90,
        };
        let v = serde_json::to_value(&stats).unwrap();
        assert_eq!(v["streak_days"], 3);
        assert_eq!(v["total_study_minutes"], 90);
        assert!(v.get("streakDays").is_none());
    }

    #[tokio::test]
    async fn update_basic_info_changes_name_and_description_of_draft() {
        let (service, pool, fx, _) = setup(1, "draft").await;

        service
            .update_basic_info(fx.plan_id, "改名", Some("描述"))
            .await
            .unwrap();

        let (name, description): (String, Option<String>) =
            sqlx::query_as("SELECT name, description FROM study_plans WHERE id = ?")
                .bind(fx.plan_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(name, "改名");
        assert_eq!(description.as_deref(), Some("描述"));
    }

    #[tokio::test]
    async fn basic_info_can_change_in_any_state_and_reports_missing_plans() {
        let (service, pool, fx, _) = setup(1, "normal").await;

        // 名称与描述任何状态都可以改（不影响进度）；描述为空写空串而不是 NULL
        service
            .update_basic_info(fx.plan_id, "x", None)
            .await
            .unwrap();
        let description: Option<String> =
            sqlx::query_scalar("SELECT description FROM study_plans WHERE id = ?")
                .bind(fx.plan_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(description.as_deref(), Some(""));

        let err = service
            .update_basic_info(9999, "x", None)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("学习计划不存在"), "{err}");
    }

    #[tokio::test]
    async fn editing_errors_use_not_found_and_validation_codes() {
        let (service, _pool, _fx, _) = setup(1, "normal").await;
        assert!(matches!(
            service.update_basic_info(9999, "x", None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn plan_word_book_ids_are_distinct_and_sorted() {
        let (service, pool, fx, book_id) = setup(2, "draft").await;
        for word_id in &fx.word_ids {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
                .bind(fx.plan_id)
                .bind(word_id)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }

        assert_eq!(
            service.get_plan_word_book_ids(fx.plan_id).await.unwrap(),
            vec![book_id]
        );
    }

    #[tokio::test]
    async fn status_history_is_newest_first_with_id_as_tiebreaker() {
        let (service, pool, fx, _) = setup(1, "normal").await;
        for (from, to) in [("Draft", "Pending"), ("Pending", "Active")] {
            sqlx::query(
                "INSERT INTO study_plan_status_history (plan_id, from_status, to_status, created_at)
                 VALUES (?, ?, ?, '2026-10-06 10:00:00')",
            )
            .bind(fx.plan_id)
            .bind(from)
            .bind(to)
            .execute(pool.as_ref())
            .await
            .unwrap();
        }

        let history = service
            .repository
            .find_status_history(fx.plan_id)
            .await
            .unwrap();
        let to: Vec<&str> = history.iter().map(|h| h.to_status.as_str()).collect();
        assert_eq!(to, vec!["Active", "Pending"]);
        assert_eq!(history[0].changed_at, "2026-10-06 10:00:00");
    }

    async fn plan_status(pool: &SqlitePool, plan_id: Id) -> (String, String) {
        sqlx::query_as("SELECT status, unified_status FROM study_plans WHERE id = ?")
            .bind(plan_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn add_schedule(
        pool: &SqlitePool,
        plan_id: Id,
        day: i64,
        date: &str,
        words: &[Id],
        book: Id,
    ) -> Id {
        let id = sqlx::query(
            "INSERT INTO study_plan_schedules (plan_id, day_number, schedule_date, total_words_count, new_words_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(plan_id)
        .bind(day)
        .bind(date)
        .bind(words.len() as i64)
        .bind(words.len() as i64)
        .execute(pool)
        .await
        .unwrap()
        .last_insert_rowid();
        for w in words {
            sqlx::query("INSERT INTO study_plan_schedule_words (schedule_id, word_id, wordbook_id, created_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
                .bind(id)
                .bind(w)
                .bind(book)
                .execute(pool)
                .await
                .unwrap();
        }
        id
    }

    /// 编辑：转为真正的草稿（旧 status 列同步），不删除日程与练习；草稿可以替换日程，再发布回到待开始
    #[tokio::test]
    async fn republishing_a_practiced_draft_resumes_without_losing_data() {
        // 旧版“编辑 → 草稿”留下的、已有练习的草稿（界面已不再产生草稿）
        let (service, pool, fx, _) = setup(1, "normal").await;
        crate::test_support::seed_session(&pool, &fx, "s1", true).await;
        sqlx::query(
            "UPDATE study_plans SET status = 'draft', unified_status = 'Draft' WHERE id = ?",
        )
        .bind(fx.plan_id)
        .execute(pool.as_ref())
        .await
        .unwrap();

        assert_eq!(
            plan_status(&pool, fx.plan_id).await,
            ("draft".to_string(), "Draft".to_string())
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM study_plan_schedules WHERE plan_id = ?",
                fx.plan_id
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM practice_sessions WHERE plan_id = ?",
                fx.plan_id
            )
            .await,
            1
        );
        // 草稿可以改名、可以发布（有日程）
        service
            .update_basic_info(fx.plan_id, "新名字", None)
            .await
            .unwrap();
        service.publish_study_plan(fx.plan_id).await.unwrap();
        // 已有练习：重新发布直接回到进行中（不回到待开始，避免下次练习重新“开始”）
        assert_eq!(
            plan_status(&pool, fx.plan_id).await,
            ("normal".to_string(), "Active".to_string())
        );
        let history = service
            .repository
            .find_status_history(fx.plan_id)
            .await
            .unwrap();
        assert_eq!(history.len(), 1);
    }

    #[tokio::test]
    async fn starting_never_shifts_schedules_of_a_practiced_plan() {
        let (service, pool, fx, _) = setup(1, "normal").await;
        crate::test_support::seed_session(&pool, &fx, "s1", true).await;
        // 模拟旧路径留下的“有练习却是待开始”的计划
        sqlx::query("UPDATE study_plans SET unified_status = 'Pending' WHERE id = ?")
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        let before: String =
            sqlx::query_scalar("SELECT schedule_date FROM study_plan_schedules WHERE id = ?")
                .bind(fx.schedule_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();

        service.start_study_plan(fx.plan_id).await.unwrap();

        let after: String =
            sqlx::query_scalar("SELECT schedule_date FROM study_plan_schedules WHERE id = ?")
                .bind(fx.schedule_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(before, after, "练过的日程不能被平移");
        crate::time::assert_instants_canonical(&pool).await;
    }

    #[tokio::test]
    async fn transitions_validate_current_status_and_are_not_repeated() {
        let (service, pool, fx, _) = setup(1, "normal").await; // Active
        let err = service.start_study_plan(fx.plan_id).await.unwrap_err();
        assert!(err.to_string().contains("进行中"), "{err}");
        assert!(service.restart_study_plan(fx.plan_id).await.is_err());

        service.complete_study_plan(fx.plan_id).await.unwrap();
        // 重复点击：第二次被拒绝，不会再写一条历史
        assert!(service.complete_study_plan(fx.plan_id).await.is_err());
        assert_eq!(
            service
                .repository
                .find_status_history(fx.plan_id)
                .await
                .unwrap()
                .len(),
            1
        );

        // 删除是物理删除（2026-10-07 起），记录不再存在
        service.delete_study_plan(fx.plan_id).await.unwrap();
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM study_plans WHERE id = ?")
            .bind(fx.plan_id)
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(left, 0);
        assert!(matches!(
            service.delete_study_plan(fx.plan_id).await,
            Err(AppError::NotFound(_))
        ));
        crate::time::assert_instants_canonical(&pool).await;
    }

    #[tokio::test]
    async fn publishing_requires_schedules() {
        let (service, pool, fx, _) = setup(1, "draft").await;
        sqlx::query("DELETE FROM study_plan_schedules WHERE plan_id = ?")
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        let err = service.publish_study_plan(fx.plan_id).await.unwrap_err();
        assert!(err.to_string().contains("还没有学习日程"), "{err}");
    }

    /// 重新学习：清空练习，保留日程与单词，日程从今天重新排；AI 规划日期同步
    #[tokio::test]
    async fn restart_keeps_schedules_and_moves_them_to_today() {
        let (service, pool, fx, book) = setup(1, "normal").await;
        add_schedule(&pool, fx.plan_id, 2, "2026-10-07", &fx.word_ids, book).await;
        sqlx::query("UPDATE study_plans SET ai_plan_data = ? WHERE id = ?")
            .bind(
                json!({"planMetadata": {"startDate": "2026-10-06", "endDate": "2026-10-07"},
                         "dailyPlans": [{"day": 1, "date": "2026-10-06", "words": []},
                                        {"day": 2, "date": "2026-10-07", "words": []}]})
                .to_string(),
            )
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        crate::test_support::seed_session(&pool, &fx, "s1", true).await;
        sqlx::query("UPDATE study_plan_schedules SET status = 'completed', completed_words_count = 1 WHERE plan_id = ?")
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        service.complete_study_plan(fx.plan_id).await.unwrap();

        service.restart_study_plan(fx.plan_id).await.unwrap();

        let today = crate::time::local_today();
        let day2 = (today + chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();
        let today = today.format("%Y-%m-%d").to_string();
        let dates: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT schedule_date, status, completed_words_count FROM study_plan_schedules WHERE plan_id = ? ORDER BY day_number",
        )
        .bind(fx.plan_id)
        .fetch_all(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(
            dates,
            vec![
                (today.clone(), "not-started".to_string(), 0),
                (day2.clone(), "not-started".to_string(), 0)
            ]
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM practice_sessions WHERE plan_id = ?",
                fx.plan_id
            )
            .await,
            0
        );
        let plan = service.get_study_plan(fx.plan_id).await.unwrap();
        assert_eq!(plan.unified_status, "Pending");
        assert_eq!(plan.start_date.as_deref(), Some(today.as_str()));
        assert_eq!(plan.end_date.as_deref(), Some(day2.as_str()));
        let ai: serde_json::Value =
            serde_json::from_str(plan.ai_plan_data.as_deref().unwrap()).unwrap();
        assert_eq!(ai["dailyPlans"][1]["date"], day2);
        assert_eq!(ai["planMetadata"]["startDate"], today);
        crate::time::assert_instants_canonical(&pool).await;
    }

    /// 移除单词：日程计数与计划总词数同步，变空的日程删除
    #[tokio::test]
    async fn removing_words_recounts_schedules_and_drops_empty_ones() {
        let (service, pool, fx, book) = setup(2, "normal").await;
        let only_first =
            add_schedule(&pool, fx.plan_id, 2, "2026-10-07", &fx.word_ids[..1], book).await;
        for w in &fx.word_ids {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
                .bind(fx.plan_id)
                .bind(w)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }

        let removed = service
            .batch_remove_words_from_plan(fx.plan_id, &fx.word_ids[..1])
            .await
            .unwrap();

        assert_eq!(removed, 1);
        let (total, new): (i64, i64) = sqlx::query_as(
            "SELECT total_words_count, new_words_count FROM study_plan_schedules WHERE id = ?",
        )
        .bind(fx.schedule_id)
        .fetch_one(pool.as_ref())
        .await
        .unwrap();
        assert_eq!((total, new), (1, 1));
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM study_plan_schedules WHERE id = ?",
                only_first
            )
            .await,
            0
        );
        assert_eq!(
            count(
                &pool,
                "SELECT total_words FROM study_plans WHERE id = ?",
                fx.plan_id
            )
            .await,
            1
        );
    }

    /// 回归：关联计划查询缺少日程统计列，row.get 直接 panic
    #[tokio::test]
    async fn linked_plans_of_word_book_load_with_progress() {
        let (service, pool, fx, book) = setup(1, "normal").await;
        sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
            .bind(fx.plan_id)
            .bind(fx.word_ids[0])
            .execute(pool.as_ref())
            .await
            .unwrap();
        sqlx::query("UPDATE study_plan_schedules SET status = 'completed' WHERE id = ?")
            .bind(fx.schedule_id)
            .execute(pool.as_ref())
            .await
            .unwrap();

        let plans = service.get_linked_plans_by_wordbook(book).await.unwrap();

        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].progress_percentage, 100.0);
    }

    #[test]
    fn ai_plan_dates_shift_by_day_number() {
        let mut v = json!({"planMetadata": {"startDate": "x"},
                           "dailyPlans": [{"day": 1, "date": "a"}, {"day": 3, "date": "b"}]});
        assert!(
            crate::repositories::study_plan_repository::shift_ai_plan_dates(&mut v, "2026-10-30")
        );
        assert_eq!(v["dailyPlans"][1]["date"], "2026-11-01");
        assert_eq!(v["planMetadata"]["endDate"], "2026-11-01");
        assert!(
            !crate::repositories::study_plan_repository::shift_ai_plan_dates(
                &mut json!({}),
                "2026-10-30"
            )
        );
    }

    /// 计划详情：单词带记忆状态与学习日期，日程带当天的单词（新学 + 复习）
    #[tokio::test]
    async fn plan_words_carry_memory_state_and_schedules_carry_words() {
        let (service, pool, fx, _) = setup(2, "normal").await;
        for (i, (b, due, lapses)) in [(4, Some("2026-10-20"), 1), (0, None, 0)]
            .iter()
            .enumerate()
        {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id, srs_box, srs_due, srs_lapses) VALUES (?, ?, ?, ?, ?)")
                .bind(fx.plan_id)
                .bind(fx.word_ids[i])
                .bind(b)
                .bind(due)
                .bind(lapses)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }
        let words = service.get_plan_words(fx.plan_id).await.unwrap();
        let w0 = words.iter().find(|w| w.id == fx.word_ids[0]).unwrap();
        assert_eq!((w0.memory_box, w0.lapses), (4, 1));
        assert_eq!(w0.next_review_date.as_deref(), Some("2026-10-20"));
        assert_eq!(w0.learn_date.as_deref(), Some("2026-10-06"));
        let v = serde_json::to_value(w0).unwrap();
        assert_eq!(v["memory_box"], 4);

        sqlx::query("UPDATE study_plans SET unified_status = 'Completed' WHERE id = ?")
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap(); // 不触发今日复习同步，只看日程本身
        let schedules = service.get_plan_schedules(fx.plan_id).await.unwrap();
        let words = &schedules[0].words;
        assert_eq!(words.len(), 2);
        assert!(!words[0].is_review);
        assert!(!words[0].word.is_empty());
    }

    /// 开始学习：日程平移到从今天开始（提前或推迟开始都以实际开始日为第 1 天）
    #[tokio::test]
    async fn starting_a_plan_moves_its_schedule_to_today() {
        let (service, pool, fx, _) = setup(1, "normal").await;
        sqlx::query("UPDATE study_plans SET unified_status = 'Pending', start_date = '2026-10-06' WHERE id = ?")
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();

        service.start_study_plan(fx.plan_id).await.unwrap();

        let today = crate::time::format_date(crate::time::local_today());
        let (date,): (String,) =
            sqlx::query_as("SELECT schedule_date FROM study_plan_schedules WHERE id = ?")
                .bind(fx.schedule_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(date, today);
        let plan = service.get_study_plan(fx.plan_id).await.unwrap();
        assert_eq!(plan.unified_status, "Active");
        assert_eq!(plan.start_date.as_deref(), Some(today.as_str()));
    }

    /// 暂停：不能练习；继续：暂停了几天，未练日程与复习到期日就顺延几天
    #[tokio::test]
    async fn pause_blocks_practice_and_resume_postpones_unpracticed_days() {
        use crate::services::practice::PracticeService;
        let (service, pool, fx, book) = setup(1, "normal").await; // Active
        let today = crate::time::local_today();
        let fmt = crate::time::format_date;
        let future = add_schedule(
            &pool,
            fx.plan_id,
            2,
            &fmt(today + chrono::Duration::days(1)),
            &fx.word_ids,
            book,
        )
        .await;
        sqlx::query(
            "INSERT INTO study_plan_words (plan_id, word_id, srs_box, srs_due) VALUES (?, ?, 1, ?)",
        )
        .bind(fx.plan_id)
        .bind(fx.word_ids[0])
        .bind(fmt(today + chrono::Duration::days(1)))
        .execute(pool.as_ref())
        .await
        .unwrap();

        // 第 1 天的日程在暂停之前（5 天前），继续时不应移动
        sqlx::query("UPDATE study_plan_schedules SET schedule_date = ? WHERE id = ?")
            .bind(fmt(today - chrono::Duration::days(5)))
            .bind(fx.schedule_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        service.pause_study_plan(fx.plan_id).await.unwrap();
        let practice = PracticeService::from_pool_and_logger(pool.clone(), test_logger());
        let err = practice
            .start_practice_session(fx.plan_id, future)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("暂停"), "{err}");
        // 假装 3 天前开始暂停
        sqlx::query("UPDATE study_plan_status_history SET created_at = ? WHERE plan_id = ? AND to_status = 'Paused'")
            .bind(format!("{}T08:00:00.000Z", fmt(today - chrono::Duration::days(3))))
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        sqlx::query("UPDATE study_plan_schedules SET schedule_date = ? WHERE id = ?")
            .bind(fmt(today - chrono::Duration::days(2)))
            .bind(future)
            .execute(pool.as_ref())
            .await
            .unwrap();
        sqlx::query("UPDATE study_plan_words SET srs_due = ? WHERE plan_id = ?")
            .bind(fmt(today - chrono::Duration::days(2)))
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();

        service.resume_study_plan(fx.plan_id).await.unwrap();

        let (date,): (String,) =
            sqlx::query_as("SELECT schedule_date FROM study_plan_schedules WHERE id = ?")
                .bind(future)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(date, fmt(today + chrono::Duration::days(1)));
        let (due,): (String,) =
            sqlx::query_as("SELECT srs_due FROM study_plan_words WHERE plan_id = ?")
                .bind(fx.plan_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(due, fmt(today + chrono::Duration::days(1)));
        // 暂停之前的第 1 天日程不动
        let (first,): (String,) =
            sqlx::query_as("SELECT schedule_date FROM study_plan_schedules WHERE id = ?")
                .bind(fx.schedule_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(first, fmt(today - chrono::Duration::days(5)));
        assert_eq!(
            service
                .get_study_plan(fx.plan_id)
                .await
                .unwrap()
                .unified_status,
            "Active"
        );
        assert!(service.resume_study_plan(fx.plan_id).await.is_err());
        crate::time::assert_instants_canonical(&pool).await;
    }

    /// 删除单词：从用到它的计划里一起移除，日程计数与计划总词数同步
    #[tokio::test]
    async fn deleting_a_word_removes_it_from_plans_and_recounts() {
        use crate::services::word::WordService;
        let (_service, pool, fx, book) = setup(2, "normal").await;
        let only_first =
            add_schedule(&pool, fx.plan_id, 2, "2026-10-07", &fx.word_ids[..1], book).await;
        for w in &fx.word_ids {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
                .bind(fx.plan_id)
                .bind(w)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }
        let words = WordService::new(pool.clone(), test_logger());
        words.delete_words(&[fx.word_ids[0]]).await.unwrap();

        assert_eq!(
            count(
                &pool,
                "SELECT total_words_count FROM study_plan_schedules WHERE id = ?",
                fx.schedule_id
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM study_plan_schedules WHERE id = ?",
                only_first
            )
            .await,
            0
        );
        assert_eq!(
            count(
                &pool,
                "SELECT total_words FROM study_plans WHERE id = ?",
                fx.plan_id
            )
            .await,
            1
        );
    }

    #[tokio::test]
    async fn deleting_words_in_batch_is_one_transaction_across_plans() {
        use crate::services::word::WordService;
        let (_service, pool, fx, book) = setup(3, "normal").await;
        add_schedule(&pool, fx.plan_id, 2, "2026-10-07", &fx.word_ids[..1], book).await;
        for w in &fx.word_ids {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
                .bind(fx.plan_id)
                .bind(w)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }
        let words = WordService::new(pool.clone(), test_logger());

        assert!(words.delete_words(&[]).await.is_err());
        // 重复与不存在的 ID 被忽略
        let deleted = words
            .delete_words(&[fx.word_ids[0], fx.word_ids[1], fx.word_ids[0], 999_999])
            .await
            .unwrap();
        assert_eq!(deleted, 2);

        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM words WHERE word_book_id = ?",
                book
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT total_words_count FROM study_plan_schedules WHERE id = ?",
                fx.schedule_id
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT total_words FROM study_plans WHERE id = ?",
                fx.plan_id
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM study_plan_schedules WHERE plan_id = ?",
                fx.plan_id
            )
            .await,
            1,
            "只含被删单词的日程整体删除"
        );
    }
}
