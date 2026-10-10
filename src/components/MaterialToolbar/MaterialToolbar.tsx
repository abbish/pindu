import React, { useEffect, useState } from 'react';
import { Search, Settings2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { tagService } from '@/services/tagService';
import { TagManagerDialog } from '@/components/TagManagerDialog/TagManagerDialog';
import type { MaterialListKind, TagUsage } from '@/types/material';

/**
 * 素材库（词汇本 / 短文库 / 视频库）首页共用的工具栏：搜索 → 标签 → 各自的筛选 → 重置 → 数量。
 * 三个页面的列表交互保持一致，种类专属的筛选作为 children 放在标签后面。
 */
export interface MaterialToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  /** 标签筛选：null 不显示；'all' 或标签 id。onTagsChanged：在「管理标签」里改名 / 合并 / 删除后刷新列表 */
  tag?: { kind: MaterialListKind; value: string; onChange: (value: string) => void; onTagsChanged?: () => void } | null;
  /** 生效的筛选数（含搜索）；大于 0 时显示「重置」 */
  activeCount: number;
  onReset: () => void;
  /** 「共 N 本」之类，加载完才传 */
  countText?: string;
  /** 数量后面的操作（如「连续播放」） */
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export const MaterialToolbar: React.FC<MaterialToolbarProps> = ({ search, onSearch, searchPlaceholder, tag, activeCount, onReset, countText, actions, children }) => (
  <div className="flex flex-wrap items-center gap-2">
    <div className="relative w-72">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="px-8" />
      {search && (
        <Button variant="ghost" size="icon" className="absolute top-1/2 right-1 size-7 -translate-y-1/2" aria-label="清除搜索" onClick={() => onSearch('')}>
          <X />
        </Button>
      )}
    </div>
    {tag && <TagFilter {...tag} />}
    {children}
    {activeCount > 0 && (
      <Button variant="ghost" onClick={onReset}>
        重置
        <Badge variant="secondary" className="tabular-nums">
          {activeCount}
        </Badge>
      </Button>
    )}
    {countText && <span className="ml-auto text-sm text-muted-foreground tabular-nums">{countText}</span>}
    {actions}
  </div>
);

const COUNT_OF: Record<MaterialListKind, (t: TagUsage) => number> = {
  word_book: (t) => t.wordBooks,
  passage: (t) => t.passages,
  clip: (t) => t.clips,
  video: (t) => t.videos,
};

/** 标签筛选：只列这类素材用到的标签（带数量）；旁边是「管理标签」 */
export const TagFilter: React.FC<{ kind: MaterialListKind; value: string; onChange: (value: string) => void; onTagsChanged?: () => void }> = ({
  kind,
  value,
  onChange,
  onTagsChanged,
}) => {
  const [tags, setTags] = useState<TagUsage[] | null>(null);
  const [managing, setManaging] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    tagService.getTags().then((r) => {
      const used = r.success ? r.data.filter((t) => COUNT_OF[kind](t) > 0) : [];
      setTags(used);
      // 选中的标签被删除 / 合并掉了：回到全部
      if (value !== 'all' && !used.some((t) => String(t.id) === value)) onChange('all');
    });
    // value / onChange 只在标签列表变化时核对
  }, [kind, version]);
  return (
    <div className="flex items-center gap-0.5">
    <Select value={value} onValueChange={onChange} disabled={tags === null}>
      <SelectTrigger className="w-36" aria-label="标签">
        <SelectValue placeholder={tags === null ? '加载标签…' : '所有标签'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">所有标签</SelectItem>
        {tags?.map((t) => (
          <SelectItem key={t.id} value={String(t.id)}>
            {t.name}
            <span className="text-muted-foreground tabular-nums">{COUNT_OF[kind](t)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="管理标签" title="管理标签" onClick={() => setManaging(true)}>
        <Settings2 />
      </Button>
      <TagManagerDialog
        open={managing}
        onOpenChange={setManaging}
        onChanged={() => {
          setVersion((v) => v + 1);
          onTagsChanged?.();
        }}
      />
    </div>
  );
};

/** 卡片上的标签（最多 limit 个，多的显示 +N） */
export const TagChips: React.FC<{ tags: { id: number; name: string; icon?: string | null }[]; limit?: number }> = ({ tags, limit = 4 }) =>
  tags.length === 0 ? null : (
    <div className="flex flex-wrap gap-1">
      {tags.slice(0, limit).map((t) => (
        <Badge key={t.id} variant="outline" className="font-normal">
          {t.name}
        </Badge>
      ))}
      {tags.length > limit && <span className="px-1 text-xs text-muted-foreground">+{tags.length - limit}</span>}
    </div>
  );
