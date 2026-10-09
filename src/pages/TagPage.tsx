import React, { useState } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { usePageTitle } from '@/components/AppShell/pageTitle';
import { useTagUsage } from '@/hooks/useTagUsage';
import type { TagUsage } from '@/types/material';
import type { NavigateFn } from '@/navigation';
import { PassageLibraryPage } from './PassageLibraryPage';
import { VideoLibraryPage } from './VideoLibraryPage';
import { WordBookPage } from './WordBookPage';

export interface TagPageProps {
  tagId?: number;
  onNavigate: NavigateFn;
}

type Kind = 'clips' | 'passages' | 'wordbooks' | 'videos';

const KINDS: { key: Kind; label: string; count: (t: TagUsage) => number }[] = [
  { key: 'clips', label: '片段', count: (t) => t.clips },
  { key: 'passages', label: '短文', count: (t) => t.passages },
  { key: 'wordbooks', label: '单词本', count: (t) => t.wordBooks },
  { key: 'videos', label: '原始视频', count: (t) => t.videos },
];

/**
 * 标签页（侧边栏「标签」分组进入）：这个标签下的全部素材，按种类分页签；
 * 每个页签就是对应素材库的列表（搜索、筛选、排序、分页、多选与菜单都一样），标签固定为这一个。
 */
export const TagPage: React.FC<TagPageProps> = ({ tagId, onNavigate }) => {
  const tags = useTagUsage();
  const tag = tags?.find((t) => t.id === tagId);
  usePageTitle(tag?.name);
  const kinds = tag ? KINDS.filter((k) => k.count(tag) > 0) : [];
  const [picked, setPicked] = useState<Kind | null>(null);
  const kind = kinds.find((k) => k.key === picked)?.key ?? kinds[0]?.key;

  const body = () => {
    if (tags === null) return <Skeleton className="h-48 rounded-xl" />;
    if (!tag || tagId === undefined) return <EmptyState icon={<TagIcon />} title="这个标签已经不在了" />;
    if (!kind) return <EmptyState icon={<TagIcon />} title="这个标签下还没有素材" />;
    switch (kind) {
      case 'clips':
        return <VideoLibraryPage key={`clips-${tagId}`} tab="clips" tagId={tagId} onNavigate={onNavigate} />;
      case 'videos':
        return <VideoLibraryPage key={`videos-${tagId}`} tab="sources" tagId={tagId} onNavigate={onNavigate} />;
      case 'passages':
        return <PassageLibraryPage key={tagId} tagId={tagId} onNavigate={onNavigate} />;
      case 'wordbooks':
        return <WordBookPage key={tagId} tagId={tagId} onNavigate={onNavigate} />;
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7">
      <PageHeader title={tag?.name ?? '标签'} />
      {kinds.length > 0 && (
        <Tabs value={kind} onValueChange={(v) => setPicked(v as Kind)}>
          <TabsList>
            {kinds.map((k) => (
              <TabsTrigger key={k.key} value={k.key}>
                {k.label}
                <span className="text-muted-foreground tabular-nums">{tag && k.count(tag)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {body()}
    </div>
  );
};
