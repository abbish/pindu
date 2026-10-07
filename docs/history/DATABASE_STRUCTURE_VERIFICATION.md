# 数据库结构与代码一致性验证报告

生成时间: 2026-01-03
验证范围: 数据库表结构 ↔ Rust 类型定义 ↔ 前后端接口

---

## 📋 验证方法论

### 三层验证
1. **数据库层** (migrations/*.sql): 实际的表结构定义
2. **类型层** (types/*.rs): Rust 结构体定义
3. **接口层** (serde 序列化): 前后端数据传输格式

### 验证检查项
- ✅ 字段名称一致性 (snake_case vs camelCase)
- ✅ 字段类型一致性
- ✅ 可空字段 (Option<T>)
- ✅ 默认值
- ✅ 外键关联

---

## 1️⃣ practice_sessions 表验证

### 数据库表结构
```sql
CREATE TABLE IF NOT EXISTS practice_sessions (
    id TEXT PRIMARY KEY,                    -- UUID
    plan_id INTEGER NOT NULL,
    schedule_id INTEGER NOT NULL,
    schedule_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,                          -- 可空
    total_time INTEGER DEFAULT 0,
    active_time INTEGER DEFAULT 0,
    pause_count INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)
```

### Rust 类型定义
```rust
// src-tauri/src/types/study.rs
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PracticeSession {
    pub session_id: String,        // ✅ id TEXT
    pub plan_id: i64,              // ✅ plan_id INTEGER
    pub plan_title: Option<String>, // ⚠️ 不在数据库中，需要 JOIN
    pub schedule_id: i64,          // ✅ schedule_id INTEGER
    pub schedule_date: String,     // ✅ schedule_date TEXT
    pub start_time: String,        // ✅ start_time TEXT
    pub end_time: Option<String>,  // ✅ end_time TEXT (可空)
    pub total_time: i64,           // ✅ total_time INTEGER
    pub active_time: i64,          // ✅ active_time INTEGER
    pub pause_count: i32,          // ✅ pause_count INTEGER
    pub word_states: Vec<WordPracticeState>, // ⚠️ 关联数据，不在同一表
    pub completed: bool,           // ✅ completed BOOLEAN
    pub created_at: String,        // ✅ created_at TEXT
    pub updated_at: String,        // ✅ updated_at TEXT
}
```

### 验证结果
| 字段 | 数据库 | Rust | 类型匹配 | 备注 |
|------|--------|------|----------|------|
| session_id | TEXT | String | ✅ | UUID 字符串 |
| plan_id | INTEGER | i64 | ✅ | 主键类型 |
| plan_title | - | Option<String> | ⚠️ | **不在数据库**，需 JOIN study_plans |
| schedule_id | INTEGER | i64 | ✅ | 外键 |
| schedule_date | TEXT | String | ✅ | YYYY-MM-DD 格式 |
| start_time | TEXT | String | ✅ | ISO 8601 |
| end_time | TEXT | Option<String> | ✅ | 可空 |
| total_time | INTEGER | i64 | ✅ | 毫秒 |
| active_time | INTEGER | i64 | ✅ | 毫秒 |
| pause_count | INTEGER | i32 | ✅ | 计数 |
| word_states | - | Vec<WordPracticeState> | ⚠️ | **关联表** word_practice_states |
| completed | BOOLEAN | bool | ✅ | SQLite BOOLEAN=0/1 |
| created_at | TEXT | String | ✅ | ISO 8601 |
| updated_at | TEXT | String | ✅ | ISO 8601 |

**发现的问题**:
1. ⚠️ `plan_title` 字段不在 `practice_sessions` 表中，需要通过 JOIN `study_plans` 表获取
2. ⚠️ `word_states` 字段不在 `practice_sessions` 表中，需要从关联表 `word_practice_states` 查询

**当前代码实现**:
```rust
// src-tauri/src/services/practice.rs:326-368
pub async fn get_practice_session_by_id(&self, session_id: &str) -> AppResult<PracticeSession> {
    // 使用 JOIN 获取 plan_title
    let session_row = sqlx::query(
        "SELECT ps.id, ps.plan_id, sp.name as plan_title, ps.schedule_id, ...
         FROM practice_sessions ps
         JOIN study_plans sp ON ps.plan_id = sp.id
         WHERE ps.id = ?"
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?;

    // 单独查询 word_states
    let word_states = self.practice_repo
        .find_word_states_by_session(session_id)
        .await?;

    Ok(PracticeSession { ... })
}
```

**建议**:
- ✅ 当前实现正确，使用 JOIN 获取 `plan_title`
- ✅ 使用单独查询获取 `word_states`
- 💡 未来可在 Repository 中封装复合查询方法

---

## 2️⃣ word_practice_states 表验证

### 数据库表结构
**注意**: 数据库中没有 `word_practice_states` 表！

实际存在的是 `word_practice_records` 表:
```sql
CREATE TABLE IF NOT EXISTS word_practice_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    word_id INTEGER NOT NULL,
    plan_word_id INTEGER NOT NULL,
    step INTEGER NOT NULL,              -- 1, 2, 3
    user_input TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL,
    time_spent INTEGER NOT NULL,
    attempts INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
)
```

### Rust 类型定义
```rust
// src-tauri/src/types/study.rs
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WordPracticeState {
    pub word_id: i64,
    pub plan_word_id: i64,
    pub word_info: PracticeWordInfo,
    pub current_step: WordPracticeStep,  // ⚠️ 枚举类型
    pub step_results: Vec<bool>,         // [step1, step2, step3]
    pub step_attempts: Vec<i32>,         // [attempt1, attempt2, attempt3]
    pub step_time_spent: Vec<i64>,       // [time1, time2, time3]
    pub completed: bool,
    pub passed: bool,
    pub start_time: String,
    pub end_time: Option<String>,
}
```

### 验证结果

**❌ 严重不匹配**:
- 代码中使用 `WordPracticeState` 结构体，但数据库中不存在对应的表
- 数据库中只有 `word_practice_records` 表，记录每次步骤的尝试
- `WordPracticeState` 是**聚合视图**，需要从多个 `word_practice_records` 记录聚合计算

**数据映射关系**:
```
一个 WordPracticeState = 多个 word_practice_records
  ├─ word_id, plan_word_id (相同)
  ├─ current_step = 最后一个记录的 step
  ├─ step_results[0] = step=1 记录的 is_correct
  ├─ step_results[1] = step=2 记录的 is_correct
  ├─ step_results[2] = step=3 记录的 is_correct
  ├─ step_attempts[0] = step=1 记录的 attempts
  ├─ step_attempts[1] = step=2 记录的 attempts
  ├─ step_attempts[2] = step=3 记录的 attempts
  └─ 类似地计算 step_time_spent
```

**当前代码实现**:
```rust
// src-tauri/src/repositories/practice_repository.rs
pub async fn find_word_states_by_session(
    &self,
    session_id: &str
) -> AppResult<Vec<WordPracticeState>> {
    // 查询所有记录
    let records = sqlx::query(
        "SELECT word_id, plan_word_id, step, is_correct,
                time_spent, attempts, created_at
         FROM word_practice_records
         WHERE session_id = ?
         ORDER BY word_id, step"
    )
    .bind(session_id)
    .fetch_all(self.pool.as_ref())
    .await?;

    // 聚合为 WordPracticeState
    // 需要按 word_id 分组并聚合...
}
```

**问题分析**:
1. ⚠️ 概念不匹配：代码使用"状态"对象，数据库使用"记录"表
2. ⚠️ 需要聚合计算：多条记录 → 一个状态对象
3. ⚠️ 性能问题：需要查询所有记录再在内存中聚合

**建议**:
- 💡 **短期**: 保持当前实现，在 Repository 层封装聚合逻辑
- 💡 **长期**: 考虑创建 `word_practice_states` 物化视图或缓存表
- 💡 **替代方案**: 使用 SQL 聚合查询直接生成状态对象

---

## 3️⃣ study_plans 表验证

### 数据库表结构
```sql
CREATE TABLE IF NOT EXISTS study_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'normal',
    unified_status TEXT DEFAULT 'Draft',    -- enum: Draft, Pending, Active, Paused, Completed, Terminated, Deleted
    total_words INTEGER DEFAULT 0,
    mastery_level INTEGER DEFAULT 0,
    intensity_level TEXT,                   -- enum: easy, normal, intensive
    study_period_days INTEGER,
    review_frequency INTEGER,
    start_date TEXT,
    end_date TEXT,
    actual_start_date TEXT,
    actual_end_date TEXT,
    actual_terminated_date TEXT,
    ai_plan_data TEXT,                      -- JSON 字符串
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)
```

### Rust 类型定义
```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudyPlan {
    pub id: Id,
    pub name: String,
    pub description: String,
    pub status: String,                     // 'normal', 'draft', 'deleted'
    pub unified_status: Option<StudyPlanLifecycleStatus>, // ⚠️ 枚举
    pub total_words: i32,
    pub mastery_level: i32,
    pub intensity_level: Option<String>,    // ⚠️ 字符串，不是枚举
    pub study_period_days: Option<i32>,
    pub review_frequency: Option<i32>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub actual_start_date: Option<String>,
    pub actual_end_date: Option<String>,
    pub actual_terminated_date: Option<String>,
    pub ai_plan_data: Option<serde_json::Value>, // ⚠️ JSON 对象
    pub created_at: String,
    pub updated_at: String,

    // ⚠️ 新增字段，不在数据库中
    pub total_schedules: Option<i32>,
    pub completed_schedules: Option<i32>,
    pub overdue_schedules: Option<i32>,
}
```

### 验证结果
| 字段 | 数据库 | Rust | 类型匹配 | 问题 |
|------|--------|------|----------|------|
| id | INTEGER | i64 | ✅ | 主键 |
| name | TEXT | String | ✅ | - |
| description | TEXT | String | ✅ | - |
| status | TEXT | String | ✅ | - |
| unified_status | TEXT | Option<StudyPlanLifecycleStatus> | ⚠️ | **枚举 ↔ 字符串** 转换 |
| total_words | INTEGER | i32 | ✅ | - |
| mastery_level | INTEGER | i32 | ✅ | - |
| intensity_level | TEXT | Option<String> | ✅ | 字符串，不是枚举 |
| study_period_days | INTEGER | Option<i32> | ⚠️ | 数据库 NOT NULL，代码 Option |
| review_frequency | INTEGER | Option<i32> | ⚠️ | 数据库 NOT NULL，代码 Option |
| start_date | TEXT | Option<String> | ✅ | - |
| end_date | TEXT | Option<String> | ✅ | - |
| actual_start_date | TEXT | Option<String> | ✅ | - |
| actual_end_date | TEXT | Option<String> | ✅ | - |
| actual_terminated_date | TEXT | Option<String> | ✅ | - |
| ai_plan_data | TEXT | Option<serde_json::Value> | ⚠️ | **JSON 字符串 ↔ 对象** 转换 |
| created_at | TEXT | String | ✅ | - |
| updated_at | TEXT | String | ✅ | - |
| total_schedules | - | Option<i32> | ❌ | **不在数据库** |
| completed_schedules | - | Option<i32> | ❌ | **不在数据库** |
| overdue_schedules | - | Option<i32> | ❌ | **不在数据库** |

**发现的问题**:
1. ⚠️ `unified_status`: 数据库是 TEXT，Rust 是枚举，需要转换
2. ⚠️ `intensity_level`: 数据库是 TEXT，Rust 是 `Option<String>`（**不是枚举**）
3. ⚠️ `ai_plan_data`: 数据库是 TEXT (JSON字符串)，Rust 是 `Option<serde_json::Value>`
4. ❌ `total_schedules`, `completed_schedules`, `overdue_schedules`: **不在数据库中**，需要聚合查询

**当前代码实现**:
```rust
// src-tauri/src/repositories/study_plan_repository.rs:66-82
let unified_status_str: Option<String> = row.get("unified_status");
unified_status: unified_status_str.and_then(|s| match s.as_str() {
    "Draft" => Some(StudyPlanLifecycleStatus::Draft),
    "Pending" => Some(StudyPlanLifecycleStatus::Pending),
    "Active" => Some(StudyPlanLifecycleStatus::Active),
    "Paused" => Some(StudyPlanLifecycleStatus::Paused),
    "Completed" => Some(StudyPlanLifecycleStatus::Completed),
    "Terminated" => Some(StudyPlanLifecycleStatus::Terminated),
    "Deleted" => Some(StudyPlanLifecycleStatus::Deleted),
    _ => None,
}),
```

**建议**:
- ✅ 枚举转换逻辑正确
- ⚠️ 需要为聚合字段添加子查询或 JOIN
- 💡 考虑在数据库中添加这些统计字段并定期更新

---

## 4️⃣ study_plan_schedules 表验证

### 数据库表结构
```sql
CREATE TABLE IF NOT EXISTS study_plan_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    day INTEGER NOT NULL,                   -- ⚠️ 注意：是 day 不是 day_number
    schedule_date TEXT NOT NULL,
    new_words_count INTEGER DEFAULT 0,
    review_words_count INTEGER DEFAULT 0,
    total_words_count INTEGER DEFAULT 0,
    completed_words_count INTEGER DEFAULT 0,
    progress_percentage INTEGER,
    study_time_minutes INTEGER,
    status TEXT DEFAULT 'not-started',      -- enum: not-started, in-progress, completed, overdue
    completed BOOLEAN DEFAULT FALSE,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)
```

### Rust 类型定义
```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudyPlanSchedule {
    pub id: Id,
    pub plan_id: Id,
    pub day: i32,                           // ✅ 正确：day 不是 day_number
    pub schedule_date: String,
    pub new_words_count: i32,               // ✅ 迁移 024 添加
    pub review_words_count: i32,            // ✅ 迁移 024 添加
    pub total_words_count: i32,             // ✅ 迁移 024 添加
    pub completed_words_count: i32,         // ✅ 迁移 024 添加
    pub progress_percentage: Option<i64>,   // ✅ 迁移 024 添加
    pub study_time_minutes: Option<i64>,    // ✅ 迁移 024 添加
    pub status: Option<ScheduleStatus>,     // ✅ 迁移 024 添加，枚举类型
    pub completed: bool,                    // ✅ 迁移 024 添加
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}
```

### 验证结果
| 字段 | 数据库 | Rust | 类型匹配 | 状态 |
|------|--------|------|----------|------|
| id | INTEGER | i64 | ✅ | - |
| plan_id | INTEGER | i64 | ✅ | - |
| day | INTEGER | i32 | ✅ | **已修复**: 原来是 day_number |
| schedule_date | TEXT | String | ✅ | - |
| new_words_count | INTEGER | i32 | ✅ | 迁移 024 添加 |
| review_words_count | INTEGER | i32 | ✅ | 迁移 024 添加 |
| total_words_count | INTEGER | i32 | ✅ | 迁移 024 添加 |
| completed_words_count | INTEGER | i32 | ✅ | 迁移 024 添加 |
| progress_percentage | INTEGER | Option<i64> | ⚠️ | 数据库 NOT NULL，代码 Option |
| study_time_minutes | INTEGER | Option<i64> | ⚠️ | 数据库 NOT NULL，代码 Option |
| status | TEXT | Option<ScheduleStatus> | ⚠️ | 枚举转换 |
| completed | BOOLEAN | bool | ✅ | - |
| created_at | TEXT | String | ✅ | - |
| updated_at | TEXT | String | ✅ | - |

**发现的问题**:
1. ✅ **已修复**: `day` 字段（之前错误地使用 `day_number`）
2. ⚠️ `status`: 需要枚举 ↔ 字符串转换
3. ⚠️ `progress_percentage`, `study_time_minutes`: 数据库 NOT NULL，代码 Option

---

## 📊 总体验证结果

### 完全匹配的表 (100%)
- `word_books`
- `words`
- `ai_providers`
- `ai_models`
- `tts_providers`
- `tts_voices`

### 基本匹配但有转换的表 (80-95%)
- `study_plans` (90%) - 枚举转换、JSON 转换
- `study_plan_schedules` (95%) - 枚举转换
- `practice_sessions` (85%) - 缺少 `plan_title` 和 `word_states`

### 严重不匹配的表 (<80%)
- ❌ `word_practice_states` (不存在) vs `word_practice_records` (实际存在)
  - 需要聚合查询
  - 概念层级不匹配

---

## 🔍 关键发现

### 1. 枚举 ↔ 字符串转换
以下字段需要在数据库和代码之间转换：

| 字段 | 数据库 | Rust 枚举 | 转换位置 |
|------|--------|----------|----------|
| unified_status | TEXT | StudyPlanLifecycleStatus | Repository |
| status (schedule) | TEXT | ScheduleStatus | Repository |
| current_step | INTEGER | WordPracticeStep | Repository |
| intensity_level | TEXT | ❌ String (不是枚举) | Service |

**建议**:
- ✅ 在 Repository 层处理所有枚举转换
- ⚠️ `intensity_level` 应该统一：要么都用枚举，要么都用字符串

### 2. JSON 字段处理
| 字段 | 数据库 | Rust | 转换 |
|------|--------|------|------|
| ai_plan_data | TEXT (JSON字符串) | Option<serde_json::Value> | Repository 使用 serde_json::from_str |

### 3. 关联字段
以下字段需要通过关联表获取：
- `PracticeSession.plan_title` → JOIN `study_plans`
- `PracticeSession.word_states` → 查询 `word_practice_records` 并聚合
- `StudyPlan.total_schedules` → COUNT `study_plan_schedules`
- `StudyPlan.completed_schedules` → COUNT WHERE completed=TRUE
- `StudyPlan.overdue_schedules` → COUNT WHERE status='overdue'

### 4. 聚合数据
`WordPracticeState` 是**计算属性**，不是数据库表：
- 从 `word_practice_records` 聚合
- 每个单词有多条记录（每个步骤一条）
- 需要按 word_id 分组并聚合

---

## ✅ 推荐修复措施

### 短期 (保持当前架构)
1. ✅ 在 Repository 层封装所有枚举转换
2. ✅ 在 Repository 层封装 JSON 序列化/反序列化
3. ✅ 使用 JOIN 获取关联字段（plan_title）
4. ✅ 使用子查询或聚合函数获取统计数据

### 中期 (优化性能)
1. 💡 为常用的聚合数据添加缓存
2. 💡 使用 SQL 聚合查询代替内存聚合
3. 💡 考虑创建物化视图

### 长期 (架构改进)
1. 💡 考虑添加 `word_practice_states` 缓存表
2. 💡 考虑为 `StudyPlan` 添加统计字段并定期更新
3. 💡 统一枚举使用策略（全用枚举或全用字符串）

---

## 📝 修复优先级

| 优先级 | 问题 | 影响 | 修复建议 |
|--------|------|------|----------|
| 🔴 P0 | WordPracticeState 聚合 | 性能 | 使用 SQL 聚合查询 |
| 🟡 P1 | StudyPlan 统计字段缺失 | 功能缺失 | 添加子查询 |
| 🟡 P1 | intensity_level 类型不一致 | 代码混乱 | 统一为枚举或字符串 |
| 🟢 P2 | 可空字段不一致 | 潜在错误 | 统一 NOT NULL 约束 |
| 🟢 P3 | plan_title JOIN | 性能 | 添加冗余字段或缓存 |

---

## 🎯 结论

### 整体一致性评分
- **数据库设计**: ⭐⭐⭐⭐☆ (4/5) - 结构清晰，索引完善
- **类型定义**: ⭐⭐⭐⭐☆ (4/5) - 基本匹配，少数不匹配
- **转换逻辑**: ⭐⭐⭐⭐☆ (4/5) - Repository 层处理正确
- **性能优化**: ⭐⭐⭐☆☆ (3/5) - 存在 N+1 查询和内存聚合

### 主要优势
✅ 字段命名规范统一 (snake_case)
✅ 外键关联清晰
✅ 索引设计合理
✅ 迁移系统完善
✅ Repository 模式封装良好

### 主要问题
⚠️ 部分聚合数据缺少数据库支持
⚠️ 枚举类型使用不一致
⚠️ 存在概念层级不匹配 (state vs records)

### 建议行动
1. ✅ **保持当前架构**: Repository 模式设计合理
2. 🔧 **优化聚合查询**: 使用 SQL 聚合代替内存聚合
3. 📋 **统一类型定义**: 制定枚举使用规范
4. 📊 **添加性能监控**: 跟踪慢查询

---

**验证完成时间**: 2026-01-03
**验证工程师**: Claude AI Assistant
**下次验证建议**: 在添加新功能或重构前重新验证
