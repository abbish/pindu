//! 练习会话业务逻辑服务
//!
//! 封装练习会话相关的业务逻辑,使用 Repository 模式
//!
//! # 架构
//! - PracticeService 使用 PracticeRepository 和 StudyScheduleRepository
//! - 所有数据访问通过 Repository 层
//! - Service 层只包含业务逻辑



use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::{
    practice_repository::PracticeRepository,
    study_plan_repository::StudyPlanRepository,
    study_schedule_repository::StudyScheduleRepository,
};
use crate::types::study::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use uuid::Uuid;

/// 练习会话服务
///
/// 负责练习会话的业务逻辑处理
pub struct PracticeService {
    practice_repo: PracticeRepository,
    schedule_repo: StudyScheduleRepository,
    plan_repo: StudyPlanRepository,
}

impl PracticeService {
    /// 创建新的服务实例 (使用 Repository)
    pub fn new(
        practice_repo: PracticeRepository,
        schedule_repo: StudyScheduleRepository,
        plan_repo: StudyPlanRepository,
    ) -> Self {
        Self {
            practice_repo,
            schedule_repo,
            plan_repo,
        }
    }

    /// 从 pool 和 logger 创建 (向后兼容)
    pub fn from_pool_and_logger(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        let practice_repo = PracticeRepository::new(pool.clone(), logger.clone());
        let schedule_repo = StudyScheduleRepository::new(pool.clone(), logger.clone());
        let plan_repo = StudyPlanRepository::new(pool, logger);
        Self::new(practice_repo, schedule_repo, plan_repo)
    }

    /// 开始练习会话
    pub async fn start_practice_session(
        &self,
        plan_id: i64,
        schedule_id: i64,
    ) -> AppResult<PracticeSession> {
        // 1. 验证日程是否存在
        let schedule = self.schedule_repo
            .find_by_id(schedule_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("指定的学习日程不存在".to_string()))?;

        // 验证日程所属的计划
        if schedule.plan_id != plan_id {
            return Err(AppError::ValidationError("日程不属于指定的学习计划".to_string()));
        }

        // 2. 检查是否已有未完成的练习会话
        if let Some(existing_session) = self.practice_repo
            .find_incomplete_session(plan_id, schedule_id)
            .await?
        {
            // 如果已有未完成的练习会话，返回该会话
            return self.get_practice_session_by_id(&existing_session.session_id).await;
        }

        // 3. 获取日程单词
        let schedule_words = self.schedule_repo
            .find_schedule_words(schedule_id)
            .await?;

        if schedule_words.is_empty() {
            return Err(AppError::ValidationError(
                "该日程没有安排单词练习".to_string(),
            ));
        }

        // 4. 创建练习会话
        let session_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        self.practice_repo
            .create_session(&session_id, plan_id, schedule_id, &schedule.schedule_date, &now)
            .await?;

        // 5. 转换并创建单词状态
        let word_states = self.convert_schedule_words_to_states(schedule_words, &now)?;

        self.practice_repo
            .create_word_states_batch(&session_id, &word_states)
            .await?;

        // 6. 获取计划名称
        let plan_title = self.plan_repo
            .get_plan_name(plan_id)
            .await?
            .unwrap_or_else(|| format!("计划 {}", plan_id));

        // 7. 构建返回对象
        let session = PracticeSession {
            session_id: session_id.clone(),
            plan_id,
            plan_title: Some(plan_title),
            schedule_id,
            schedule_date: schedule.schedule_date,
            start_time: now.clone(),
            end_time: None,
            total_time: 0,
            active_time: 0,
            pause_count: 0,
            word_states,
            completed: false,
            created_at: now.clone(),
            updated_at: now,
        };

        Ok(session)
    }

    /// 获取计划名称 (辅助方法)

    /// 将 ScheduleWordInfo 转换为 WordPracticeState
    fn convert_schedule_words_to_states(
        &self,
        schedule_words: Vec<crate::repositories::study_schedule_repository::ScheduleWordInfo>,
        now: &str,
    ) -> AppResult<Vec<WordPracticeState>> {
        schedule_words.into_iter().map(|word_info| {
            Ok(WordPracticeState {
                word_id: word_info.word_id,
                plan_word_id: word_info.plan_word_id,
                word_info: PracticeWordInfo {
                    word_id: word_info.word_id,
                    word: word_info.word,
                    meaning: word_info.meaning,
                    description: word_info.description,
                    ipa: word_info.ipa,
                    syllables: word_info.syllables,
                    phonics_segments: word_info.phonics_segments,
                },
                current_step: WordPracticeStep::Step1,
                step_results: vec![false; 3],
                step_attempts: vec![0; 3],
                step_time_spent: vec![0; 3],
                completed: false,
                passed: false,
                start_time: now.to_string(),
                end_time: None,
            })
        }).collect()
    }

    /// 提交步骤结果
    pub async fn submit_step_result(
        &self,
        session_id: &str,
        word_id: i64,
        plan_word_id: i64,
        step: i32,
        user_input: String,
        is_correct: bool,
        time_spent: i64,
        attempts: i32,
    ) -> AppResult<()> {
        // 1. 验证步骤范围
        if step < 1 || step > 3 {
            return Err(AppError::ValidationError("步骤必须在1-3之间".to_string()));
        }

        // 2. 验证会话是否存在且未完成
        let session = self.practice_repo
            .find_session_by_id(session_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("练习会话不存在或已完成".to_string()))?;

        if session.completed {
            return Err(AppError::ValidationError("练习会话已完成".to_string()));
        }

        // 3. 创建练习记录
        self.practice_repo
            .create_practice_record(
                session_id,
                word_id,
                plan_word_id,
                step,
                &user_input,
                is_correct,
                time_spent,
                attempts,
            )
            .await?;

        Ok(())
    }

    /// 暂停练习会话
    pub async fn pause_practice_session(&self, session_id: &str) -> AppResult<()> {
        // 1. 验证会话是否存在且未完成
        let session = self.practice_repo
            .find_session_by_id(session_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("练习会话不存在或已完成".to_string()))?;

        if session.completed {
            return Err(AppError::ValidationError("练习会话已完成".to_string()));
        }

        // 2. 创建暂停记录
        let now = chrono::Utc::now().to_rfc3339();
        self.practice_repo
            .create_pause_record(session_id, &now)
            .await?;

        // 3. 更新会话暂停计数
        let mut updated_session = session;
        updated_session.pause_count += 1;
        updated_session.updated_at = now.clone();

        self.practice_repo
            .update_session(&updated_session)
            .await?;

        Ok(())
    }

    /// 恢复练习会话
    pub async fn resume_practice_session(&self, session_id: &str) -> AppResult<()> {
        // 1. 验证会话是否存在且未完成
        let session = self.practice_repo
            .find_session_by_id(session_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("练习会话不存在或已完成".to_string()))?;

        if session.completed {
            return Err(AppError::ValidationError("练习会话已完成".to_string()));
        }

        // 2. 更新暂停记录的恢复时间
        let now = chrono::Utc::now().to_rfc3339();
        self.practice_repo
            .update_pause_record(session_id, &now)
            .await?;

        Ok(())
    }

    /// 完成练习会话
    pub async fn complete_practice_session(
        &self,
        session_id: &str,
        total_time: i64,
        active_time: i64,
    ) -> AppResult<PracticeResult> {
        // 1. 验证会话是否存在且未完成
        let session = self.practice_repo
            .find_session_by_id(session_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("练习会话不存在或已完成".to_string()))?;

        if session.completed {
            return Err(AppError::ValidationError("练习会话已完成".to_string()));
        }

        let plan_id = session.plan_id;
        let schedule_id = session.schedule_id;
        let schedule_date = session.schedule_date.clone();
        let start_time = session.start_time.clone();
        let now = chrono::Utc::now().to_rfc3339();

        // 2. 更新会话状态为已完成
        let mut completed_session = session;
        completed_session.completed = true;
        completed_session.end_time = Some(now.clone());
        completed_session.total_time = total_time;
        completed_session.active_time = active_time;
        completed_session.updated_at = now.clone();

        self.practice_repo
            .update_session(&completed_session)
            .await?;

        // 3. 获取单词练习状态
        let word_states = self.practice_repo
            .find_word_states_by_session(session_id)
            .await?;

        // 4. 计算统计结果
        let result = self.calculate_practice_result(
            session_id.to_string(),
            plan_id,
            schedule_id,
            schedule_date,
            start_time,
            now.clone(),
            total_time,
            active_time,
            word_states,
        )?;

        // 5. 更新学习计划日程的完成单词数
        self.update_schedule_progress(schedule_id, &result).await?;

        Ok(result)
    }

    /// 获取练习会话详情
    pub async fn get_practice_session_by_id(&self, session_id: &str) -> AppResult<PracticeSession> {
        let (mut session, plan_title) = self.practice_repo
            .find_session_with_plan_name(session_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("练习会话 {} 不存在", session_id)))?;

        // 设置计划名称
        session.plan_title = plan_title;

        Ok(session)
    }


    /// 获取未完成的练习会话
    pub async fn get_incomplete_practice_sessions(&self) -> AppResult<Vec<PracticeSession>> {
        // 使用 Repository 获取所有未完成的练习会话
        let sessions = self.practice_repo
            .find_all_incomplete_sessions()
            .await?;

        Ok(sessions)
    }

    /// 获取练习会话详情
    pub async fn get_practice_session_detail(&self, session_id: &str) -> AppResult<PracticeSession> {
        self.get_practice_session_by_id(session_id).await
    }

    /// 取消练习会话
    pub async fn cancel_practice_session(&self, session_id: &str) -> AppResult<()> {
        // 验证会话是否存在且未完成
        let session = self.practice_repo
            .find_session_by_id(session_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("练习会话不存在或已完成".to_string()))?;

        if session.completed {
            return Err(AppError::ValidationError("练习会话已完成".to_string()));
        }

        // 使用 Repository 删除会话
        self.practice_repo
            .delete_session(session_id)
            .await?;

        Ok(())
    }

    /// 获取学习计划的所有练习会话
    pub async fn get_plan_practice_sessions(&self, plan_id: i64) -> AppResult<Vec<PracticeSession>> {
        // 使用 Repository 获取计划的所有练习会话
        let sessions = self.practice_repo
            .find_sessions_by_plan(plan_id)
            .await?;

        Ok(sessions)
    }

    /// 获取练习统计
    pub async fn get_practice_statistics(&self, plan_id: i64) -> AppResult<PracticeStatistics> {
        // 使用 Repository 获取统计信息
        let stats = self.practice_repo
            .get_practice_statistics(plan_id)
            .await?;

        Ok(stats)
    }

    // ==================== 辅助方法 ====================

    /// 获取单词练习状态 (保留用于向后兼容)
    /// 计算练习结果
    fn calculate_practice_result(
        &self,
        session_id: String,
        plan_id: i64,
        schedule_id: i64,
        schedule_date: String,
        _start_time: String,
        completed_at: String,
        total_time: i64,
        active_time: i64,
        word_states: Vec<WordPracticeState>,
    ) -> AppResult<PracticeResult> {
        let total_words = word_states.len();
        let passed_words = word_states.iter().filter(|w| w.passed).count();
        let total_steps = total_words * 3;
        let correct_steps = word_states
            .iter()
            .map(|w| w.step_results.iter().filter(|&&r| r).count())
            .sum::<usize>();

        let step_accuracy = if total_steps > 0 {
            (correct_steps as f64 / total_steps as f64) * 100.0
        } else {
            0.0
        };

        let word_accuracy = if total_words > 0 {
            (passed_words as f64 / total_words as f64) * 100.0
        } else {
            0.0
        };

        let average_time_per_word = if total_words > 0 {
            total_time / total_words as i64
        } else {
            0
        };

        let difficult_words: Vec<WordPracticeState> = word_states
            .iter()
            .filter(|w| !w.passed)
            .cloned()
            .collect();

        let passed_words_list: Vec<WordPracticeState> = word_states
            .iter()
            .filter(|w| w.passed)
            .cloned()
            .collect();

        Ok(PracticeResult {
            session_id,
            plan_id,
            schedule_id,
            schedule_date,
            total_words: total_words as i32,
            passed_words: passed_words as i32,
            total_steps: total_steps as i32,
            correct_steps: correct_steps as i32,
            step_accuracy,
            word_accuracy,
            total_time,
            active_time,
            pause_count: 0, // TODO: 从 session 获取
            average_time_per_word,
            difficult_words,
            passed_words_list,
            completed_at,
        })
    }

    /// 更新日程进度
    async fn update_schedule_progress(&self, _schedule_id: i64, _result: &PracticeResult) -> AppResult<()> {
        // TODO: 实现日程进度更新逻辑
        // 这个需要使用 StudyScheduleRepository
        Ok(())
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
