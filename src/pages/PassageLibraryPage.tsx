import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronDown, FileQuestion, FileText, FileUp, Headphones, Plus, Search, Sparkles, Target, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { PassageList } from '@/components/PassageList';
import { passageService } from '@/services/passageService';
import { formatDuration } from '@/utils/datetime';
import type { PassageModeStatistics, PassageOrigin, PassageStatistics } from '@/types/passage';
import type { NavigateFn } from '../navigation';

export interface PassageLibraryPageProps {
  onNavigate?: NavigateFn;
}

const percent = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`);

/** 一种练习模式的提示行：次数 · 用时 */
const modeHint = (label: string, m: PassageModeStatistics | undefined) =>
  m && m.attempts > 0 ? `${label} ${m.attempts} 次 · ${formatDuration(m.totalTime)}` : `${label}还没练过`;

/**
 * 素材库 · 短文库：顶部统计（短文 / 题组 / 练习次数 / 阅读与听力正确率）+ 搜索 + 短文卡片网格。
 * 统计与单词练习口径独立；次要数据，加载失败时静默（不挡住列表）。
 */
export const PassageLibraryPage: React.FC<PassageLibraryPageProps> = ({ onNavigate }) => {
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<PassageOrigin | 'all'>('all');
  const [stats, setStats] = useState<PassageStatistics | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const create = () => onNavigate?.('create-passage');

  const loadStats = useCallback(async () => {
    const result = await passageService.getStatistics();
    if (result.success) setStats(result.data);
    setLoadingStats(false);
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const attempts = (stats?.reading.attempts ?? 0) + (stats?.listening.attempts ?? 0);
  const metrics = [
    { label: '短文', value: stats?.totalPassages ?? 0, unit: '篇', icon: FileText, hint: stats ? `练过 ${stats.passages} 篇` : undefined },
    { label: '阅读理解题', value: stats?.totalSets ?? 0, unit: '套', icon: FileQuestion },
    { label: '练习次数', value: attempts, unit: '次', icon: Target, hint: attempts > 0 ? formatDuration((stats?.reading.totalTime ?? 0) + (stats?.listening.totalTime ?? 0)) : undefined },
    { label: '阅读正确率', value: percent(stats?.reading.objectiveAccuracy), icon: BookOpen, hint: modeHint('阅读', stats?.reading) },
    { label: '听力正确率', value: percent(stats?.listening.objectiveAccuracy), icon: Headphones, hint: modeHint('听力', stats?.listening) },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7">
      <PageHeader
        title="短文库"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus />
                新建短文
                <ChevronDown className="opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={create}>
                <Sparkles />
                AI 写短文…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNavigate?.('import-passage')}>
                <FileUp />
                从我的材料导入…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <section aria-label="短文统计" className="grid grid-cols-5 gap-3">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} loading={loadingStats} />
        ))}
      </section>

      <div className="flex items-center gap-3">
      <div className="relative w-72">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题或单词" aria-label="搜索短文" className="px-8" />
        {query && (
          <Button variant="ghost" size="icon" className="absolute top-1/2 right-1 size-7 -translate-y-1/2" aria-label="清空搜索" onClick={() => setQuery('')}>
            <X />
          </Button>
        )}
      </div>
        <ToggleGroup type="single" value={origin} onValueChange={(v) => v && setOrigin(v as PassageOrigin | 'all')} className="rounded-lg bg-muted p-0.5" aria-label="短文来源">
          {(
            [
              ['all', '全部'],
              ['generated', 'AI 写的'],
              ['imported', '我的材料'],
            ] as const
          ).map(([v, label]) => (
            <ToggleGroupItem key={v} value={v} className="h-8 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm">
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* 列表数量变化（删除短文）时刷新统计 */}
      <PassageList query={query} origin={origin === 'all' ? undefined : origin} onCreate={create} onImport={() => onNavigate?.('import-passage')} onCountChange={loadStats} onOpen={(passageId) => onNavigate?.('passage-detail', { passageId })} />
    </div>
  );
};
