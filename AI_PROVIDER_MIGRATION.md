# 前端类型定义迁移指南

**背景**: 后端已修复 API Key 泄露漏洞,API 响应类型已更新
**影响**: AI 相关的 TypeScript 类型定义需要同步更新
**时间**: 2025-01-03

---

## 📋 变更摘要

| 旧类型 | 新类型 | 变更原因 |
|--------|--------|---------|
| `AIProvider` | `AIProviderSafe` | 隐藏 API Key |
| `AIModelConfig` | `AIModelConfigSafe` | 使用 AIProviderSafe |

---

## 🔄 类型定义变更

### 1. AIProvider → AIProviderSafe

#### ❌ 旧定义 (包含敏感信息)

```typescript
interface AIProvider {
  id: number;
  name: string;
  display_name: string;
  base_url: string;
  api_key: string;  // ⚠️ 敏感信息
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

#### ✅ 新定义 (安全)

```typescript
interface AIProviderSafe {
  id: number;
  name: string;
  display_name: string;
  base_url: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // 新增字段
  has_api_key: boolean;      // 标识是否存在 API Key
  api_key_preview?: string;  // API Key 脱敏显示 (前4字符)
}
```

### 2. AIModelConfig → AIModelConfigSafe

#### ❌ 旧定义

```typescript
interface AIModelConfig {
  id: number;
  name: string;
  display_name: string;
  model_id: string;
  description?: string;
  max_tokens?: number;
  temperature?: number;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  provider: AIProvider;  // ⚠️ 包含敏感信息
}
```

#### ✅ 新定义

```typescript
interface AIModelConfigSafe {
  id: number;
  name: string;
  display_name: string;
  model_id: string;
  description?: string;
  max_tokens?: number;
  temperature?: number;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  provider: AIProviderSafe;  // ✅ 安全类型
}
```

---

## 🔧 需要修改的文件

### 1. 类型定义文件

**文件**: `src/types/ai-model.ts` (或类似位置)

```typescript
// 删除旧类型
// - interface AIProvider
// - interface AIModelConfig

// 添加新类型
export interface AIProviderSafe {
  id: number;
  name: string;
  display_name: string;
  base_url: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  has_api_key: boolean;
  api_key_preview?: string;
}

export interface AIModelConfigSafe {
  id: number;
  name: string;
  display_name: string;
  model_id: string;
  description?: string;
  max_tokens?: number;
  temperature?: number;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  provider: AIProviderSafe;
}
```

### 2. API Service 文件

**文件**: `src/services/aiModelService.ts` (或类似位置)

```typescript
import { invoke } from '@tauri-apps/api/tauri';
import type { AIProviderSafe, AIModelConfigSafe } from '../types/ai-model';

class AIModelService {
  // ✅ 修改返回类型
  async getAIProviders(): Promise<AIProviderSafe[]> {
    return invoke('get_ai_providers');
  }

  async getAllAIProviders(): Promise<AIProviderSafe[]> {
    return invoke('get_all_ai_providers');
  }

  async getAIModels(query?: AIModelQuery): Promise<AIModelConfigSafe[]> {
    return invoke('get_ai_models', { query });
  }

  async getDefaultAIModel(): Promise<AIModelConfigSafe | null> {
    return invoke('get_default_ai_model');
  }
}
```

### 3. 组件文件

#### AIModelSelector 组件

**文件**: `src/components/AIModelSelector/AIModelSelector.tsx`

```typescript
// ❌ 旧代码
const [providers, setProviders] = useState<AIProvider[]>([]);
const [selectedModel, setSelectedModel] = useState<AIModelConfig | null>(null);

// ✅ 新代码
const [providers, setProviders] = useState<AIProviderSafe[]>([]);
const [selectedModel, setSelectedModel] = useState<AIModelConfigSafe | null>(null);
```

#### Settings 页面

**文件**: `src/pages/SettingsPage.tsx` (如果存在)

```typescript
// ❌ 旧代码
const handleProviderSelect = (provider: AIProvider) => {
  console.log('Selected provider:', provider.api_key);  // ⚠️ 不再可用
};

// ✅ 新代码
const handleProviderSelect = (provider: AIProviderSafe) => {
  console.log('Selected provider:', provider.display_name);
  console.log('Has API Key:', provider.has_api_key);
  console.log('API Key Preview:', provider.api_key_preview);  // 脱敏显示
};
```

---

## 🧪 测试检查清单

### 功能测试

- [ ] **AI 模型选择器**
  - [ ] 可以正常加载模型列表
  - [ ] 模型信息正确显示
  - [ ] 选择模型功能正常

- [ ] **设置页面**
  - [ ] AI 提供商列表正常显示
  - [ ] 可以看到提供商是否有 API Key (`has_api_key`)
  - [ ] 可以看到 API Key 预览 (`api_key_preview`)

- [ ] **AI 分析功能**
  - [ ] 单词分析功能正常
  - [ ] 学习计划生成功能正常
  - [ ] 不需要知道完整 API Key

### 回归测试

- [ ] 所有使用 AI 功能的页面正常工作
- [ ] 没有 TypeScript 编译错误
- [ ] 没有运行时错误

---

## 💡 迁移建议

### 1. 渐进式迁移

**步骤1**: 先更新类型定义
```bash
# 1. 更新 types 文件
# 2. 运行 TypeScript 编译检查
npm run type-check
```

**步骤2**: 使用类型别名过渡
```typescript
// 临时使用类型别名,减少改动
type AIProvider = AIProviderSafe;
type AIModelConfig = AIModelConfigSafe;
```

**步骤3**: 逐步替换使用处
- 按文件逐个替换
- 每替换一个文件就测试
- 最后删除类型别名

### 2. 搜索替换

**使用正则表达式搜索**:
```regex
: AIProvider[\[\]\{\}]
: AIModelConfig[\[\]\{\}]
```

**替换为**:
```regex
: AIProviderSafe$1
: AIModelConfigSafe$1
```

### 3. 验证步骤

```bash
# 1. TypeScript 类型检查
npm run type-check

# 2. ESLint 检查
npm run lint

# 3. 运行应用
npm run tauri:dev

# 4. 测试 AI 功能
# - 打开 AI 模型选择器
# - 查看设置页面
# - 执行单词分析
```

---

## ⚠️ 注意事项

### 1. 不要尝试访问 api_key

```typescript
// ❌ 错误: api_key 字段已不存在
if (provider.api_key) {
  // ...
}

// ✅ 正确: 使用 has_api_key
if (provider.has_api_key) {
  // ...
}
```

### 2. 更新日志输出

```typescript
// ❌ 错误: 不要记录 API Key
console.log('Provider:', provider.api_key);

// ✅ 正确: 使用脱敏字段
console.log('Provider:', provider.api_key_preview);
```

### 3. 调试时使用 api_key_preview

如果需要确认 API Key 是否配置正确:

```typescript
if (provider.has_api_key) {
  console.log('API Key 配置:', provider.api_key_preview);
  // 输出示例: "API Key 配置: sk****"
}
```

---

## 📞 需要帮助?

### 常见问题

**Q: 为什么会有这个变更?**
A: 为了提高安全性,防止 API Key 泄露到前端。

**Q: 我还能看到 API Key 吗?**
A: 不能完整看到,但可以通过 `api_key_preview` 看到前4个字符,用于确认配置。

**Q: 旧代码还能工作吗?**
A: 不能,必须同步更新类型定义,否则会有 TypeScript 错误。

**Q: 需要多久完成迁移?**
A: 预计 1-2 小时,取决于代码量。

### 联系方式

如有问题,请:
1. 查看后端提交记录: `e2499da`
2. 查看类型定义文件: `src-tauri/src/types/ai_model.rs`
3. 联系后端开发团队

---

**文档版本**: 1.0
**更新时间**: 2025-01-03
**作者**: AI 代码审查系统
