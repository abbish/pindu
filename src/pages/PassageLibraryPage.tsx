import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronDown, FileQuestion, FileText, FileUp, Headphones, Plus, Sparkles, Target } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MaterialToolbar } from '@/components/MaterialToolbar/MaterialToolbar';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { PASSAGE_SORTS, PassageList } from '@/components/PassageList';
import { SortSelect, useSortPref } from '@/components/SortSelect';
import { passageService } from '@/services/passageService';
import { formatDuration } from '@/utils/datetime';
import type { PassageModeStatistics, PassageOrigin, PassageStatistics } from '@/types/passage';
import type { NavigateFn } from '../navigation';

export interface PassageLibraryPageProps {
  onNavigate?: NavigateFn;
  /** 嵌在标签页里：只列这个标签的短文（不显示页头、统计与标签筛选） */
  tagId?: number;
}

const ORIGINS = [
  ['all', '全部来源'],
  ['generated', 'AI 写的'],
  ['imported', '我的材料'],
] as const;

const percent = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`);

/** 一种练习模式的提示行：次数 · 用时 */
const modeHint = (label: string, m: PassageModeStatistics | undefined) =>
  m && m.attempts > 0 ? `${label} ${m.attempts} 次 · ${formatDuration(m.totalTime)}` : `${label}还没练过`;

/**
 * 素材库 · 短文库：顶部统计（短文 / 题组 / 练习次数 / 阅读与听力正确率）+ 搜索 + 短文卡片网格。
 * 统计与单词练习口径独立；次要数据，加载失败时静默（不挡住列表）。
 */
export const PassageLibraryPage: React.FC<PassageLibraryPageProps> = ({ onNavigate, tagId }) => {
  const embedded = tagId !== undefined;
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<PassageOrigin | 'all'>('all');
  const [tag, setTag] = useState(embedded ? String(tagId) : 'all');
  const [sortBy, setSortBy] = useSortPref('passages', PASSAGE_SORTS);
  /** 管理标签后重新加载列表（卡片上的标签名变了） */
  const [listVersion, setListVersion] = useState(0);
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
    <div className={embedded ? 'flex flex-col gap-6' : 'mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7'}>
      {!embedded && (
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
      )}

      <section aria-label="短文统计" className={cn('grid grid-cols-5 gap-3', embedded && 'hidden')}>
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} loading={loadingStats} />
        ))}
      </section>


      {/* 列表数量变化（删除短文）时刷新统计 */}
      <PassageList
        key={listVersion}
        toolbar={
        <MaterialToolbar
          search={query}
          onSearch={setQuery}
          searchPlaceholder="搜索标题或单词"
          tag={embedded ? null : { kind: 'passage', value: tag, onChange: setTag, onTagsChanged: () => setListVersion((v) => v + 1) }}
          activeCount={(query ? 1 : 0) + (!embedded && tag !== 'all' ? 1 : 0) + (origin !== 'all' ? 1 : 0)}
          onReset={() => {
            setQuery('');
            if (!embedded) setTag('all');
            setOrigin('all');
          }}
        >
          <Select value={origin} onValueChange={(v) => setOrigin(v as PassageOrigin | 'all')}>
            <SelectTrigger className="w-32" aria-label="来源">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORIGINS.map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SortSelect value={sortBy} options={PASSAGE_SORTS} onChange={setSortBy} />
        </MaterialToolbar>
        }
        query={query} origin={origin === 'all' ? undefined : origin} tagId={tag === 'all' ? undefined : Number(tag)} sortBy={sortBy} onCreate={create} onImport={() => onNavigate?.('import-passage')} onCountChange={loadStats} onOpen={(passageId) => onNavigate?.('passage-detail', { passageId })} />
    </div>
  );
};
