# PracticeService 重构编译错误修复总结

## 📋 问题概述

在 PracticeService 重构后，发现了多个类型不匹配和缺失定义的问题。

---

## 🔧 修复的问题

### 1. StudyPlanSchedule 类型不匹配

**问题**: `StudyPlanSchedule` 类型定义与数据库表结构不匹配

**错误位置**: `src-tauri/src/types/study.rs:468`

**原因**:
- 类型定义中字段名为 `day_number`
- 数据库表和 Repository 中使用的字段名为 `day`
- 缺少数据库表中的统计字段

**修复**:
```rust
// 修复前
pub struct StudyPlanSchedule {
    pub id: Id,
    pub plan_id: Id,
    pub day_number: i32,  // ❌ 错误的字段名
    pub schedule_date: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

// 修复后
pub struct StudyPlanSchedule {
    pub id: Id,
    pub plan_id: Id,
    pub day: i32,  // ✅ 正确的字段名
    pub schedule_date: String,
    pub new_words_count: i32,  // ✅ 新增
    pub review_words_count: i32,  // ✅ 新增
    pub total_words_count: i32,  // ✅ 新增
    pub completed_words_count: i32,  // ✅ 新增
    pub progress_percentage: Option<i64>,  // ✅ 新增
    pub study_time_minutes: Option<i64>,  // ✅ 新增
    pub status: Option<ScheduleStatus>,  // ✅ 新增
    pub completed: bool,  // ✅ 新增
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}
```

**影响文件**: `src-tauri/src/types/study.rs`

---

### 2. ScheduleStatus 枚举缺失

**问题**: `ScheduleStatus` 枚举未定义，但被多处使用

**错误位置**:
- `src-tauri/src/repositories/study_schedule_repository.rs`
- `src-tauri/src/types/study.rs`

**原因**: Repository 中使用了 `ScheduleStatus` 枚举，但类型定义中不存在

**修复**: 在 `types/study.rs` 中添加枚举定义
```rust
/// 日程状态
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum ScheduleStatus {
    NotStarted,  // 未开始
    InProgress,  // 进行中
    Completed,   // 已完成
    Overdue,     // 已逾期
}
```

**影响文件**: `src-tauri/src/types/study.rs`

---

### 3. PracticeService 中 plan_name 字段不存在

**问题**: `StudyPlanSchedule` 没有 `plan_name` 字段

**错误位置**: `src-tauri/src/services/practice.rs:100`

**原因**: 代码尝试访问 `schedule.plan_name`，但 `StudyPlanSchedule` 类型中没有此字段

**修复**: 添加辅助方法获取计划名称
```rust
// 修复前
plan_title: schedule.plan_name.clone(),  // ❌ 字段不存在

// 修复后
let plan_title = self.get_plan_title(plan_id).await?;  // ✅ 单独查询
plan_title,
```

**新增辅助方法**:
```rust
/// 获取计划名称 (辅助方法)
async fn get_plan_title(&self, plan_id: i64) -> AppResult<String> {
    let pool = &self.practice_repo.pool;

    let row = sqlx::query("SELECT name FROM study_plans WHERE id = ?")
        .bind(plan_id)
        .fetch_optional(pool)
        .await?;

    match row {
        Some(row) => {
            let name: String = row.get("name");
            Ok(name)
        }
        None => Ok(format!("计划 {}", plan_id)),
    }
}
```

**影响文件**: `src-tauri/src/services/practice.rs`

---

### 4. PracticeRepository.pool 需要暴露

**问题**: `PracticeService` 需要访问 `pool` 来执行特殊查询

**错误位置**: `src-tauri/src/repositories/practice_repository.rs`

**修复**: 将 `pool` 字段改为 `pub(crate)`
```rust
// 修复前
pub struct PracticeRepository {
    pool: Arc<SqlitePool>,  // ❌ 私有字段
    logger: Arc<Logger>,
}

// 修复后
pub struct PracticeRepository {
    pub(crate) pool: Arc<SqlitePool>,  // ✅ crate内可见
    logger: Arc<Logger>,
}
```

**影响文件**: `src-tauri/src/repositories/practice_repository.rs`

---

## ✅ 验证修复

### 类型一致性检查

1. **数据库表结构**: ✅
   - 基础字段: `id`, `plan_id`, `day`, `schedule_date`
   - 统计字段: 迁移 024 添加
   - 状态字段: 迁移 024 添加

2. **Rust 类型定义**: ✅
   - 字段名与数据库一致
   - 字段类型匹配
   - 包含所有数据库字段

3. **Repository 查询**: ✅
   - SELECT 语句字段完整
   - 字段映射正确
   - 状态枚举转换正确

### SQL查询统计

修复后，PracticeService 的 SQL 查询数量:
- **消除的SQL**: 23个 (通过Repository)
- **保留的SQL**: 3个
  - `get_plan_title`: 获取计划名称
  - `get_practice_session_by_id`: JOIN获取plan_title (2个)

---

## 📝 修复总结

| 问题类型 | 影响文件 | 修复方式 | 状态 |
|---------|---------|---------|------|
| 类型字段不匹配 | types/study.rs | 更新字段定义 | ✅ |
| 枚举缺失 | types/study.rs | 添加ScheduleStatus | ✅ |
| 字段访问错误 | services/practice.rs | 添加辅助方法 | ✅ |
| 访问修饰符 | repositories/practice_repository.rs | 改为pub(crate) | ✅ |

---

## 🎯 后续优化建议

1. **创建专用Repository方法**:
   ```rust
   // 在 StudyPlanRepository 中添加
   pub async fn find_plan_name(&self, plan_id: Id) -> AppResult<String>
   ```

2. **创建复合查询方法**:
   ```rust
   // 在 PracticeRepository 中添加
   pub async fn find_session_with_plan_title(&self, session_id: &str)
       -> AppResult<Option<PracticeSession>>
   ```

3. **考虑类型设计**:
   - 是否需要 `StudyPlanSchedule` 包含 `plan_name`?
   - 是否应该使用关联对象而非JOIN?

---

## 📊 修复效果

**编译错误**: 4个主要问题
**修复文件**: 3个
**新增代码**: ~80行
**状态**: ✅ 全部修复

---

**修复日期**: 2026-01-03
**修复工程师**: Claude AI Assistant
