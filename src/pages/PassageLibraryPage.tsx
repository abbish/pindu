import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronDown, FileText, FileUp, Headphones, Plus, Sparkles } from 'lucide-react';
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
import type { PassageOrigin, PassageStatistics } from '@/types/passage';
import type { NavigateFn } from '../navigation';

export interface PassageLibraryPageProps {
  onNavigate?: NavigateFn;
  /** 嵌在标签页里：只列这个标签的短文（不显示页头、统计与标签筛选） */
  tagId?: number;
}

const ORIGINS = [
  ['all', '全部来源'],
  ['generated', 'AI 生成'],
  ['imported', '导入'],
] as const;

/**
 * 素材库 · 短文库：顶部统计（短文 / 阅读理解题组 / 听力题组）+ 搜索 + 短文卡片网格。
 * 素材是题库与自由练习，不统计练没练（练习跟踪在学习计划里）；次要数据，加载失败时静默（不挡住列表）。
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

  // 素材是题库与自由练习：只统计素材本身，练习跟踪在学习计划里
  const metrics = [
    { label: '短文', value: stats?.totalPassages ?? 0, unit: '篇', icon: FileText },
    { label: '阅读理解题组', value: stats?.readingSets ?? 0, unit: '套', icon: BookOpen },
    { label: '听力题组', value: stats?.listeningSets ?? 0, unit: '套', icon: Headphones },
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
                AI 生成短文…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNavigate?.('import-passage')}>
                <FileUp />
                从文本导入…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      )}

      <section aria-label="短文统计" className={cn('grid grid-cols-3 gap-3', embedded && 'hidden')}>
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
