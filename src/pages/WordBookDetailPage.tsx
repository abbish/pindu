import React, { useRef, useCallback, useEffect, useState } from 'react';
import { WordMaterialsSheet } from '@/components/WordMaterialsSheet/WordMaterialsSheet';
import { tagService } from '@/services/tagService';
import type { WordMaterialCount } from '@/types/material';
import type { WordQuery } from '@/types/wordbook';
import { ChevronDown, FileUp, ListChecks, Loader2, MoreHorizontal, PanelLeft, Pencil, PencilLine, Plus, Sparkles, Table2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/Toast/ToastContainer';
import { WordListTable, type WordDetail as WordListDetail } from '@/components/WordListTable';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { WordBookFormDialog } from '@/components/WordBookFormDialog/WordBookFormDialog';
import { WordFormDialog } from '@/components/WordFormDialog/WordFormDialog';
import { BatchDeleteModal } from '@/components/BatchDeleteModal';
import { AddWordsDialog, type AddWordsSource } from '@/components/AddWordsDialog/AddWordsDialog';
import { PASSAGE_SORTS, PassageList } from '@/components/PassageList';
import { SortSelect, useSortPref } from '@/components/SortSelect';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { WordBookIcon } from '@/components/WordBookIcon/WordBookIcon';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WordCardsView } from './wordbook-detail/WordCardsView';
import { usePageTitle } from '@/components/AppShell/pageTitle';
import { wordBookService } from '@/services';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useOnJobFinished } from '@/hooks/useJobs';
import { formatDate } from '@/utils/datetime';
import { getStatusDisplay } from '@/types/study';
import {
  type StudyPlanWithProgress,
  type UnifiedStudyPlanStatus,
  type Word,
  type WordBook,
  type WordTypeDistribution,
} from '@/types';
import type { NavigateFn } from '@/navigation';
import { PageError } from '@/components/PageError';
import { InlineError } from '@/components/InlineError';


/** 后端单词 → 表格行 */
const toRow = (word: Word): WordListDetail => ({
  id: word.id,
  word: word.word,
  meaning: word.meaning,
  partOfSpeech: (word.part_of_speech || 'n.') as WordListDetail['partOfSpeech'],
  ipa: word.ipa || '',
  syllables: word.syllables || '',
  exampleSentence: word.examples?.[0]?.sentence,
  exampleTranslation: word.examples?.[0]?.translation,
  exampleCount: word.examples?.length ?? 0,
});

const PAGE_SIZE = 20;

const WORD_SORTS = [
  { value: 'word', label: '字母顺序' },
  { value: 'newest', label: '最近添加' },
  { value: 'oldest', label: '最早添加' },
];

export interface WordBookDetailPageProps {
  /** 单词本ID */
  id?: number;
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

/**
 * 单词本详情（shadcn，外壳由 AppShell 提供）：头部信息与操作、词性统计、单词表（分页 / 勾选批删 / 行操作）、关联计划。
 * 功能清单见 .claude/work/ui-shadcn-migration/feature-inventory.md §7。
 */
export const WordBookDetailPage: React.FC<WordBookDetailPageProps> = ({ id, onNavigate }) => {
  const audioPlayer = useAudioPlayer();
  const toast = useToast();

  const [wordBook, setWordBook] = useState<WordBook | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [statistics, setStatistics] = useState<WordTypeDistribution | null>(null);
  const [linkedPlans, setLinkedPlans] = useState<StudyPlanWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkedPlansLoading, setLinkedPlansLoading] = useState(false);
  const [wordsLoading, setWordsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalWords, setTotalWords] = useState(0);

  // 弹窗
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  /** 添加单词弹窗：null 为关闭，否则为打开时的来源 */
  const [addWordsSource, setAddWordsSource] = useState<AddWordsSource | null>(null);
  /** 单词表单：null 关闭；{ word: null } 手动添加；{ word } 编辑 */
  const [wordForm, setWordForm] = useState<{ word: Word | null } | null>(null);
  const [wordsToDelete, setWordsToDelete] = useState<WordListDetail[]>([]);
  const [batchDeleteError, setBatchDeleteError] = useState<string | null>(null);
  /** 页签（生成短文后切到「短文」） */
  const [tab, setTab] = useState('words');
  const [materials, setMaterials] = useState<Map<number, WordMaterialCount>>(new Map());
  const [materialsOf, setMaterialsOf] = useState<{ id: number; word: string } | null>(null);
  const [passageCount, setPassageCount] = useState<number | null>(null);
  const [passageSort, setPassageSort] = useSortPref('passages', PASSAGE_SORTS);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);

  usePageTitle(wordBook?.title);

  /** 单词的显示方式：卡片（默认，逐个学）/ 表格（批量选择与操作）；记在本机 */
  const [wordView, setWordView] = useState<'cards' | 'table'>(() => {
    try {
      return localStorage.getItem('pindu.wordbook.view') === 'table' ? 'table' : 'cards';
    } catch {
      return 'cards';
    }
  });
  const changeWordView = (v: 'cards' | 'table') => {
    setWordView(v);
    try {
      localStorage.setItem('pindu.wordbook.view', v);
    } catch {
      // 只影响下次打开
    }
  };

  // 单词排序（后端排）：记在本机；用 ref 让 loadWords 不随排序重建
  const [wordSort, setWordSortPref] = useSortPref('words', WORD_SORTS);
  const wordSortRef = useRef(wordSort);

  // 快速翻页时只采用最后一次请求的结果
  const wordsRequest = useRef(0);
  const loadWords = useCallback(
    async (page: number): Promise<void> => {
      if (!id) return;
      const seq = ++wordsRequest.current;
      setWordsLoading(true);
      const result = await wordBookService.getWordsByBookId(id, { sortBy: wordSortRef.current as WordQuery['sortBy'] }, { page, page_size: PAGE_SIZE });
      if (seq !== wordsRequest.current) return;
      if (result.success) {
        // 删掉最后一页的全部单词后，这一页已经不存在：退回到现在的最后一页
        const lastPage = Math.max(1, Math.ceil(result.data.total / PAGE_SIZE));
        if (result.data.data.length === 0 && page > lastPage) {
          setWordsLoading(false);
          return loadWords(lastPage);
        }
        setWords(result.data.data);
        setTotalWords(result.data.total);
        setCurrentPage(result.data.page);
      } else {
        toast.showError('无法加载单词列表', result.error);
      }
      setWordsLoading(false);
    },
    [id, toast]
  );

  const loadStatistics = useCallback(async () => {
    if (!id) return;
    const result = await wordBookService.getWordBookTypeStatistics(id);
    // 统计失败不影响主要功能
    if (result.success && result.data) setStatistics(result.data);
  }, [id]);

  /** 读取单词本；失败返回原因 */
  const loadWordBook = useCallback(async (): Promise<string | null> => {
    if (!id) return '没有指定要打开的单词本';
    const result = await wordBookService.getWordBookById(id);
    if (!result.success) return result.error;
    if (!result.data) return '它可能已被删除';
    setWordBook(result.data);
    return null;
  }, [id]);

  const loadLinkedPlans = useCallback(async () => {
    if (!id) return;
    setLinkedPlansLoading(true);
    const result = await wordBookService.getWordBookLinkedPlans(id);
    if (result.success) {
      setLinkedPlans(result.data);
    } else {
      toast.showError('无法加载关联计划', result.error);
    }
    setLinkedPlansLoading(false);
  }, [id, toast]);

  const loadAll = useCallback(async () => {
    if (!id) {
      setError('没有指定要打开的单词本');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const loadError = await loadWordBook();
    if (loadError) {
      setError(loadError);
      setLoading(false);
      return;
    }
    await Promise.all([loadWords(1), loadStatistics(), loadLinkedPlans()]);
    setLoading(false);
  }, [id, loadWordBook, loadWords, loadStatistics, loadLinkedPlans]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 每个词出现在几个视频片段 / 短文里（次要信息，失败时不显示）
  useEffect(() => {
    if (!id) return;
    tagService.getBookWordMaterials(id).then((r) => r.success && setMaterials(new Map(r.data.map((c) => [c.wordId, c]))));
  }, [id, totalWords]);

  /** 单词变动后：刷新当前页、统计、单词本计数 */
  const refreshAfterWordChange = async () => {
    await Promise.all([loadWords(currentPage), loadStatistics(), loadWordBook()]);
  };

  // 「分析并加入单词本」是后台任务：这本单词本的任务结束时刷新（弹窗关了也一样）
  useOnJobFinished((job) => {
    if (job.kind === 'word_analysis' && (job.link?.params as { id?: number } | undefined)?.id === wordBook?.id) {
      void refreshAfterWordChange();
    }
  });

  const handleEditWord = (row: WordListDetail) => {
    // 当前页已有完整单词数据
    const word = words.find((w) => w.id === row.id);
    if (word) setWordForm({ word });
    else toast.showError('无法编辑这个单词', '单词列表可能已变化，请刷新后再试');
  };

  const handleConfirmBatchDelete = async () => {
    if (!wordBook || wordsToDelete.length === 0) return;
    setBatchDeleteLoading(true);
    setBatchDeleteError(null);
    // 后端单事务：要么全部删除，要么一个都不删
    const result = await wordBookService.deleteWords(
      wordBook.id,
      wordsToDelete.map((w) => w.id)
    );
    setBatchDeleteLoading(false);
    if (!result.success) {
      setBatchDeleteError(result.error);
      return;
    }
    toast.showSuccess(`已删除 ${result.data} 个单词`);
    setWordsToDelete([]);
    await refreshAfterWordChange();
  };


  /** 删除单词本：软删除，提示里可以撤销（已删除的也能在单词本列表的“已删除”里恢复） */
  const handleConfirmDelete = async () => {
    if (!wordBook) return;
    setDeleteLoading(true);
    setDeleteError(null);
    const result = await wordBookService.deleteWordBook(wordBook.id);
    setDeleteLoading(false);
    if (!result.success) {
      // 后端会说明原因（例如正在被哪些计划使用）
      setDeleteError(result.error);
      return;
    }
    setShowDeleteModal(false);
    const { id: bookId, title } = wordBook;
    toast.showToast({
      type: 'success',
      title: `已删除「${title}」`,
      action: {
        label: '撤销',
        onClick: async () => {
          const restored = await wordBookService.restoreWordBook(bookId);
          if (restored.success) {
            toast.showSuccess(`已恢复「${title}」`);
            onNavigate?.('wordbook-detail', { id: bookId });
          } else {
            toast.showError('无法恢复单词本', restored.error);
          }
        },
      },
    });
    onNavigate?.('wordbooks');
  };

  const container = 'mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7';

  if (loading) {
    return (
      <div className={container}>
        <Skeleton className="h-14 w-96" />
        <div className="grid grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (error || !wordBook) {
    return (
      <div className={container}>
        <PageError
          title="无法打开这个单词本"
          message={error ?? '它可能已被删除'}
          onRetry={loadAll}
          back={{ label: '返回单词本', onClick: () => onNavigate?.('wordbooks') }}
        />
      </div>
    );
  }

  const typeStats = statistics ?? { nouns: 0, verbs: 0, adjectives: 0, others: 0 };
  const metrics = [
    { label: '单词总数', value: wordBook.total_words || 0, unit: '个' },
    { label: '名词', value: typeStats.nouns, unit: '个' },
    { label: '动词', value: typeStats.verbs, unit: '个' },
    { label: '形容词', value: typeStats.adjectives, unit: '个' },
    { label: '其他', value: typeStats.others, unit: '个' },
  ];

  const sortControl = totalWords > 1 && (
    <SortSelect
      value={wordSort}
      options={WORD_SORTS}
      onChange={(v) => {
        setWordSortPref(v);
        wordSortRef.current = v;
        void loadWords(1);
      }}
    />
  );
  const viewToggle = (
    <ToggleGroup type="single" value={wordView} onValueChange={(v) => v && changeWordView(v as 'cards' | 'table')} className="rounded-lg bg-muted p-0.5" aria-label="显示方式">
      <ToggleGroupItem value="cards" className="h-7 rounded-md px-2.5 data-[state=on]:bg-background data-[state=on]:shadow-sm" aria-label="卡片" title="卡片">
        <PanelLeft />
      </ToggleGroupItem>
      <ToggleGroupItem value="table" className="h-7 rounded-md px-2.5 data-[state=on]:bg-background data-[state=on]:shadow-sm" aria-label="表格" title="表格">
        <Table2 />
      </ToggleGroupItem>
    </ToggleGroup>
  );
  const addWordsMenu = (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    <Plus />
                    添加单词
                    <ChevronDown className="opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={() => setAddWordsSource('ai')}>
                    <Sparkles />
                    AI 生成单词…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAddWordsSource('text')}>
                    <FileUp />
                    从文本提取…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setWordForm({ word: null })}>
                    <PencilLine />
                    手动添加…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
  );

  return (
    <div className={container}>
      {/* 头部：图标 + 名称 / 状态 / 标签 / 时间 + 操作 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <WordBookIcon icon={wordBook.icon} color={wordBook.icon_color} className="size-12 rounded-xl [&_svg]:size-6" />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{wordBook.title}</h1>
              {wordBook.tags.map((tag) => (
                <Badge key={tag.id} variant="secondary">
                  {tag.name}
                </Badge>
              ))}
            </div>
            {wordBook.description && <p className="text-sm text-muted-foreground select-text">{wordBook.description}</p>}
            <p className="text-xs text-muted-foreground">
              创建于 {formatDate(wordBook.created_at) || '未知'} · 更新于 {formatDate(wordBook.updated_at) || '—'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => setShowEditModal(true)}>
            <Pencil />
            编辑
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="更多操作">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setDeleteError(null);
                  setShowDeleteModal(true);
                }}
              >
                <Trash2 />
                删除单词本…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <section aria-label="词性统计" className="grid grid-cols-5 gap-3">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </section>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="words" className="gap-1.5 px-3">
            单词<span className="text-xs text-muted-foreground tabular-nums">{totalWords}</span>
          </TabsTrigger>
          <TabsTrigger value="plans" className="gap-1.5 px-3">
            关联计划<span className="text-xs text-muted-foreground tabular-nums">{linkedPlans.length}</span>
          </TabsTrigger>
          <TabsTrigger value="passages" className="gap-1.5 px-3">
            短文{passageCount != null && <span className="text-xs text-muted-foreground tabular-nums">{passageCount}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="words">
          {totalWords === 0 && !wordsLoading ? (
            <EmptyState
              icon={<Sparkles />}
              title="这个单词本还没有单词"
            >
              <div className="flex gap-2">
                <Button onClick={() => setAddWordsSource('ai')}>
                  <Sparkles />
                  AI 生成单词
                </Button>
                <Button variant="outline" onClick={() => setAddWordsSource('text')}>
                  <FileUp />
                  从文本提取
                </Button>
                <Button variant="ghost" onClick={() => setWordForm({ word: null })}>
                  <PencilLine />
                  手动添加
                </Button>
              </div>
            </EmptyState>
          ) : (
          wordView === 'cards' ? (
            <div className="flex flex-col gap-3">
              <div className="flex min-h-9 flex-wrap items-center gap-2">
                <div className="flex flex-1 items-baseline gap-2">
                  <h3 className="text-base font-semibold">单词列表</h3>
                  <span className="text-sm text-muted-foreground tabular-nums">共 {totalWords} 个单词</span>
                </div>
                {sortControl}
                {viewToggle}
                {addWordsMenu}
              </div>
              <WordCardsView
                words={words}
                loading={wordsLoading}
                pagination={{ current: currentPage, pageSize: PAGE_SIZE, total: totalWords, onChange: loadWords }}
                materials={materials}
                onEdit={(w) => setWordForm({ word: w })}
                onDelete={(w) => setWordsToDelete([toRow(w)])}
                onPassage={(w) => onNavigate?.('create-passage', { bookIds: [wordBook.id], wordIds: [w.id] })}
                onOpenPassage={(passageId, isClip) => onNavigate?.('passage-detail', { passageId, clip: isClip || undefined })}
              />
            </div>
          ) : (
          <WordListTable
            words={words.map(toRow)}
            onPlayPronunciation={(w) => audioPlayer.playWord(w.word)}
            onPlayExample={(w) => {
              if (w.exampleSentence) audioPlayer.playSentence(w.exampleSentence).catch(() => {});
            }}
            onEditWord={handleEditWord}
            onDeleteWord={(w) => setWordsToDelete([w])}
            onBatchDelete={setWordsToDelete}
            materials={materials}
            onOpenMaterials={(w) => setMaterialsOf({ id: w.id, word: w.word })}
            onBatchPassage={(picked) => onNavigate?.('create-passage', { bookIds: [wordBook.id], wordIds: picked.map((w) => w.id) })}
            addAction={addWordsMenu}
            loading={wordsLoading}
            pagination={{ current: currentPage, pageSize: PAGE_SIZE, total: totalWords, onChange: loadWords }}
            toolbarExtra={<>{sortControl}{viewToggle}</>}
          />
          )
          )}
        </TabsContent>

        <TabsContent value="plans">
          {linkedPlansLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : linkedPlans.length === 0 ? (
            <EmptyState icon={<ListChecks />} title="还没有学习计划用到这个单词本" />
          ) : (
            <div className="flex flex-col gap-3">
              {linkedPlans.map((plan) => {
                const planStatus = getStatusDisplay((plan.unified_status || 'Draft') as UnifiedStudyPlanStatus);
                const progress = plan.progress_percentage ?? 0;
                return (
                  <Card key={plan.id} className="flex-row items-center gap-6 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold">{plan.name}</span>
                        <Badge variant="secondary">{planStatus.text}</Badge>
                      </div>
                      <div className="mt-0.5 truncate text-sm text-muted-foreground">
                        {[plan.description, `${plan.total_words || 0} 个单词`, `周期 ${plan.study_period_days || 0} 天`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="w-48 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">学习进度</span>
                        <span className="tabular-nums">{progress.toFixed(1)}%</span>
                      </div>
                      <Progress value={progress} className="h-1.5 [&>[data-slot=progress-indicator]]:bg-brand" />
                    </div>
                    <Button variant="outline" onClick={() => onNavigate?.('plan-detail', { planId: plan.id })}>
                      查看详情
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* forceMount：页签计数在首次打开前也能显示 */}
        <TabsContent value="passages" forceMount className="data-[state=inactive]:hidden">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-end gap-2">
              {(passageCount ?? 0) > 1 && <SortSelect value={passageSort} options={PASSAGE_SORTS} onChange={setPassageSort} className="mr-auto" />}
              {totalWords > 0 && (
                <Button variant="outline" onClick={() => onNavigate?.('create-passage', { bookIds: [wordBook.id] })}>
                  <Plus />
                  用本单词本生成短文
                </Button>
              )}
            </div>
            <PassageList
              bookId={wordBook.id}
              sortBy={passageSort}
              onOpen={(passageId) => onNavigate?.('passage-detail', { passageId })}
              onCountChange={setPassageCount}
            />
          </div>
        </TabsContent>
      </Tabs>


      <WordBookFormDialog isOpen={showEditModal} onClose={() => setShowEditModal(false)} wordBook={wordBook} onSaved={() => loadWordBook()} />
      <AlertDialog open={showDeleteModal} onOpenChange={(open) => !open && !deleteLoading && setShowDeleteModal(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{wordBook.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              单词本和其中的 {wordBook.total_words || 0} 个单词会移到「已删除」，可以从那里恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <InlineError title="无法删除单词本">{deleteError}</InlineError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteLoading}
              onClick={(e) => {
                e.preventDefault(); // 失败时保持打开以显示原因
                handleConfirmDelete();
              }}
            >
              {deleteLoading && <Loader2 className="animate-spin" />}
              删除单词本
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <WordFormDialog
        isOpen={wordForm !== null}
        onClose={() => setWordForm(null)}
        bookId={wordBook.id}
        word={wordForm?.word}
        onSaved={refreshAfterWordChange}
      />
      <AddWordsDialog
        isOpen={addWordsSource !== null}
        onClose={() => setAddWordsSource(null)}
        bookId={wordBook.id}
        bookTitle={wordBook.title}
        bookDescription={wordBook.description}
        onSceneSaved={(description) => setWordBook((prev) => (prev ? { ...prev, description } : prev))}
        initialSource={addWordsSource ?? 'ai'}
      />
      <BatchDeleteModal
        isOpen={wordsToDelete.length > 0}
        onClose={() => {
          setWordsToDelete([]);
          setBatchDeleteError(null);
        }}
        onConfirm={handleConfirmBatchDelete}
        words={wordsToDelete}
        deleting={batchDeleteLoading}
        error={batchDeleteError}
      />
      <WordMaterialsSheet word={materialsOf} onClose={() => setMaterialsOf(null)} onOpenPassage={(passageId, isClip) => onNavigate?.('passage-detail', { passageId, clip: isClip || undefined })} />
    </div>
  );
};
