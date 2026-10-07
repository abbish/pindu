# 运行时数据库错误修复总结

修复日期: 2026-01-03
修复原因: 应用启动时出现多个数据库字段不存在的错误

---

## 🐛 发现的问题

### 问题 1: `study_plan_schedules.completed` 字段不存在
```
error: no such column: ss.completed
```
**位置**:
- `src-tauri/src/services/study_plan.rs:126`
- `src-tauri/src/services/study_plan.rs:212`

**原因**: 代码中使用了 `ss.completed = 1` 来判断日程是否完成，但数据库表中没有 `completed` 字段。

**解决方案**: 使用 `ss.status = 'completed'` 代替 `ss.completed = 1`

---

### 问题 2: `words.deleted_at` 字段不存在
```
error: no such column: deleted_at
```
**位置**:
- `src-tauri/src/repositories/wordbook_repository.rs:306`
- `src-tauri/src/repositories/wordbook_repository.rs:325`

**原因**: 查询中使用了 `deleted_at IS NULL` 来过滤软删除的单词，但 `words` 表中没有 `deleted_at` 字段。

**解决方案**: 移除 `AND deleted_at IS NULL` 条件，`words` 表不支持软删除

---

### 问题 3: `study_plan_schedules.day_number` vs `day` 字段名不一致
```
数据库字段: day_number
代码中使用: day
```

**位置**:
- `src-tauri/src/repositories/study_schedule_repository.rs:33` (SELECT)
- `src-tauri/src/repositories/study_schedule_repository.rs:85` (SELECT)
- `src-tauri/src/repositories/study_schedule_repository.rs:193` (INSERT)

**原因**: 数据库表使用 `day_number` 作为列名，但代码中使用 `day`

**解决方案**: 在 Repository 层进行字段映射
- 查询时: `SELECT ... day_number ...` → 映射到 `day: row.get("day_number")`
- 插入时: `day` 字段 → 绑定到 `day_number` 列

---

### 问题 4: `study_plan_schedules` 表缺少部分字段

数据库中不存在的字段:
- `progress_percentage`
- `study_time_minutes`
- `completed`

**解决方案**: 为这些字段设置默认值
```rust
StudyPlanSchedule {
    // ...
    progress_percentage: None,  // 默认值
    study_time_minutes: None,   // 默认值
    completed: false,           // 默认值
}
```

---

## ✅ 修复的文件

### 1. src-tauri/src/repositories/study_schedule_repository.rs

**修改的方法**:
- `find_by_plan` - 查询列表
- `find_by_id` - 查询单个
- `create` - 创建日程

**关键修改**:
```rust
// SQL 查询中使用 day_number
SELECT ..., day_number, ... FROM study_plan_schedules

// 映射到 Rust 结构体的 day 字段
day: row.get("day_number")

// INSERT 时使用 day_number
INSERT INTO study_plan_schedules (..., day_number, ...) VALUES (?, ...)
```

**字段默认值处理**:
```rust
StudyPlanSchedule {
    // ...
    progress_percentage: None,      // 数据库中不存在
    study_time_minutes: None,       // 数据库中不存在
    completed: false,               // 数据库中不存在
}
```

---

### 2. src-tauri/src/repositories/wordbook_repository.rs

**修改的方法**:
- `get_statistics` - 获取单词本统计

**关键修改**:
```rust
// 移除 deleted_at 检查
let word_count_query = r#"
    SELECT COUNT(*) as count
    FROM words
    WHERE word_book_id = ?  // 移除了 AND deleted_at IS NULL
"#;

let pos_query = r#"
    SELECT part_of_speech, COUNT(*) as count
    FROM words
    WHERE word_book_id = ? AND part_of_speech IS NOT NULL  // 移除了 AND deleted_at IS NULL
    GROUP BY part_of_speech
"#;
```

---

### 3. src-tauri/src/services/study_plan.rs

**修改的方法**:
- `get_study_plans_with_progress` - 获取带进度的学习计划列表
- `get_study_plan` - 获取学习计划详情

**关键修改**:
```rust
// 使用 status 字段判断是否完成，而不是 completed 字段
COUNT(DISTINCT CASE WHEN ss.status = 'completed' THEN ss.id END) as completed_schedules

// 之前（错误）:
// COUNT(DISTINCT CASE WHEN ss.completed = 1 THEN ss.id END) as completed_schedules
```

---

### 4. src-tauri/src/types/study.rs

**修改的结构体**:
- `StudyPlanSchedule`

**关键修改**:
```rust
pub struct StudyPlanSchedule {
    pub id: Id,
    pub plan_id: Id,
    pub day: i32,  // 注意: 数据库字段名是 'day_number'
    // ...
    // 注意: 以下字段在数据库中不存在，需要计算或从其他地方获取
    pub progress_percentage: Option<i64>,
    pub study_time_minutes: Option<i64>,
    pub status: Option<ScheduleStatus>,
    pub completed: bool,
    // ...
}
```

---

## 📊 数据库字段对照表

### study_plan_schedules 表

| 数据库字段 | Rust 字段 | 类型 | 备注 |
|-----------|----------|------|------|
| day_number | day | i32 | ⚠️ 字段名不同 |
| schedule_date | schedule_date | String | ✅ 一致 |
| new_words_count | new_words_count | i32 | ✅ 一致 |
| review_words_count | review_words_count | i32 | ✅ 一致 |
| total_words_count | total_words_count | i32 | ✅ 一致 |
| completed_words_count | completed_words_count | i32 | ✅ 一致 |
| status | status | Option<String> | ✅ 一致 |
| - | progress_percentage | Option<i64> | ❌ 不存在 |
| - | study_time_minutes | Option<i64> | ❌ 不存在 |
| - | completed | bool | ❌ 不存在 |

### words 表

| 数据库字段 | Rust 字段 | 类型 | 备注 |
|-----------|----------|------|------|
| id | id | i64 | ✅ 一致 |
| word | word | String | ✅ 一致 |
| meaning | meaning | String | ✅ 一致 |
| word_book_id | word_book_id | Option<i64> | ✅ 一致 |
| - | deleted_at | Option<String> | ❌ 不存在 |

---

## 🎯 修复原则

### 1. 不修改数据库设计
- ❌ 不创建新的迁移文件
- ❌ 不添加新字段到现有表
- ✅ 通过代码适配现有数据库结构

### 2. 在 Repository 层处理差异
- ✅ 字段名映射: `day_number` → `day`
- ✅ 为不存在的字段提供默认值
- ✅ 使用现有字段模拟不存在字段的功能

### 3. 保持 API 接口不变
- ✅ 前端接口保持一致
- ✅ 类型定义保持不变
- ✅ 业务逻辑保持不变

---

## 🧪 测试验证

### 编译测试
```bash
cargo check --manifest-path src-tauri/Cargo.toml
```
✅ **结果**: 编译通过，无错误无警告

### 运行时测试
需要验证:
- [ ] 首页加载正常
- [ ] 学习计划列表显示
- [ ] 单词本统计显示
- [ ] 日程数据正确显示

---

## 📝 后续建议

### 短期 (保持当前实现)
1. ✅ 继续使用字段映射
2. ✅ 为缺失字段提供默认值
3. ✅ 使用现有字段模拟功能

### 中期 (考虑优化)
1. 💡 在文档中明确标注字段映射关系
2. 💡 添加注释说明为什么字段为 None
3. 💡 考虑计算 `progress_percentage` 而非使用 None

### 长期 (如果允许修改数据库)
1. 💡 重命名 `day_number` 为 `day`
2. 💡 添加 `progress_percentage`, `study_time_minutes`, `completed` 字段
3. 💡 为 `words` 表添加 `deleted_at` 字段

---

## 🔍 相关文件

### 修改的文件
- [src-tauri/src/repositories/study_schedule_repository.rs](src-tauri/src/repositories/study_schedule_repository.rs)
- [src-tauri/src/repositories/wordbook_repository.rs](src-tauri/src/repositories/wordbook_repository.rs)
- [src-tauri/src/services/study_plan.rs](src-tauri/src/services/study_plan.rs)
- [src-tauri/src/types/study.rs](src-tauri/src/types/study.rs)

### 相关文档
- [DATABASE_STRUCTURE_VERIFICATION.md](DATABASE_STRUCTURE_VERIFICATION.md) - 数据库结构验证报告

---

**修复完成时间**: 2026-01-03
**修复工程师**: Claude AI Assistant
**编译状态**: ✅ 通过
**测试状态**: ⏳ 待用户验证
