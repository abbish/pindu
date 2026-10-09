import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, FileText, Clapperboard, FileUp, ListChecks, SearchX, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { byInstant, byNumber, byText, sortItems, type SortOption } from '@/utils/sorting';
import { ListPagination, usePagination } from '@/components/ListPagination';
import { PageError } from '@/components/PageError';
import { cn } from '@/lib/utils';
import { TagChips } from '@/components/MaterialToolbar/MaterialToolbar';
import { JobProgress, activeJobFor } from '@/components/Jobs';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { isJobActive, type Job } from '@/types/job';
import {
  BatchDeleteButton,
  BatchDeleteDialog,
  BatchTagButton,
  CardMenu,
  CardMenuButton,
  SelectCheckbox,
  SelectionBar,
  useSelection,
  type CardAction,
  type Selection,
} from '@/components/MaterialSelection/MaterialSelection';
import { passageService } from '@/services/passageService';
import { formatRelative } from '@/utils/datetime';
import { LEVEL_LABEL, MODE_LABEL, scopeDetailLabel, scoreSummary } from '@/utils/passage';
import type { PassageOrigin, PassageSource, PassageSummary } from '@/types/passage';

export interface PassageListProps {
  /** 只看引用了这个单词本的短文 */
  bookId?: number;
  /** 按标题或目标词筛选 */
  query?: string;
  /** 只看 AI 写的 / 导入的材料 */
  origin?: PassageOrigin;
  /** 只看带这个标签的 */
  tagId?: number;
  /** 排序项（PASSAGE_SORTS 的 value），默认最近添加 */
  sortBy?: string;
  /** 列表上方的工具栏；勾选短文后换成选择栏（与其它素材页一致） */
  toolbar?: React.ReactNode;
  /** 导入我的材料（空状态的次要操作） */
  onImport?: () => void;
  /** 打开短文详情 */
  onOpen: (passageId: number) => void;
  /** 新建短文（空状态的主操作） */
  onCreate?: () => void;
  /** 列表数量（页签计数） */
  onCountChange?: (count: number) => void;
  /** 空状态说明 */
  emptyDescription?: string;
}

/** 来源标签：单词本 / 计划（已删除的来源划线） */
export const SourceBadge: React.FC<{ source: PassageSource }> = ({ source }) => (
  <Badge variant="outline" className={cn('font-normal', !source.exists && 'text-muted-foreground line-through')} title={source.exists ? undefined : '来源已删除'}>
    {source.kind === 'book' ? <BookOpen /> : <ListChecks />}
    {source.name}
    {source.kind === 'plan' && source.detail && <span className="text-muted-foreground">· {scopeDetailLabel(source.detail)}</span>}
  </Badge>
);

/** 短文卡片：整张可点进入详情（选择状态下点击即勾选）；⋯ 菜单与右键菜单是同一组操作，悬停左上角可勾选 */
const PassageCard: React.FC<{ passage: PassageSummary; selection: Selection; onOpen: () => void; onDelete: () => void; job?: Job }> = ({ passage: p, selection, onOpen, onDelete, job }) => {
  const checked = selection.selected.has(p.id);
  const actions: CardAction[] = [
    { label: '打开', icon: <FileText />, onSelect: onOpen },
    { label: '删除短文…', icon: <Trash2 />, onSelect: onDelete, destructive: true, separator: true },
  ];
  return (
    <CardMenu actions={actions}>
        <Card
          className={cn('group relative cursor-default gap-3 px-5 py-4 transition-colors select-none hover:border-ring/60', checked && 'border-primary ring-2 ring-primary/30')}
          onClick={() => (selection.selecting ? selection.toggle(p.id) : onOpen())}
        >
          <SelectCheckbox checked={checked} selecting={selection.selecting} onToggle={() => selection.toggle(p.id)} label={`选择「${p.title}」`} className="top-1.5 left-1.5" />
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{p.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {LEVEL_LABEL[p.level] ?? p.level} · {p.wordCount} 词 · {formatRelative(p.createdAt)}
              </div>
            </div>
            <CardMenuButton actions={actions} className="size-8" />
          </div>
          {p.origin !== 'generated' ? (
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline" className="max-w-full font-normal" title={p.sourceLabel ?? undefined}>
                {p.origin === 'video' ? <Clapperboard /> : <FileUp />}
                <span className="truncate">
                  {p.origin === 'video' ? '视频' : '我的材料'}
                  {p.sourceLabel ? ` · ${p.sourceLabel}` : ''}
                </span>
              </Badge>
            </div>
          ) : (
            p.sources.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.sources.map((s) => (
                  <SourceBadge key={`${s.kind}-${s.refId}`} source={s} />
                ))}
              </div>
            )
          )}
          <TagChips tags={p.tags} />
          <div className="flex flex-wrap gap-1">
            {p.targetWords.slice(0, 12).map((w) => (
              <span key={w.word} className={cn('rounded-full px-2 py-0.5 text-xs', w.required ? 'bg-accent text-accent-foreground' : 'bg-muted')}>
                {w.word}
              </span>
            ))}
            {p.targetWords.length > 12 && <span className="px-1 text-xs text-muted-foreground">+{p.targetWords.length - 12}</span>}
          </div>
          {job ? (
            <JobProgress job={job} fallback="AI 正在出题" />
          ) : (
            <div className="text-xs text-muted-foreground">
              {p.questionSets > 0 ? `${p.questionSets} 套阅读理解题` : '还没有阅读理解题'}
              {p.lastAttempt && ` · 最近一次${MODE_LABEL[p.lastAttempt.mode]}：${scoreSummary(p.lastAttempt)}`}
            </div>
          )}
        </Card>
    </CardMenu>
  );
};

/** 正在写 / 导入的短文（还没入库）：和视频导入一样，先占一张卡片显示进度，写好一篇就出现在列表里 */
const PendingPassageCard: React.FC<{ job: Job }> = ({ job }) => (
  <Card className="gap-3 border-dashed px-5 py-4">
    <div className="min-w-0">
      <div className="truncate text-[15px] font-semibold">{job.title}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {job.kind === 'passage_import' ? '正在导入' : 'AI 正在写'}
        {job.total > 1 && ` · ${job.current}/${job.total} 篇`}
      </div>
    </div>
    <JobProgress job={job} />
  </Card>
);

/** 生成新短文的后台任务 */
const CREATING_KINDS = ['passage_generate', 'passage_import'];

/** 短文列表的排序项（片段同样适用：ClipSummary 继承 PassageSummary） */
export const PASSAGE_SORTS: SortOption<PassageSummary>[] = [
  { value: 'recent', label: '最近添加', compare: byInstant((p) => p.createdAt) },
  { value: 'practiced', label: '最近练习', compare: byInstant((p) => p.lastAttempt?.completedAt) },
  { value: 'name', label: '标题', compare: byText((p) => p.title) },
  { value: 'level', label: '难度由易到难', compare: byText((p) => p.level) },
  { value: 'attempts', label: '练习最多', compare: byNumber((p) => p.completedAttempts) },
];

/** 短文卡片网格（短文库、单词本「短文」页签共用）：加载 / 空 / 错误三态，删除确认；排序由页面控制（sortBy） */
export const PassageList: React.FC<PassageListProps> = ({ bookId, query = '', origin, tagId, sortBy = 'recent', toolbar, onOpen, onCreate, onImport, onCountChange, emptyDescription }) => {
  const [passages, setPassages] = useState<PassageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<PassageSummary[] | null>(null);
  const jobs = useJobs();
  // 新写 / 导入的短文只在短文库首页显示占位（单词本、标签页里的列表不知道新短文归不归它）
  const creating = bookId === undefined && tagId === undefined ? jobs.filter((j) => isJobActive(j) && CREATING_KINDS.includes(j.kind)) : [];

  const load = useCallback(async () => {
    setError(null);
    const result = await passageService.getPassages({ bookId });
    if (result.success) {
      setPassages(result.data);
      onCountChange?.(result.data.length);
    } else {
      setError(result.error);
    }
  }, [bookId, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  // 写好 / 导入好一篇、出完题、任务结束时刷新（新短文出现、题组数变化）
  const createdKey = creating.map((j) => `${j.id}:${j.current}`).join(',');
  useEffect(() => {
    if (createdKey) void load();
  }, [createdKey, load]);
  useOnJobFinished((job) => {
    if ([...CREATING_KINDS, 'question_set'].includes(job.kind)) void load();
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!passages) return passages;
    const shown = passages.filter(
      (p) =>
        (!origin || p.origin === origin) &&
        (tagId === undefined || p.tags.some((t) => t.id === tagId)) &&
        (!q || p.title.toLowerCase().includes(q) || p.targetWords.some((w) => w.word.toLowerCase().includes(q)) || p.tags.some((t) => t.name.toLowerCase().includes(q)))
    );
    return sortItems(shown, PASSAGE_SORTS, sortBy);
  }, [passages, query, origin, tagId, sortBy]);

  const selection = useSelection(useMemo(() => (visible ?? []).map((p) => p.id), [visible]));
  const pager = usePagination(visible, { id: `passages:${bookId ?? 'all'}`, resetKey: `${query.trim()}|${origin ?? ''}|${tagId ?? ''}|${sortBy}` });
  const bar = selection.selecting ? (
    <SelectionBar selection={selection} unit="篇短文">
      <BatchTagButton kind="passage" ids={selection.ids} onDone={load} />
      <BatchDeleteButton count={selection.selected.size} onClick={() => setToDelete((visible ?? []).filter((p) => selection.selected.has(p.id)))} />
    </SelectionBar>
  ) : (
    toolbar
  );

  if (error) return <PageError title="无法加载短文" message={error} onRetry={load} />;
  if (visible === null) {
    return (
      <>
        {toolbar}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </>
    );
  }
  if (passages?.length === 0 && creating.length === 0) {
    return (
      <EmptyState icon={<FileText />} title="还没有短文" description={emptyDescription}>
        <div className="flex gap-2">
          {onCreate && (
            <Button onClick={onCreate}>
              <Sparkles />
              AI 写短文
            </Button>
          )}
          {onImport && (
            <Button variant="outline" onClick={onImport}>
              <FileUp />
              从我的材料导入
            </Button>
          )}
        </div>
      </EmptyState>
    );
  }
  if (visible.length === 0 && creating.length === 0) {
    if (!query.trim() && tagId === undefined && origin === 'imported') {
      return (
        <>
          {toolbar}
          <EmptyState icon={<FileUp />} title="还没有导入的材料">
            {onImport && (
              <Button onClick={onImport}>
                <FileUp />
                从我的材料导入
              </Button>
            )}
          </EmptyState>
        </>
      );
    }
    return (
      <>
        {toolbar}
        <EmptyState icon={<SearchX />} title={query.trim() ? `没有匹配「${query.trim()}」的短文` : '没有这类短文'} />
      </>
    );
  }

  return (
    <>
      {bar}
      <div ref={pager.anchorRef} className="grid scroll-mt-20 grid-cols-2 gap-3 xl:grid-cols-3">
        {pager.page === 1 && creating.map((job) => <PendingPassageCard key={job.id} job={job} />)}
        {(pager.pageItems ?? []).map((p) => (
          <PassageCard key={p.id} passage={p} selection={selection} onOpen={() => onOpen(p.id)} onDelete={() => setToDelete([p])} job={activeJobFor(jobs, ['question_set'], 'passageId', p.id)} />
        ))}
      </div>
      <ListPagination page={pager.page} pageSize={pager.pageSize} total={pager.total} onChange={pager.setPage} hideSinglePage unit="篇" />
      <BatchDeleteDialog
        items={toDelete}
        onClose={() => setToDelete(null)}
        unit="篇短文"
        description="短文、它的阅读理解题和练习记录都会删除；视频片段的视频也会删除，原始视频不受影响。没结束的计划还在用的短文不会删除。"
        nameOf={(p) => p.title}
        remove={(p) => passageService.deletePassage(p.id)}
        onDone={() => {
          selection.clear();
          load();
        }}
      />
    </>
  );
};
