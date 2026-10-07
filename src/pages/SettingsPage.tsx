import React, { useMemo, useState } from 'react';
import { Bot, Database, Search, Settings2, Sparkles, Volume2, type LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { NavigateFn } from '../navigation';
import { AIModelSettings } from './settings/AIModelSettings';
import { TTSSettings } from './settings/TTSSettings';
import { AgentSettings } from './settings/AgentSettings';
import { GeneralSettings } from './settings/GeneralSettings';
import { DataManagementSettings } from './settings/DataManagementSettings';

export interface SettingsPageProps {
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

type SettingsKey = 'general' | 'ai-models' | 'agent' | 'tts' | 'data-management';

interface NavItem {
  key: SettingsKey;
  label: string;
  icon: LucideIcon;
  /** 搜索用的关键词（设置项名称） */
  keywords: string[];
}

const STORAGE_KEY = 'settings.activePanel';

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '偏好设置',
    items: [{ key: 'general', label: '通用', icon: Settings2, keywords: ['外观', '主题', '深色', '浅色', '暗色', '系统日志', '诊断'] }],
  },
  {
    title: 'AI 与语音',
    items: [
      { key: 'ai-models', label: 'AI 模型', icon: Sparkles, keywords: ['默认模型', '提供商', 'API 密钥', 'key', '模型测试', 'pi'] },
      { key: 'agent', label: 'AI 助手', icon: Bot, keywords: ['pi', 'agent', '任务模型', '讲解', '答疑', '拼读', '批量', '并发', '429', '限流', '学习者', '提示词', '风格', '成人', '小学生', '老师', '补充要求'] },
      { key: 'tts', label: '语音合成', icon: Volume2, keywords: ['豆包', '火山', '音色', '发音', '语速', '试听', '缓存', 'tts'] },
    ],
  },
  {
    title: '数据',
    items: [{ key: 'data-management', label: '数据管理', icon: Database, keywords: ['数据库', '重置', '删除', '清理', '数据表', '统计'] }],
  },
];

/**
 * 设置（桌面应用的设置窗口模式，外壳由 AppShell 提供）：
 * 左栏 = 标题 + 搜索 + 分组导航；右栏 = 当前面板（分组卡片 + 设置行，见 SettingsLayout）。错误统一用 toast 提示。
 */
export const SettingsPage: React.FC<SettingsPageProps> = () => {
  // 记住上次打开的分类（ui-interaction-patterns.md §5 状态保持）
  const [active, setActiveState] = useState<SettingsKey>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (NAV_GROUPS.some((g) => g.items.some((i) => i.key === saved))) return saved as SettingsKey;
    } catch {
      // 存储不可用时用默认分类
    }
    return 'general';
  });
  const setActive = (key: SettingsKey) => {
    setActiveState(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // 忽略
    }
  };
  const [query, setQuery] = useState('');


  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_GROUPS;
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => [i.label, ...i.keywords].some((k) => k.toLowerCase().includes(q))),
    })).filter((g) => g.items.length > 0);
  }, [query]);
  const firstMatch = groups[0]?.items[0];

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col gap-3 border-r bg-muted/30 px-3 py-5">
        <h1 className="px-2 text-lg font-semibold">设置</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && firstMatch && setActive(firstMatch.key)}
            placeholder="搜索"
            aria-label="搜索设置"
            className="h-8 bg-background pl-8"
          />
        </div>
        <nav className="flex flex-col gap-4 overflow-y-auto" aria-label="设置分类">
          {groups.length === 0 && <p className="px-2 text-sm text-muted-foreground">没有匹配的设置</p>}
          {groups.map((g) => (
            <div key={g.title} className="flex flex-col gap-0.5">
              <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.title}</div>
              {g.items.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActive(key)}
                  aria-current={active === key ? 'page' : undefined}
                  className={cn(
                    'flex h-8 items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:text-muted-foreground',
                    active === key && 'bg-accent font-medium text-accent-foreground hover:bg-accent [&_svg]:text-accent-foreground'
                  )}
                >
                  <Icon />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-10 py-9">
          {active === 'general' && <GeneralSettings />}
          {active === 'ai-models' && <AIModelSettings />}
          {active === 'agent' && <AgentSettings />}
          {active === 'tts' && <TTSSettings />}
          {active === 'data-management' && <DataManagementSettings />}
        </div>
      </div>
    </div>
  );
};
