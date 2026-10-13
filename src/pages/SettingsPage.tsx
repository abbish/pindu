import React, { useMemo, useState } from 'react';
import { AudioLines, Bot, Cpu, Database, GraduationCap, Laptop, Library, Mic, Search, Settings2, Sparkles, Stethoscope, UserRound, type LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { NavigateFn } from '../navigation';
import { AIModelSettings } from './settings/AIModelSettings';
import { TTSSettings } from './settings/TTSSettings';
import { AgentSettings } from './settings/AgentSettings';
import { LearnerSettings } from './settings/LearnerSettings';
import { TutorSettings } from './settings/TutorSettings';
import { GeneralSettings } from './settings/GeneralSettings';
import { MaterialSettings } from './settings/MaterialSettings';
import { DataManagementSettings } from './settings/DataManagementSettings';
import { LanSettings } from './settings/LanSettings';
import { VoiceSettings } from './settings/VoiceSettings';
import { LocalModelsSettings } from './settings/LocalModelsSettings';
import { DiagnosticsSettings } from './settings/DiagnosticsSettings';

export interface SettingsPageProps {
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

type SettingsKey = 'general' | 'learner' | 'voice' | 'materials' | 'tutor' | 'ai-models' | 'agent' | 'tts' | 'local-models' | 'devices' | 'data-management' | 'diagnostics';

interface NavItem {
  key: SettingsKey;
  label: string;
  icon: LucideIcon;
  /** 搜索用的关键词（设置项名称） */
  keywords: string[];
}

const STORAGE_KEY = 'settings.activePanel';

/**
 * 四组：通用；学习偏好（功能怎么表现）；服务与模型（要先配好的基础依赖：AI 服务、语音服务、本机模型）；数据与系统。
 */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '通用',
    items: [{ key: 'general', label: '通用', icon: Settings2, keywords: ['外观', '主题', '深色', '浅色', '暗色', '更新', '版本'] }],
  },
  {
    title: '学习偏好',
    items: [
      { key: 'learner', label: '学习者', icon: UserRound, keywords: ['小学生', '中学生', '成人', '水平', '讲解语言', '详略', '记忆方法', '音标', '兴趣'] },
      { key: 'voice', label: '朗读与发音', icon: AudioLines, keywords: ['音色', '朗读风格', '语速', '音调', '音量', '试听', '发音', '跟读', '评分'] },
      {
        key: 'materials',
        label: '素材与计划',
        icon: Library,
        keywords: ['词汇本', '短文', '视频', '学习计划', '默认', '篇幅', '选词', '拆篇', '阅读理解', '字幕', '每段时长', '每天新词', '间隔'],
      },
      { key: 'tutor', label: 'AI 老师', icon: GraduationCap, keywords: ['人设', '名字', '称呼', '风格', '性格', '幽默', '小问题', '对话', '权限', '删除', '只查看', '推荐'] },
    ],
  },
  {
    title: '服务与模型',
    items: [
      { key: 'ai-models', label: 'AI 服务', icon: Sparkles, keywords: ['AI 模型', '默认模型', '提供商', 'API 密钥', 'key', '模型测试', '思考', 'pi'] },
      { key: 'agent', label: 'AI 任务', icon: Bot, keywords: ['pi', 'agent', 'AI 助手', '任务模型', '拼读', '批量', '并发', '后台', '重试', '429', '限流', '等待', '超时', '提示词', '补充要求'] },
      { key: 'tts', label: '语音服务', icon: Mic, keywords: ['语音合成', '豆包', '火山', '连接', '鉴权', '音质', '缓存', 'tts'] },
      {
        key: 'local-models',
        label: '本机模型',
        icon: Cpu,
        keywords: ['字幕识别', '语音识别', '识别模型', 'whisper', '下载来源', '发音评估', '评估模型', '语音输入', '说话', 'ffmpeg', '视频组件'],
      },
    ],
  },
  {
    title: '数据与系统',
    items: [
      { key: 'devices', label: '附近的设备', icon: Laptop, keywords: ['局域网', '配对', '传送', '互传', '同步', '其他电脑', '设备'] },
      { key: 'data-management', label: '数据管理', icon: Database, keywords: ['数据库', '重置', '删除', '清理', '数据表', '统计'] },
      { key: 'diagnostics', label: '诊断', icon: Stethoscope, keywords: ['系统日志', '日志级别', '诊断'] },
    ],
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
          {active === 'learner' && <LearnerSettings />}
          {active === 'voice' && <VoiceSettings onOpenService={() => setActive('tts')} />}
          {active === 'materials' && <MaterialSettings />}
          {active === 'tutor' && <TutorSettings />}
          {active === 'ai-models' && <AIModelSettings />}
          {active === 'agent' && <AgentSettings />}
          {active === 'tts' && <TTSSettings part="service" />}
          {active === 'local-models' && <LocalModelsSettings />}
          {active === 'devices' && <LanSettings />}
          {active === 'data-management' && <DataManagementSettings />}
          {active === 'diagnostics' && <DiagnosticsSettings />}
        </div>
      </div>
    </div>
  );
};
