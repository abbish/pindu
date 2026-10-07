import React, { useRef, useCallback, useEffect, useState } from 'react';
import { ChevronDown, FileUp, ListChecks, Loader2, MoreHorizontal, Pencil, PencilLine, Plus, Sparkles, Trash2 } from 'lucide-react';
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
import { PassageList } from '@/components/PassageList';
import type { ExtractedWord } from '@/components/WordGrid';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { WordBookIcon } from '@/components/WordBookIcon/WordBookIcon';
import { usePageTitle } from '@/components/AppShell/pageTitle';
import { wordBookService } from '@/services';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { formatDate } from '@/utils/datetime';
import { standardizePartOfSpeech } from '@/utils/partOfSpeech';
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
  const [passageCount, setPassageCount] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);

  usePageTitle(wordBook?.title);

  // 快速翻页时只采用最后一次请求的结果
  const wordsRequest = useRef(0);
  const loadWords = useCallback(
    async (page: number): Promise<void> => {
      if (!id) return;
      const seq = ++wordsRequest.current;
      setWordsLoading(true);
      const result = await wordBookService.getWordsByBookId(id, undefined, { page, page_size: PAGE_SIZE });
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

  /** 单词变动后：刷新当前页、统计、单词本计数 */
  const refreshAfterWordChange = async () => {
    await Promise.all([loadWords(currentPage), loadStatistics(), loadWordBook()]);
  };

  const handleSaveWords = async (selected: ExtractedWord[]) => {
    if (!wordBook) return;
    const analyzedWords = selected.map((word) => {
      const pos = standardizePartOfSpeech(word.phonics?.pos_abbreviation || word.partOfSpeech || 'n.');
      return {
        word: word.word,
        meaning: word.meaning,
        part_of_speech: pos,
        ipa: word.phonics?.ipa || '',
        syllables: word.phonics?.syllables || '',
        phonics_rule: word.phonics?.phonics_rule || '',
        analysis_explanation: word.phonics?.analysis_explanation || '',
        pos_abbreviation: pos,
        pos_english: word.phonics?.pos_english || '',
        pos_chinese: word.phonics?.pos_chinese || '',
        examples: word.phonics?.examples,
      };
    });
    // 批量保存：后端按单词查重并更新
    const result = await wordBookService.createWordBookFromAnalysis({
      title: wordBook.title,
      description: wordBook.description || '',
      words: analyzedWords,
      book_id: wordBook.id,
    });
    // 失败抛回导入弹窗，由弹窗内联显示原因（弹窗保留分析结果，可以直接重试保存），这里不再重复提示
    if (!result.success) throw new Error(result.error);
    await refreshAfterWordChange();
    const { added_count, updated_count } = result.data;
    toast.showSuccess(updated_count > 0 ? `已添加 ${added_count} 个单词，更新 ${updated_count} 个` : `已添加 ${added_count} 个单词`);
  };

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
    { label: '总单词数', value: wordBook.total_words || 0, unit: '个' },
    { label: '名词', value: typeStats.nouns, unit: '个' },
    { label: '动词', value: typeStats.verbs, unit: '个' },
    { label: '形容词', value: typeStats.adjectives, unit: '个' },
    { label: '其他', value: typeStats.others, unit: '个' },
  ];

  return (
    <div className={container}>
      {/* 头部：图标 + 名称 / 状态 / 主题 / 时间 + 操作 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <WordBookIcon icon={wordBook.icon} color={wordBook.icon_color} className="size-12 rounded-xl [&_svg]:size-6" />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{wordBook.title}</h1>
              {wordBook.theme_tags?.map((tag) => (
                <Badge key={tag.id} variant="secondary">
                  <span aria-hidden="true">{tag.icon}</span>
                  {tag.name}
                </Badge>
              ))}
            </div>
            {wordBook.description && <p className="text-sm text-muted-foreground select-text">{wordBook.description}</p>}
            <p className="text-xs text-muted-foreground">
              创建于 {formatDate(wordBook.created_at) || '未知'} · 更新于 {formatDate(wordBook.updated_at) || '未更新'}
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
              description="描述想学的主题让 AI 生成，或从你的材料（粘贴文本、Word、PDF、字幕等）里提取；添加时自动完成拼读分析"
            >
              <div className="flex gap-2">
                <Button onClick={() => setAddWordsSource('ai')}>
                  <Sparkles />
                  AI 生成单词
                </Button>
                <Button variant="outline" onClick={() => setAddWordsSource('text')}>
                  <FileUp />
                  从我的材料提取
                </Button>
                <Button variant="ghost" onClick={() => setWordForm({ word: null })}>
                  <PencilLine />
                  手动添加
                </Button>
              </div>
            </EmptyState>
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
            onBatchPassage={(picked) => onNavigate?.('create-passage', { bookIds: [wordBook.id], wordIds: picked.map((w) => w.id) })}
            addAction={
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
                    AI 生成…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAddWordsSource('text')}>
                    <FileUp />
                    从我的材料提取…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setWordForm({ word: null })}>
                    <PencilLine />
                    手动添加一个单词…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
            loading={wordsLoading}
            pagination={{ current: currentPage, pageSize: PAGE_SIZE, total: totalWords, onChange: loadWords }}
          />
          )}
        </TabsContent>

        <TabsContent value="plans">
          {linkedPlansLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : linkedPlans.length === 0 ? (
            <EmptyState icon={<ListChecks />} title="暂无关联计划" description="用这个单词本创建学习计划后会显示在这里" />
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
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">引用了这个单词本的短文（在「素材库 · 短文库」里统一管理）。</p>
              {totalWords > 0 && (
                <Button variant="outline" onClick={() => onNavigate?.('create-passage', { bookIds: [wordBook.id] })}>
                  <Plus />
                  用这本单词写短文
                </Button>
              )}
            </div>
            <PassageList
              bookId={wordBook.id}
              onOpen={(passageId) => onNavigate?.('passage-detail', { passageId })}
              onCountChange={setPassageCount}
              emptyDescription="还没有引用这个单词本的短文。"
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
              单词本和其中的 {wordBook.total_words || 0} 个单词会移到“已删除”，之后可以在单词本列表的“已删除”里恢复。正在被未结束的学习计划使用时不能删除。
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
        onSaveWords={handleSaveWords}
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
    </div>
  );
};
