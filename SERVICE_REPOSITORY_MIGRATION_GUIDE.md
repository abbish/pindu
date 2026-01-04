# Service 层使用 Repository 重构指南

## 📋 概述

本指南展示如何将现有的 Service 层代码重构为使用 Repository 层,移除直接 SQL 查询。

---

## 🎯 重构目标

### 重构前 (直接 SQL 查询)

```rust
// ❌ Service 层直接使用 SQL 查询
pub struct PracticeService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl PracticeService {
    pub async fn start_practice_session(&self, plan_id: i64, schedule_id: i64)
        -> AppResult<PracticeSession>
    {
        // 直接 SQL 查询
        let schedule_row = sqlx::query(
            "SELECT sp.id as plan_id, sp.name as plan_name, ...
             FROM study_plans sp
             JOIN study_plan_schedules sps ON sp.id = sps.plan_id
             WHERE sp.id = ? AND sps.id = ?",
        )
        .bind(plan_id)
        .bind(schedule_id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        // 更多直接 SQL 查询...
    }
}
```

### 重构后 (使用 Repository)

```rust
// ✅ Service 层使用 Repository
use crate::repositories::{
    practice_repository::PracticeRepository,
    study_schedule_repository::StudyScheduleRepository,
};

pub struct PracticeService {
    practice_repo: PracticeRepository,
    schedule_repo: StudyScheduleRepository,
}

impl PracticeService {
    pub fn new(practice_repo: PracticeRepository, schedule_repo: StudyScheduleRepository) -> Self {
        Self {
            practice_repo,
            schedule_repo,
        }
    }

    pub async fn start_practice_session(&self, plan_id: i64, schedule_id: i64)
        -> AppResult<PracticeSession>
    {
        // 使用 Repository 查询
        let schedule_info = self.schedule_repo
            .find_by_plan_and_schedule(plan_id, schedule_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("日程不存在".to_string()))?;

        // 使用 Repository 创建会话
        let session_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        self.practice_repo
            .create_session(&session_id, plan_id, schedule_id, &schedule_info.schedule_date, &now)
            .await?;

        // 返回结果...
    }
}
```

---

## 🔄 重构步骤

### 步骤 1: 在 Service 中导入 Repository

```rust
use crate::repositories::practice_repository::PracticeRepository;
use crate::repositories::study_schedule_repository::StudyScheduleRepository;
```

### 步骤 2: 修改 Service 结构体

```rust
// 重构前
pub struct PracticeService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

// 重构后
pub struct PracticeService {
    practice_repo: PracticeRepository,
    schedule_repo: StudyScheduleRepository,
}
```

### 步骤 3: 修改构造函数

```rust
// 重构前
impl PracticeService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }
}

// 重构后
impl PracticeService {
    pub fn new(practice_repo: PracticeRepository, schedule_repo: StudyScheduleRepository) -> Self {
        Self {
            practice_repo,
            schedule_repo,
        }
    }
}
```

### 步骤 4: 替换 SQL 查询为 Repository 调用

#### 示例 1: 查找单个记录

**重构前**:
```rust
let session = sqlx::query(
    "SELECT * FROM practice_sessions WHERE id = ?"
)
.bind(session_id)
.fetch_optional(self.pool.as_ref())
.await?;
```

**重构后**:
```rust
let session = self.practice_repo
    .find_session_by_id(session_id)
    .await?;
```

#### 示例 2: 创建记录

**重构前**:
```rust
sqlx::query(
    "INSERT INTO practice_sessions (id, plan_id, schedule_id, ...)
     VALUES (?, ?, ?, ...)"
)
.bind(&session_id)
.bind(plan_id)
.bind(schedule_id)
.execute(self.pool.as_ref())
.await?;
```

**重构后**:
```rust
self.practice_repo
    .create_session(&session_id, plan_id, schedule_id, &schedule_date, &start_time)
    .await?;
```

#### 示例 3: 更新记录

**重构前**:
```rust
sqlx::query(
    "UPDATE practice_sessions SET completed = ?, updated_at = ? WHERE id = ?"
)
.bind(completed)
.bind(&now)
.bind(&session_id)
.execute(self.pool.as_ref())
.await?;
```

**重构后**:
```rust
session.completed = completed;
session.updated_at = now;
self.practice_repo.update_session(&session).await?;
```

### 步骤 5: 修改 Handler 中的 Service 创建

**重构前**:
```rust
#[tauri::command]
pub async fn start_practice_session(app: AppHandle, plan_id: i64, schedule_id: i64)
    -> AppResult<PracticeSession>
{
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    let service = PracticeService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    service.start_practice_session(plan_id, schedule_id).await
}
```

**重构后**:
```rust
#[tauri::command]
pub async fn start_practice_session(app: AppHandle, plan_id: i64, schedule_id: i64)
    -> AppResult<PracticeSession>
{
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    // 创建 Repository 实例
    let practice_repo = PracticeRepository::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );
    let schedule_repo = StudyScheduleRepository::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    // 创建 Service 实例
    let service = PracticeService::new(practice_repo, schedule_repo);

    service.start_practice_session(plan_id, schedule_id).await
}
```

---

## 📊 各 Service 重构优先级

### 高优先级 (立即可重构)

1. **CalendarService** ✅
   - Repository: CalendarRepository
   - 命令数: 1
   - 复杂度: 低
   - 预计时间: 30 分钟

2. **WordService**
   - Repository: WordRepository
   - 命令数: 4 (3个已重构,1个待重构)
   - 复杂度: 中
   - 预计时间: 1 小时

### 中优先级

3. **WordBookService**
   - Repository: WordBookRepository + ThemeTagRepository
   - 命令数: 10 (6个已重构,4个待重构)
   - 复杂度: 中
   - 预计时间: 2 小时

### 低优先级 (较复杂)

4. **PracticeService**
   - Repository: PracticeRepository + StudyScheduleRepository
   - 命令数: 10
   - 复杂度: 高
   - 预计时间: 3 小时

5. **StudyPlanService**
   - Repository: StudyPlanRepository + StudyScheduleRepository
   - 命令数: 20 (1个已重构,19个待重构)
   - 复杂度: 非常高
   - 预计时间: 6 小时

---

## 🎨 重构模式

### 模式 1: 简单 CRUD 操作

适用于: CalendarService 的 `get_today_schedules`

```rust
// 重构后
impl CalendarService {
    pub async fn get_today_schedules(&self) -> AppResult<Vec<TodaySchedule>> {
        let today_schedules = self.calendar_repo
            .find_today_schedules()
            .await?;

        // 业务逻辑处理
        let schedules = today_schedules.into_iter()
            .map(|info| self.convert_to_schedule(info))
            .collect();

        Ok(schedules)
    }
}
```

### 模式 2: 复杂业务逻辑

适用于: PracticeService 的 `start_practice_session`

```rust
// 重构后
impl PracticeService {
    pub async fn start_practice_session(&self, plan_id: i64, schedule_id: i64)
        -> AppResult<PracticeSession>
    {
        // 1. 验证数据
        let schedule = self.schedule_repo
            .find_by_id(schedule_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("日程不存在".to_string()))?;

        // 2. 业务逻辑检查
        let existing = self.practice_repo
            .find_incomplete_session(plan_id, schedule_id)
            .await?;

        if let Some(session) = existing {
            return Ok(session);
        }

        // 3. 获取相关数据
        let words = self.schedule_repo
            .find_schedule_words(schedule_id)
            .await?;

        // 4. 业务逻辑处理
        let word_states = self.create_word_states(words)?;

        // 5. 创建记录
        let session_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        self.practice_repo
            .create_session(&session_id, plan_id, schedule_id, &schedule.schedule_date, &now)
            .await?;

        // 6. 返回结果
        Ok(PracticeSession { /* ... */ })
    }
}
```

### 模式 3: 事务处理

如果需要事务处理,Repository 层方法应该接受 `&mut tx` 参数:

```rust
// Repository 层
impl PracticeRepository {
    pub async fn create_session_with_tx(
        &self,
        tx: &mut sqlx::Transaction<SqlitePool>,
        session_id: &str,
        plan_id: i64,
        // ...
    ) -> AppResult<()> {
        // 使用 tx 而不是 self.pool
        sqlx::query("INSERT INTO ...")
            .bind(session_id)
            .execute(&mut *tx)
            .await?;
        Ok(())
    }
}

// Service 层
impl PracticeService {
    pub async fn create_session_with_words(&self, /* ... */) -> AppResult<()> {
        let mut tx = self.pool.begin().await?;

        // 使用事务创建多个记录
        self.practice_repo
            .create_session_with_tx(&mut tx, &session_id, plan_id, /* ... */)
            .await?;

        self.practice_repo
            .create_word_states_batch_with_tx(&mut tx, &session_id, &states)
            .await?;

        tx.commit().await?;
        Ok(())
    }
}
```

---

## ⚠️ 注意事项

### 1. 类型匹配

Repository 返回的类型可能需要转换:

```rust
// Repository 返回的类型
pub struct ScheduleWordInfo {
    pub word_id: i64,
    pub word: String,
    // ...
}

// Service 需要的类型
pub struct PracticeWordInfo {
    pub wordId: i64,
    pub word: String,
    // ...
}

// 转换函数
impl PracticeService {
    fn convert_schedule_word_to_practice_word(info: ScheduleWordInfo) -> PracticeWordInfo {
        PracticeWordInfo {
            wordId: info.word_id,
            word: info.word,
            // ...
        }
    }
}
```

### 2. 错误处理

Repository 已经返回 `AppResult<T>`,Service 只需传递错误:

```rust
pub async fn get_session(&self, session_id: &str) -> AppResult<PracticeSession> {
    // Repository 返回 AppResult<Option<PracticeSession>>
    let session = self.practice_repo
        .find_session_by_id(session_id)
        .await?;  // ? 传递错误

    session.ok_or_else(|| {
        AppError::NotFound(format!("会话 {} 不存在", session_id))
    })
}
```

### 3. 日志记录

Repository 已经有日志记录,Service 只需记录业务逻辑:

```rust
pub async fn start_practice_session(&self, /* ... */) -> AppResult<PracticeSession> {
    self.logger.info("PRACTICE", "开始练习会话");

    // Repository 调用会自动记录数据库操作日志

    // 只记录业务逻辑相关的日志
    self.logger.info(
        "PRACTICE",
        &format!("练习会话 {} 创建成功", session_id)
    );

    Ok(session)
}
```

---

## 📝 检查清单

重构完成后,确认:

- [ ] Service 不再包含直接 SQL 查询 (`sqlx::query`)
- [ ] 所有数据库操作通过 Repository
- [ ] Service 只包含业务逻辑,不包含数据访问逻辑
- [ ] 错误处理正确 (`AppResult<T>`)
- [ ] 日志记录适当 (不过度记录)
- [ ] 类型转换正确
- [ ] Handler 正确创建 Service 实例
- [ ] 代码可以编译
- [ ] 功能测试通过

---

## 🚀 开始重构

推荐顺序:

1. ✅ CalendarService (最简单,30分钟)
2. WordService (中等,1小时)
3. WordBookService (中等,2小时)
4. PracticeService (复杂,3小时)
5. StudyPlanService (最复杂,6小时)

---

*文档创建时间: 2026-01-03*
*作者: Claude AI Assistant*
