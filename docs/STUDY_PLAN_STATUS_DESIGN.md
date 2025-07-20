# 学习计划状态管理统一设计方案

## 问题分析

### 当前双状态系统
- **管理状态 (status)**: `normal`, `draft`, `deleted`
- **生命周期状态 (lifecycle_status)**: `pending`, `active`, `completed`, `terminated`

### 存在的问题
1. **状态转换复杂**: 两套状态系统导致状态转换逻辑复杂
2. **业务逻辑混乱**: 同一个操作可能需要同时修改两个状态
3. **前端显示困难**: 需要同时考虑两个状态来决定显示逻辑
4. **数据一致性风险**: 两个状态可能出现不一致的情况

## 统一状态模型设计

### 新的统一状态枚举
```rust
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum StudyPlanStatus {
    /// 草稿状态 - 刚创建，还未完成配置
    Draft,
    /// 待开始 - 已配置完成，等待开始学习
    Pending,
    /// 进行中 - 正在学习
    Active,
    /// 已暂停 - 暂时停止学习
    Paused,
    /// 已完成 - 学习计划正常完成
    Completed,
    /// 已终止 - 提前结束学习计划
    Terminated,
    /// 已删除 - 软删除状态
    Deleted,
}
```

### 状态转换规则

#### 允许的状态转换
```
Draft → Pending (发布学习计划)
Draft → Deleted (删除草稿)

Pending → Active (开始学习)
Pending → Draft (重新编辑)
Pending → Deleted (删除计划)

Active → Paused (暂停学习)
Active → Completed (完成学习)
Active → Terminated (终止学习)
Active → Draft (重新编辑，重置进度)

Paused → Active (恢复学习)
Paused → Terminated (终止学习)
Paused → Draft (重新编辑，重置进度)

Completed → Draft (重新编辑，重置进度)
Terminated → Draft (重新编辑，重置进度)

任何状态 → Deleted (软删除)
```

#### 禁止的状态转换
- `Completed` → `Active/Pending/Paused`
- `Terminated` → `Active/Pending/Paused`
- `Deleted` → 任何其他状态（需要恢复操作）

### 状态语义说明

1. **Draft**: 学习计划处于编辑状态，可以修改所有配置
2. **Pending**: 学习计划已配置完成，等待用户开始学习
3. **Active**: 学习计划正在进行中，用户正在学习
4. **Paused**: 学习计划暂停，可以恢复继续学习
5. **Completed**: 学习计划正常完成，所有单词都已掌握
6. **Terminated**: 学习计划提前终止，未完成所有学习目标
7. **Deleted**: 学习计划已删除，不在正常列表中显示

## 数据库迁移方案

### 迁移策略
1. 添加新的 `unified_status` 字段
2. 根据现有的双状态组合映射到新状态
3. 逐步迁移数据
4. 删除旧的状态字段

### 状态映射规则
```sql
-- 映射规则
CASE 
    WHEN status = 'deleted' THEN 'Deleted'
    WHEN status = 'draft' THEN 'Draft'
    WHEN status = 'normal' AND lifecycle_status = 'pending' THEN 'Pending'
    WHEN status = 'normal' AND lifecycle_status = 'active' THEN 'Active'
    WHEN status = 'normal' AND lifecycle_status = 'completed' THEN 'Completed'
    WHEN status = 'normal' AND lifecycle_status = 'terminated' THEN 'Terminated'
    ELSE 'Draft'
END
```

## 前端适配方案

### 状态显示逻辑
```typescript
export const getStatusDisplay = (status: StudyPlanStatus) => {
  switch (status) {
    case 'Draft': return { text: '草稿', color: 'gray', icon: 'edit' };
    case 'Pending': return { text: '待开始', color: 'blue', icon: 'clock' };
    case 'Active': return { text: '进行中', color: 'green', icon: 'play' };
    case 'Paused': return { text: '已暂停', color: 'orange', icon: 'pause' };
    case 'Completed': return { text: '已完成', color: 'green', icon: 'check' };
    case 'Terminated': return { text: '已终止', color: 'red', icon: 'stop' };
    case 'Deleted': return { text: '已删除', color: 'gray', icon: 'trash' };
  }
};
```

### 操作权限控制
```typescript
export const getAvailableActions = (status: StudyPlanStatus) => {
  switch (status) {
    case 'Draft':
      return ['edit', 'publish', 'delete'];
    case 'Pending':
      return ['start', 'edit', 'delete'];
    case 'Active':
      return ['pause', 'complete', 'terminate', 'edit'];
    case 'Paused':
      return ['resume', 'terminate', 'edit'];
    case 'Completed':
    case 'Terminated':
      return ['restart', 'delete'];
    case 'Deleted':
      return ['restore', 'permanentDelete'];
    default:
      return [];
  }
};
```

## 实施计划

### 阶段1: 数据库迁移
1. 创建迁移脚本添加 `unified_status` 字段
2. 数据迁移：根据现有双状态映射到新状态
3. 添加状态转换验证约束

### 阶段2: 后端适配
1. 更新 Rust 类型定义
2. 修改所有状态相关的查询和更新逻辑
3. 实现状态转换验证函数
4. 更新 API 接口

### 阶段3: 前端适配
1. 更新 TypeScript 类型定义
2. 修改状态显示组件
3. 更新操作按钮和权限控制
4. 适配所有相关页面

### 阶段4: 清理
1. 删除旧的状态字段
2. 清理相关的旧代码
3. 更新文档和测试

## 优势

1. **简化逻辑**: 单一状态系统，状态转换清晰
2. **易于维护**: 减少状态不一致的风险
3. **用户友好**: 状态含义更加直观
4. **扩展性好**: 新增状态只需要扩展枚举
5. **类型安全**: 编译时检查状态转换的合法性
