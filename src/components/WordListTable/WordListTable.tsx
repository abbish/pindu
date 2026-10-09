import React, { useEffect, useState } from 'react';
import { Clapperboard, FileText, MessageSquareText, MoreHorizontal, Pencil, Plus, SearchX, Trash2, Volume2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { cn } from '@/lib/utils';
import { partOfSpeechLabel } from '@/utils/partOfSpeech';
import type { WordMaterialCount } from '@/types/material';

/** 单词出现在几个视频片段 / 几篇短文里，点开看是哪些 */
const MaterialCount: React.FC<{ count: WordMaterialCount | undefined; onOpen?: () => void }> = ({ count, onOpen }) =>
  !count || count.clips + count.passages === 0 ? null : (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none"
      onClick={onOpen}
      disabled={!onOpen}
      title={`${count.clips} 个视频片段 · ${count.passages} 篇短文`}
    >
      {count.clips > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Clapperboard className="size-3" />
          {count.clips}
        </span>
      )}
      {count.passages > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <FileText className="size-3" />
          {count.passages}
        </span>
      )}
    </button>
  );

export interface WordDetail {
  /** 单词ID */
  id: number;
  /** 英文单词 */
  word: string;
  /** 中文释义 */
  meaning: string;
  /** 词性 */
  partOfSpeech: 'n.' | 'v.' | 'adj.' | 'adv.' | 'prep.' | 'conj.' | 'int.' | 'pron.';
  /** IPA音标 */
  ipa?: string;
  /** 音节 */
  syllables?: string;
  /** 英文例句 */
  exampleSentence?: string;
  /** 例句中文翻译 */
  exampleTranslation?: string;
  /** 例句总条数（只展示第一条） */
  exampleCount?: number;
}

export interface WordListTableProps {
  /** 单词列表 */
  words: WordDetail[];
  /** 播放发音回调 */
  onPlayPronunciation?: (word: WordDetail) => void;
  /** 朗读例句回调 */
  onPlayExample?: (word: WordDetail) => void;
  /** 编辑单词回调 */
  onEditWord?: (word: WordDetail) => void;
  /** 删除单词回调 */
  onDeleteWord?: (word: WordDetail) => void;
  /** 批量删除回调 */
  onBatchDelete?: (words: WordDetail[]) => void;
  /** 用选中的单词写短文 */
  onBatchPassage?: (words: WordDetail[]) => void;
  /** 添加单词回调 */
  onAddWords?: () => void;
  /** 自定义“添加单词”操作（如带多个入口的下拉菜单），优先于 onAddWords */
  addAction?: React.ReactNode;
  /** 加载状态 */
  loading?: boolean;
  /** 分页信息 */
  pagination?: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
  };
  /** 只读模式：不显示勾选与操作列 */
  readonly?: boolean;
  /** 每个词出现在几个视频片段 / 几篇短文里（wordId → 数量） */
  materials?: Map<number, WordMaterialCount>;
  /** 点数量：看这个词出现在哪些素材里 */
  onOpenMaterials?: (word: WordDetail) => void;
}

/** 词性 → 配色（语义 token；中文名见 utils/partOfSpeech） */
const POS_CLASS: Record<string, string> = {
  'n.': 'bg-chart-1/15 text-foreground',
  'v.': 'bg-chart-2/15 text-foreground',
  'adj.': 'bg-chart-3/20 text-foreground',
  'adv.': 'bg-chart-4/15 text-foreground',
  'prep.': 'bg-chart-5/15 text-foreground',
};

/** 页码：总页数 ≤ 7 全部显示，否则首尾 + 当前附近 + 省略号 */
function pageNumbers(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 'gap', total];
  if (current >= total - 3) return [1, 'gap', total - 4, total - 3, total - 2, total - 1, total];
  return [1, 'gap', current - 1, current, current + 1, 'gap', total];
}

/**
 * 单词列表（shadcn 数据表）：勾选 + 批量删除、行操作（发音 / 例句 / 编辑 / 删除，右键同一组）、分页。
 * 单词本详情与计划详情（只读）共用。
 */
export const WordListTable: React.FC<WordListTableProps> = ({
  words,
  onPlayPronunciation,
  onPlayExample,
  onEditWord,
  onDeleteWord,
  onBatchDelete,
  onBatchPassage,
  onAddWords,
  addAction,
  loading = false,
  pagination,
  readonly = false,
  materials,
  onOpenMaterials,
}) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // 勾选只针对当前页：换页、刷新、筛选后清空，避免计数包含看不见的其它页
  useEffect(() => setSelected(new Set()), [words]);
  const total = pagination ? pagination.total : words.length;
  const allSelected = words.length > 0 && selected.size === words.length;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(words.map((w) => w.id)));
  const batchDelete = () => {
    const picked = words.filter((w) => selected.has(w.id));
    if (picked.length > 0) {
      onBatchDelete?.(picked);
      setSelected(new Set());
    }
  };

  const rowActions = (word: WordDetail, kind: 'dropdown' | 'context') => {
    const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem;
    const Sep = kind === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator;
    return (
      <>
        <Item onSelect={() => onPlayPronunciation?.(word)}>
          <Volume2 />
          播放发音
        </Item>
        {onPlayExample && word.exampleSentence && (
          <Item onSelect={() => onPlayExample(word)}>
            <MessageSquareText />
            朗读例句
          </Item>
        )}
        {onEditWord && (
          <Item onSelect={() => onEditWord(word)}>
            <Pencil />
            编辑单词…
          </Item>
        )}
        {onDeleteWord && (
          <>
            <Sep />
            <Item variant="destructive" onSelect={() => onDeleteWord(word)}>
              <Trash2 />
              删除
            </Item>
          </>
        )}
      </>
    );
  };

  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const firstIndex = pagination ? (pagination.current - 1) * pagination.pageSize + 1 : 1;
  const lastIndex = pagination ? Math.min(pagination.current * pagination.pageSize, pagination.total) : words.length;

  return (
    <div className="flex flex-col gap-3">
      {/* 工具栏：标题 + 选择条 / 添加单词 */}
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        {!readonly && selected.size > 0 ? (
          <div className="flex flex-1 items-center gap-1 rounded-lg border bg-muted px-3 py-1">
            <span className="text-sm font-medium">已选择 {selected.size} 个单词</span>
            <Button variant="ghost" size="sm" onClick={toggleAll}>
              {allSelected ? '取消全选' : '全选'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              清除选择
            </Button>
            <div className="flex-1" />
            {onBatchPassage && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onBatchPassage(words.filter((w) => selected.has(w.id)));
                  setSelected(new Set());
                }}
              >
                <FileText />
                用选中的词写短文
              </Button>
            )}
            {onBatchDelete && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={batchDelete}>
                <Trash2 />
                删除选中（{selected.size}）
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-baseline gap-2">
            <h3 className="text-base font-semibold">单词列表</h3>
            <span className="text-sm text-muted-foreground tabular-nums">共 {total} 个单词</span>
          </div>
        )}
        {addAction ??
          (onAddWords && (
            <Button onClick={onAddWords}>
              <Plus />
              添加单词
            </Button>
          ))}
      </div>

      {!loading && words.length === 0 ? (
        <EmptyState icon={<SearchX />} title="没有单词" />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                {!readonly && (
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="全选单词" disabled={loading} />
                  </TableHead>
                )}
                <TableHead className="w-40">单词</TableHead>
                <TableHead>中文释义</TableHead>
                <TableHead className="w-36">音标</TableHead>
                <TableHead className="w-32">音节</TableHead>
                <TableHead className="w-20">词性</TableHead>
                {!readonly && <TableHead className="w-28 text-right">操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: readonly ? 5 : 7 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : words.map((word) => {
                    const pos = { label: partOfSpeechLabel(word.partOfSpeech), className: POS_CLASS[word.partOfSpeech] ?? 'bg-secondary text-secondary-foreground' };
                    const row = (
                      <TableRow key={word.id} data-state={selected.has(word.id) ? 'selected' : undefined}>
                        {!readonly && (
                          <TableCell>
                            <Checkbox checked={selected.has(word.id)} onCheckedChange={() => toggle(word.id)} aria-label={`选择单词 ${word.word}`} />
                          </TableCell>
                        )}
                        <TableCell className="font-semibold select-text">
                          <div className="flex items-center gap-1.5">
                            {word.word}
                            <MaterialCount count={materials?.get(word.id)} onOpen={onOpenMaterials && (() => onOpenMaterials(word))} />
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal select-text">
                          <div>{word.meaning}</div>
                          {word.exampleSentence && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {word.exampleSentence}
                              {word.exampleTranslation && <span className="ml-1">{word.exampleTranslation}</span>}
                              {(word.exampleCount ?? 0) > 1 && <span className="ml-1 opacity-80">· 共 {word.exampleCount} 条例句</span>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground select-text">{word.ipa || '—'}</TableCell>
                        <TableCell className="font-mono text-xs select-text">{word.syllables || '—'}</TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className={cn('border-transparent', pos.className)}>{word.partOfSpeech}</Badge>
                            </TooltipTrigger>
                            <TooltipContent>{pos.label}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        {!readonly && (
                          <TableCell className="text-right">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-8" aria-label="播放发音" onClick={() => onPlayPronunciation?.(word)}>
                                  <Volume2 />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>播放发音</TooltipContent>
                            </Tooltip>
                            {onPlayExample && word.exampleSentence && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="size-8" aria-label="朗读例句" onClick={() => onPlayExample(word)}>
                                    <MessageSquareText />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>朗读例句</TooltipContent>
                              </Tooltip>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作">
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">{rowActions(word, 'dropdown')}</DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                    return readonly ? (
                      row
                    ) : (
                      <ContextMenu key={word.id}>
                        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                        <ContextMenuContent>{rowActions(word, 'context')}</ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
            </TableBody>
          </Table>

          {pagination && pagination.total > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm">
              <span className="text-muted-foreground tabular-nums">
                显示第 {firstIndex}–{lastIndex} 条，共 {pagination.total} 条
              </span>
              {pageCount > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={pagination.current <= 1} onClick={() => pagination.onChange(pagination.current - 1)}>
                    上一页
                  </Button>
                  {pageNumbers(pagination.current, pageCount).map((p, i) =>
                    p === 'gap' ? (
                      <span key={`gap-${i}`} className="px-1 text-muted-foreground">…</span>
                    ) : (
                      <Button
                        key={p}
                        variant={p === pagination.current ? 'outline' : 'ghost'}
                        size="icon"
                        className={cn('size-8 tabular-nums', p === pagination.current && 'border-primary')}
                        aria-current={p === pagination.current ? 'page' : undefined}
                        onClick={() => pagination.onChange(p)}
                      >
                        {p}
                      </Button>
                    )
                  )}
                  <Button variant="outline" size="sm" disabled={pagination.current >= pageCount} onClick={() => pagination.onChange(pagination.current + 1)}>
                    下一页
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
