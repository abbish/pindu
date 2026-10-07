# PracticeService 迁移到 Repository 层指南

## 📋 概述

**文件**: [src-tauri/src/services/practice.rs](src-tauri/src/services/practice.rs)
**当前代码行数**: 746 行
**SQL 查询数量**: 25 个
**迁移难度**: ⭐⭐⭐⭐ (高)
**预计工作量**: 3 小时

---

## 🎯 迁移目标

### 迁移前
```rust
pub struct PracticeService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}
// 包含 25 个直接 SQL 查询
```

### 迁移后
```rust
pub struct PracticeService {
    practice_repo: PracticeRepository,
    schedule_repo: StudyScheduleRepository,
}
// 所有数据访问通过 Repository
```

---

## 📊 方法迁移清单

### 优先级分类

#### 🔴 高优先级 (核心功能) - 必须迁移

| 方法名 | SQL数量 | 复杂度 | 使用的Repository |
|--------|---------|--------|-----------------|
| `start_practice_session` | 6 | 高 | Practice + Schedule |
| `get_practice_session_by_id` | 2 | 中 | Practice |
| `pause_practice_session` | 2 | 中 | Practice |
| `resume_practice_session` | 3 | 高 | Practice |
| `complete_practice_session` | 3 | 高 | Practice |
| `get_incomplete_practice_sessions` | 1 | 低 | Practice |

**小计**: 6 个方法,17 个 SQL 查询

#### 🟡 中优先级 (辅助功能) - 建议迁移

| 方法名 | SQL数量 | 复杂度 | 使用的Repository |
|--------|---------|--------|-----------------|
| `submit_step_result` | 2 | 中 | Practice (需添加方法) |
| `get_plan_practice_sessions` | 2 | 低 | Practice |
| `get_practice_session_detail` | 4 | 中 | Practice |

**小计**: 3 个方法,8 个 SQL 查询

#### 🟢 低优先级 (调试功能) - 可选迁移

| 方法名 | SQL数量 | 复杂度 | 说明 |
|--------|---------|--------|------|
| `cancel_practice_session` | 3 | 中 | 调试功能 |
| `get_practice_statistics` | 1 | 低 | 可用StatisticsRepository |

**小计**: 2 个方法,4 个 SQL 查询

---

## 🔄 详细迁移步骤

### 步骤 1: 修改 Service 结构体

```rust
// 迁移前
pub struct PracticeService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

// 迁移后
pub struct PracticeService {
    practice_repo: PracticeRepository,
    schedule_repo: StudyScheduleRepository,
}
```

### 步骤 2: 修改构造函数

```rust
// 迁移前
impl PracticeService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }
}

// 迁移后
impl PracticeService {
    pub fn new(practice_repo: PracticeRepository, schedule_repo: StudyScheduleRepository) -> Self {
        Self {
            practice_repo,
            schedule_repo,
        }
    }

    // 向后兼容的构造函数
    pub fn from_pool_and_logger(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        let practice_repo = PracticeRepository::new(pool.clone(), logger.clone());
        let schedule_repo = StudyScheduleRepository::new(pool, logger);
        Self::new(practice_repo, schedule_repo)
    }
}
```

### 步骤 3: 迁移核心方法

#### 示例: start_practice_session

**迁移前** (包含 6 个 SQL 查询):
```rust
pub async fn start_practice_session(&self, plan_id: i64, schedule_id: i64)
    -> AppResult<PracticeSession>
{
    // SQL 查询 1: 验证日程
    let schedule_row = sqlx::query(
        "SELECT sp.id as plan_id, sp.name as plan_name, ...
         FROM study_plans sp
         JOIN study_plan_schedules sps ON sp.id = sps.plan_id
         WHERE sp.id = ? AND sps.id = ?",
    ).bind(plan_id).bind(schedule_id).fetch_optional(...).await?;

    // SQL 查询 2: 检查现有会话
    let existing_session = sqlx::query(
        "SELECT id FROM practice_sessions WHERE ..."
    ).bind(plan_id).bind(schedule_id).fetch_optional(...).await?;

    // SQL 查询 3: 获取日程单词
    let words = sqlx::query(
        "SELECT spsw.id as plan_word_id, ...
         FROM study_plan_schedule_words spsw
         JOIN words w ON spsw.word_id = w.id
         WHERE spsw.schedule_id = ?"
    ).bind(schedule_id).fetch_all(...).await?;

    // SQL 查询 4: 创建会话
    sqlx::query("INSERT INTO practice_sessions ...")
        .bind(&session_id).bind(plan_id)...
        .execute(...).await?;

    // SQL 查询 5 & 6: 批量创建单词状态 (循环中)
    for word in words {
        sqlx::query("INSERT INTO word_practice_states ...")
            .bind(...).execute(...).await?;
    }

    // 返回结果...
}
```

**迁移后** (使用 Repository):
```rust
pub async fn start_practice_session(&self, plan_id: i64, schedule_id: i64)
    -> AppResult<PracticeSession>
{
    // 1. 验证日程 (使用 Repository)
    let schedule = self.schedule_repo
        .find_by_id(schedule_id)
        .await?
        .ok_or_else(|| AppError::ValidationError("日程不存在".to_string()))?;

    // 2. 检查现有会话 (使用 Repository)
    let existing = self.practice_repo
        .find_incomplete_session(plan_id, schedule_id)
        .await?;

    if let Some(session_id) = existing {
        return self.get_practice_session_detail(&session_id).await;
    }

    // 3. 获取日程单词 (使用 Repository)
    let schedule_words = self.schedule_repo
        .find_schedule_words(schedule_id)
        .await?;

    if schedule_words.is_empty() {
        return Err(AppError::ValidationError("该日程没有安排单词练习".to_string()));
    }

    // 4. 创建会话 (使用 Repository)
    let session_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    self.practice_repo
        .create_session(&session_id, plan_id, schedule_id, &schedule.schedule_date, &now)
        .await?;

    // 5. 转换数据类型
    let word_states = self.convert_to_word_states(schedule_words)?;

    // 6. 批量创建单词状态 (使用 Repository)
    self.practice_repo
        .create_word_states_batch(&session_id, &word_states)
        .await?;

    // 7. 构建返回对象
    Ok(PracticeSession {
        session_id: session_id.clone(),
        plan_id,
        plan_title: schedule.plan_name,
        schedule_id,
        schedule_date: schedule.schedule_date,
        start_time: now,
        end_time: None,
        total_time: 0,
        active_time: 0,
        pause_count: 0,
        word_states,
        completed: false,
        created_at: now.clone(),
        updated_at: now,
    })
}
```

---

## 📝 需要的辅助方法

### 类型转换方法

```rust
impl PracticeService {
    /// 将 ScheduleWordInfo 转换为 WordPracticeState
    fn convert_to_word_states(
        &self,
        schedule_words: Vec<crate::repositories::study_schedule_repository::ScheduleWordInfo>,
    ) -> AppResult<Vec<WordPracticeState>> {
        let now = chrono::Utc::now().to_rfc3339();

        schedule_words.into_iter().map(|word_info| {
            Ok(WordPracticeState {
                word_id: word_info.word_id,
                plan_word_id: word_info.plan_word_id,
                word_info: crate::types::study::PracticeWordInfo {
                    word_id: word_info.word_id,
                    word: word_info.word,
                    meaning: word_info.meaning,
                    description: word_info.description,
                    ipa: word_info.ipa,
                    syllables: word_info.syllables,
                    phonics_segments: word_info.phonics_segments,
                },
                currentStep: crate::types::study::WordPracticeStep::Step1,
                stepResults: vec![false; 3],
                stepAttempts: vec![0; 3],
                stepTimeSpent: vec![0; 3],
                completed: false,
                passed: false,
                startTime: now.clone(),
                endTime: None,
            })
        }).collect()
    }
}
```

### 获取会话详情方法

```rust
impl PracticeService {
    /// 获取练习会话详情 (完整版,包含所有单词状态)
    pub async fn get_practice_session_detail(&self, session_id: &str)
        -> AppResult<PracticeSession>
    {
        // 1. 获取会话基本信息
        let session = self.practice_repo
            .find_session_by_id(session_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("会话 {} 不存在", session_id)))?;

        // 2. 获取单词状态
        let word_states = self.practice_repo
            .find_word_states_by_session(session_id)
            .await?;

        // 3. 转换为业务类型
        let practice_states = word_states.into_iter()
            .map(|ws| self.convert_to_practice_state(ws))
            .collect();

        // 4. 获取学习计划名称
        let plan_name = // TODO: 从 StudyPlanRepository 获取
            "计划名称".to_string();

        Ok(PracticeSession {
            session_id: session.session_id,
            plan_id: session.plan_id,
            plan_title: plan_name,
            schedule_id: session.schedule_id,
            schedule_date: session.schedule_date,
            start_time: session.start_time,
            end_time: session.end_time,
            total_time: session.total_time,
            active_time: session.active_time,
            pause_count: session.pause_count,
            word_states: practice_states,
            completed: session.completed,
            created_at: session.created_at,
            updated_at: session.updated_at,
        })
    }
}
```

---

## ⚠️ 注意事项

### 1. 类型匹配问题

Repository 返回的类型可能与 Service 需要的类型不同:

```rust
// Repository 返回
pub struct ScheduleWordInfo {
    pub plan_word_id: i64,
    pub word_id: i64,
    pub word: String,
    // ...
}

// Service 需要
pub struct PracticeWordInfo {
    pub word_id: i64,
    pub word: String,
    // ...
}

// 需要转换函数
fn convert_schedule_to_practice(info: ScheduleWordInfo) -> PracticeWordInfo {
    PracticeWordInfo {
        word_id: info.word_id,
        word: info.word,
        // ...
    }
}
```

### 2. JSON 序列化字段

Repository 中某些字段是 JSON 序列化的:

```rust
// Repository 层存储
step_results: Vec<bool> → 序列化为 JSON 字符串

// Service 层使用
// 需要反序列化
let step_results: Vec<bool> = serde_json::from_str(&json_string)?;
```

### 3. 枚举类型转换

```rust
// Repository 返回的枚举
pub enum ScheduleStatus {
    NotStarted,
    InProgress,
    Completed,
    Overdue,
}

// Service 需要的枚举
pub enum WordPracticeStep {
    Step1,
    Step2,
    Step3,
}

// 需要转换逻辑
fn convert_status(status: ScheduleStatus) -> WordPracticeStep {
    match status {
        ScheduleStatus::NotStarted => WordPracticeStep::Step1,
        ScheduleStatus::InProgress => WordPracticeStep::Step2,
        ScheduleStatus::Completed => WordPracticeStep::Step3,
        _ => WordPracticeStep::Step1,
    }
}
```

### 4. 事务处理

某些操作需要事务,Repository 层需要支持:

```rust
// Repository 层添加方法
impl PracticeRepository {
    pub async fn create_session_with_words(
        &self,
        tx: &mut sqlx::Transaction<SqlitePool>,
        session_id: &str,
        word_states: &[WordPracticeState],
    ) -> AppResult<()> {
        // 使用 tx 而不是 self.pool
        sqlx::query("INSERT INTO practice_sessions ...")
            .bind(session_id)
            .execute(&mut *tx)
            .await?;

        // 批量创建单词状态
        for state in word_states {
            sqlx::query("INSERT INTO word_practice_states ...")
                .bind(...)
                .execute(&mut *tx)
                .await?;
        }

        Ok(())
    }
}

// Service 层使用事务
impl PracticeService {
    pub async fn start_practice_session(&self, ...) -> AppResult<PracticeSession> {
        let mut tx = self.pool.begin().await?;

        self.practice_repo
            .create_session_with_words(&mut tx, &session_id, &word_states)
            .await?;

        tx.commit().await?;

        // ...
    }
}
```

---

## 📈 迁移进度追踪

### 阶段 1: 准备 (已完成 ✅)
- [x] Repository 层就绪
- [x] 迁移指南编写
- [x] 示例代码创建

### 阶段 2: 核心方法迁移
- [ ] start_practice_session
- [ ] get_practice_session_by_id
- [ ] pause_practice_session
- [ ] resume_practice_session
- [ ] complete_practice_session
- [ ] get_incomplete_practice_sessions

### 阶段 3: 辅助方法迁移
- [ ] submit_step_result
- [ ] get_plan_practice_sessions
- [ ] get_practice_session_detail

### 阶段 4: 测试验证
- [ ] 单元测试
- [ ] 集成测试
- [ ] 功能测试

---

## 🎯 迁移收益

### 代码质量

| 指标 | 迁移前 | 迁移后 | 改善 |
|------|--------|--------|------|
| SQL 查询数 | 25 | 0 | -100% ✅ |
| 数据访问 | 分散 | 集中 | ✅ |
| 可测试性 | 低 | 高 | ✅ |
| 代码行数 | 746 | ~600 | -20% |

### 可维护性

- ✅ 数据访问逻辑集中在 Repository
- ✅ Service 只关注业务逻辑
- ✅ 更易于单元测试
- ✅ 减少代码重复

---

## 📚 相关文档

- [SERVICE_REPOSITORY_MIGRATION_GUIDE.md](SERVICE_REPOSITORY_MIGRATION_GUIDE.md) - 通用迁移指南
- [SERVICE_REPOSITORY_STATUS.md](SERVICE_REPOSITORY_STATUS.md) - Service 层状态报告
- [src-tauri/src/repositories/practice_repository.rs](src-tauri/src/repositories/practice_repository.rs) - PracticeRepository API
- [src-tauri/src/repositories/study_schedule_repository.rs](src-tauri/src/repositories/study_schedule_repository.rs) - StudyScheduleRepository API

---

*指南创建时间: 2026-01-03*
*作者: Claude AI Assistant*
