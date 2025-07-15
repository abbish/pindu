# CLAUDE.md - Tauri + React 项目开发规则

## 项目架构
- **前端**: React 18 + TypeScript + Vite
- **后端**: Tauri (Rust)
- **构建工具**: Vite + Tauri CLI
- **包管理**: pnpm + Cargo

## 开发命令
```bash
# 开发模式
npm run tauri:dev

# 构建应用
npm run tauri:build

# 类型检查
npm run type-check

# 代码检查
npm run lint

# 测试
npm run test

# Rust 检查
cargo check
cargo clippy
```

## 数据库架构

### SQLite 数据库设计
- **数据库文件**: `redlark.db` (存储在用户本地)
- **迁移管理**: 使用 Tauri SQL 插件自动迁移
- **数据持久化**: 本地 SQLite，无需网络连接

### 核心数据表
```sql
-- 分类表
categories (id, name, description, color, icon, word_count)

-- 单词表  
words (id, word, pronunciation, translation, example_sentence, difficulty_level, category)

-- 学习计划表
study_plans (id, name, description, status, total_words, learned_words, accuracy_rate, mastery_level)

-- 学习计划单词关联表
study_plan_words (id, plan_id, word_id, learned, correct_count, total_attempts, mastery_score)

-- 学习会话记录表
study_sessions (id, plan_id, started_at, finished_at, words_studied, correct_answers)

-- 学习统计表
study_statistics (id, date, words_learned, words_reviewed, total_study_time, accuracy_rate, streak_days)
```

### 数据访问规范
- **Rust 后端**: 使用 `tauri-plugin-sql` 操作数据库
- **前端调用**: 通过 `invoke()` API 调用 Rust 命令
- **类型安全**: 前后端共享类型定义
- **错误处理**: 统一的 `Result<T, String>` 返回格式
- **事务管理**: 复杂操作使用数据库事务确保一致性

## 目录结构
```
src/
├── components/          # React 组件
├── pages/              # 页面组件
├── hooks/              # 自定义 hooks
├── utils/              # 工具函数
├── types/              # TypeScript 类型定义
├── stores/             # 状态管理
├── assets/             # 静态资源
└── styles/             # 样式文件

src-tauri/
├── src/
│   ├── main.rs         # Tauri 主入口
│   ├── commands.rs     # 自定义命令
│   └── lib.rs          # 库文件
├── Cargo.toml          # Rust 依赖配置
└── tauri.conf.json     # Tauri 配置
```

## 代码规范

### React/TypeScript
- 使用函数组件 + hooks
- 优先使用 TypeScript 类型安全
- 组件使用 PascalCase 命名
- 文件名使用 kebab-case
- 导出使用 named export，避免 default export
- Props 接口命名: `ComponentNameProps`

### Rust
- 遵循 Rust 官方代码规范
- 使用 `cargo fmt` 格式化
- 使用 `cargo clippy` 进行代码检查
- 函数命名使用 snake_case
- 结构体使用 PascalCase

### Tauri 通信
- 前端调用后端使用 `invoke()` API
- 后端命令使用 `#[tauri::command]` 宏
- 错误处理使用 `Result<T, String>`
- 复杂数据结构使用 serde 序列化

## 状态管理
- 简单状态: React useState/useReducer
- 复杂状态: Zustand
- 服务端状态: TanStack Query

## 样式方案
- **CSS Modules** - 组件样式隔离
- **CSS 变量** - 设计系统和主题
- **PostCSS** - 自动前缀和优化
- **响应式设计** - CSS Grid/Flexbox

### 样式文件规范
```
src/styles/
├── globals.css          # 全局样式和 CSS 变量
├── components/          # 组件样式目录
│   └── Button.module.css
└── utils.css           # 工具类样式
```

### CSS 变量命名规范
- 颜色：`--color-{category}-{variant}` (如 `--color-primary-hover`)
- 间距：`--spacing-{size}` (如 `--spacing-md`)
- 圆角：`--radius-{size}` (如 `--radius-lg`)
- 阴影：`--shadow-{size}` (如 `--shadow-md`)
- 字体：`--font-{property}-{variant}` (如 `--font-size-lg`)

### CSS Modules 使用规则
- 文件名：`ComponentName.module.css`
- 类名使用 camelCase：`.primaryButton`
- 避免全局类名冲突
- 优先使用 CSS 变量而非硬编码值

### 主题系统
- 支持 light/dark 主题切换
- 使用 `data-theme` 属性控制
- 主题变量定义在 `:root` 和 `[data-theme="dark"]`
- 提供 `useTheme` hook 管理主题状态

### 样式组织原则
- **全局样式** - 仅用于重置、变量定义、基础元素
- **组件样式** - 使用 CSS Modules，避免样式泄露  
- **工具类** - 少量常用的工具类（如 `.sr-only`）
- **响应式** - 移动优先，使用相对单位

## 页面布局规范

### 布局一致性原则
所有页面必须遵循统一的布局规范，确保用户体验的一致性：

#### 页面结构标准
1. **页面容器**: `.page` 类，统一的页面基础样式
   ```css
   .page {
     min-height: 100vh;
     background-color: var(--color-bg-secondary);
     display: flex;
     flex-direction: column;
   }
   ```

2. **主内容区域**: `.main` 类，统一的内容容器规范
   ```css
   .main {
     flex: 1;
     max-width: 1400px;           /* 统一最大宽度 */
     margin: 0 auto;              /* 居中布局 */
     padding: var(--spacing-2xl) var(--spacing-lg); /* 统一内边距 */
     width: 100%;
   }
   ```

3. **页面头部**: `.pageHeader` 类，统一的页面标题区域
   ```css
   .pageHeader {
     margin-bottom: var(--spacing-2xl); /* 统一底部间距 */
   }
   ```

#### 响应式布局标准
- **桌面端**: `max-width: 1400px`，内边距 `var(--spacing-2xl) var(--spacing-lg)`
- **平板端** (≤768px): 内边距 `var(--spacing-lg) var(--spacing-md)`
- **手机端** (≤480px): 内边距 `var(--spacing-md) var(--spacing-sm)`

#### 页面标题规范
- **主标题**: `font-size: var(--font-size-3xl)`，`font-weight: var(--font-weight-bold)`
- **副标题**: `font-size: var(--font-size-lg)`，`color: var(--color-text-secondary)`
- **标题间距**: 主标题下方 `var(--spacing-xs)`，副标题为 `margin: 0`

#### 内容区域间距
- **主要章节间距**: `margin-bottom: var(--spacing-2xl)`
- **次要章节间距**: `margin-bottom: var(--spacing-lg)`
- **组件间距**: `gap: var(--spacing-lg)` 或 `margin-bottom: var(--spacing-lg)`

#### 面包屑导航规范
- 所有页面必须包含 Header 和 Breadcrumb 组件
- Header 后紧跟 Breadcrumb，然后是页面主要内容
- 面包屑使用页面默认背景，不额外设置背景色

### 布局约束规则
1. **禁止破坏页面结构**: 所有页面必须遵循 Header → Breadcrumb → Content 的结构
2. **统一最大宽度**: 所有页面内容区域最大宽度必须为 1400px
3. **统一内边距**: 使用标准化的 spacing 变量，不得硬编码数值
4. **响应式一致性**: 所有页面必须在相同断点使用相同的布局调整
5. **组件间距标准化**: 相同级别的内容区域必须使用相同的间距规范

## 测试工具
- 单元测试: Vitest
- 组件测试: React Testing Library
- Rust 测试: `cargo test`

## 性能优化
- 使用 React.memo 避免不必要重渲染
- 懒加载路由和组件
- 图片资源优化
- Tauri bundle 体积优化

## 安全规范
- 严格的 CSP 配置
- API 端点权限控制
- 敏感操作需要确认
- 输入验证和清理


## 代码生成规则

### 组件生成
- 新组件必须包含 TypeScript 接口定义
- 创建对应的 CSS Module 文件 `ComponentName.module.css`
- 生成对应的测试文件 `ComponentName.test.tsx`
- 包含基本的 props 验证和默认值
- 添加 JSDoc 注释说明组件用途
- 遵循项目的文件命名和目录结构
- 使用 CSS 变量而非硬编码样式值
- 支持主题切换（light/dark）
- 确保无障碍访问（ARIA 属性、语义化标签）

### API 层生成
- Tauri 命令必须有对应的前端 TypeScript 类型
- 自动生成 API 客户端代码和类型定义
- 包含错误处理和加载状态管理
- 添加 JSDoc 注释描述 API 功能和参数

### 工具函数生成
- 纯函数优先，避免副作用
- 必须包含完整的 TypeScript 类型注解
- 生成对应的单元测试
- 添加使用示例和文档注释

## 重构规则

### 重构触发条件
- 函数超过 50 行代码
- 组件 props 超过 10 个
- 代码重复超过 3 次
- 圈复杂度过高（> 10）
- 测试覆盖率低于 80%

### 重构策略
- **提取组件**: 大组件拆分为小组件
- **提取 hooks**: 复用状态逻辑
- **提取工具函数**: 复用业务逻辑
- **合并相似功能**: 避免重复代码
- **优化数据结构**: 提升性能和可读性

### 重构步骤
1. 小步骤重构，保持功能不变
2. 更新相关文档和类型定义

## 自动化测试规则

### 测试质量要求
- 为新增功能编写测试
- 测试核心业务逻辑
- 测试边界条件和错误处理

### 必要测试场景

#### React 组件测试
```typescript
// 每个组件必须测试
- 基本渲染
- Props 传递和默认值
- 用户交互（点击、输入等）
- 条件渲染逻辑
- 错误边界情况
```

#### Tauri 命令测试
```rust
// 每个命令必须测试
- 正常输入输出
- 边界条件处理
- 错误情况处理
- 权限验证
- 数据序列化/反序列化
```

#### 集成测试
- API 端到端调用
- 状态管理集成
- 文件系统操作
- 系统通知功能
- 跨平台兼容性

### 测试文件命名规范
```
src/components/Button.tsx
src/components/Button.test.tsx

src/utils/format.ts
src/utils/format.test.ts

src-tauri/src/commands.rs
src-tauri/src/commands.rs (内置 #[cfg(test)] 模块)
```

### 测试最佳实践
- 使用工厂函数生成测试数据
- 模拟外部依赖
- 测试隔离，避免副作用



