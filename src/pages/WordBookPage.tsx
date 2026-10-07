import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Library, Plus, Search, SearchX, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { WordBookFormDialog } from '@/components/WordBookFormDialog/WordBookFormDialog';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { WordBookSummaryCard } from '@/components/WordBookSummaryCard/WordBookSummaryCard';
import { useToast } from '@/components/Toast/ToastContainer';
import { wordBookService } from '@/services/wordbookService';
import { instantMs } from '@/utils/datetime';
import type { ThemeTag, WordBook as DbWordBook } from '@/types';
import type { NavigateFn } from '@/navigation';
import { PageError } from '@/components/PageError';
import { messageOf } from '@/utils/errorHandler';

export interface WordBookPageProps {
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

interface BookItem extends DbWordBook {
  wordTypes: { nouns: number; verbs: number; adjectives: number; others: number };
}

interface Filters {
  /** 搜索关键词（前端按名称、描述过滤） */
  searchTerm: string;
  /** 主题标签 ID，'all' 为不限 */
  theme: string;
  /** 状态（后端过滤），'all' 为不限 */
  status: string;
  /** 排序 */
  sortBy: string;
}

const DEFAULT_FILTERS: Filters = { searchTerm: '', theme: 'all', status: 'all', sortBy: 'default' };

const STATUS_OPTIONS = [
  { value: 'all', label: '所有状态' },
  { value: 'normal', label: '正常' },
  { value: 'deleted', label: '已删除' },
];

const SORT_OPTIONS = [
  { value: 'default', label: '默认排序' },
  { value: 'created_time', label: '按创建时间' },
  { value: 'word_count', label: '按单词数量' },
];

interface PageData {
  stats: { totalBooks: number; totalWords: number; nouns: number; verbs: number; adjectives: number };
  books: BookItem[];
}

/**
 * 单词本列表（shadcn，外壳由 AppShell 提供）：统计 + 搜索 / 主题 / 状态 / 排序 + 单词本卡片。
 * 功能清单见 .claude/work/ui-shadcn-migration/feature-inventory.md §5。
 */
export const WordBookPage: React.FC<WordBookPageProps> = ({ onNavigate }) => {
  const toast = useToast();
  const [creatingBook, setCreatingBook] = useState(false);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [themes, setThemes] = useState<ThemeTag[]>([]);
  const [themesLoading, setThemesLoading] = useState(true);

  const loadWordBookData = useCallback(async (status: string) => {
    setLoading(true);
    setError(null);
    try {

      // “所有状态”不含已删除的单词本，已删除的只在“已删除”筛选里看
      const includeDeleted = status === 'deleted';
      const [statsResult, booksResult] = await Promise.all([
        wordBookService.getWordBookStatistics(),
        wordBookService.getAllWordBooks(includeDeleted, status === 'all' ? undefined : status),
      ]);
      if (!statsResult.success) throw new Error(statsResult.error);
      if (!booksResult.success) throw new Error(booksResult.error);

      // 词性分布由单词本列表一次带出（不再逐本请求统计）
      const books = booksResult.data.map(book => ({
        ...book,
        wordTypes: book.word_types ?? { nouns: 0, verbs: 0, adjectives: 0, others: 0 },
      }));

      const s = statsResult.data;
      setData({
        stats: {
          totalBooks: s.total_books,
          totalWords: s.total_words,
          nouns: s.word_types.nouns,
          verbs: s.word_types.verbs,
          adjectives: s.word_types.adjectives,
        },
        books,
      });
    } catch (err) {
      setError(messageOf(err) ?? '请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRestore = async (id: number) => {
    const result = await wordBookService.restoreWordBook(id);
    if (!result.success) {
      toast.showError('无法恢复单词本', result.error);
      return;
    }
    const title = data?.books.find((b) => b.id === id)?.title;
    toast.showSuccess(title ? `已恢复「${title}」` : '已恢复单词本');
    loadWordBookData(filters.status);
  };

  // 状态筛选走后端，变化时重新加载
  useEffect(() => {
    loadWordBookData(filters.status);
  }, [filters.status, loadWordBookData]);

  // 主题标签
  useEffect(() => {
    wordBookService.getThemeTags().then((result) => {
      if (result.success) setThemes(result.data);
      setThemesLoading(false);
    });
  }, []);

  const filteredBooks = useMemo(() => {
    let books = [...(data?.books ?? [])];
    if (filters.searchTerm) {
      const q = filters.searchTerm.toLowerCase();
      books = books.filter((b) => b.title.toLowerCase().includes(q) || (b.description ?? '').toLowerCase().includes(q));
    }
    if (filters.theme !== 'all') {
      const themeId = Number(filters.theme);
      books = books.filter((b) => b.theme_tags?.some((t) => t.id === themeId) ?? false);
    }
    if (filters.sortBy === 'created_time') {
      books.sort((a, b) => instantMs(b.created_at) - instantMs(a.created_at));
    } else if (filters.sortBy === 'word_count') {
      books.sort((a, b) => b.total_words - a.total_words);
    }
    return books;
  }, [data, filters]);

  const activeFilterCount =
    (filters.searchTerm ? 1 : 0) + (filters.theme !== 'all' ? 1 : 0) + (filters.status !== 'all' ? 1 : 0) + (filters.sortBy !== 'default' ? 1 : 0);
  const isFiltering = Boolean(filters.searchTerm) || filters.theme !== 'all' || filters.status !== 'all';
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const stats = data?.stats;
  const metrics = [
    { label: '单词本总数', value: stats?.totalBooks ?? 0, unit: '本', icon: Library },
    { label: '单词总数', value: stats?.totalWords ?? 0, unit: '个', icon: BookOpen },
    { label: '名词', value: stats?.nouns ?? 0, unit: '个' },
    { label: '动词', value: stats?.verbs ?? 0, unit: '个' },
    { label: '形容词', value: stats?.adjectives ?? 0, unit: '个' },
  ];

  const createAction = (
    <Button onClick={() => setCreatingBook(true)}>
      <Plus />
      创建单词本
    </Button>
  );

  if (error && !data) {
    return (
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7">
        <PageHeader title="我的单词本" description="管理和学习你的单词收藏" actions={createAction} />
        <PageError title="无法加载单词本" message={error} onRetry={() => loadWordBookData(filters.status)} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7">
      <PageHeader title="我的单词本" description="管理和学习你的单词收藏" actions={createAction} />

      <section aria-label="单词本统计" className="grid grid-cols-5 gap-3">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} loading={loading && !data} />
        ))}
      </section>

      {/* 工具栏：搜索 + 主题 + 状态 + 排序 + 重置 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.searchTerm}
            onChange={(e) => setFilter('searchTerm', e.target.value)}
            placeholder="搜索单词本..."
            aria-label="搜索单词本"
            className="px-8"
          />
          {filters.searchTerm && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
              aria-label="清除搜索"
              onClick={() => setFilter('searchTerm', '')}
            >
              <X />
            </Button>
          )}
        </div>
        <Select value={filters.theme} onValueChange={(v) => setFilter('theme', v)} disabled={themesLoading}>
          <SelectTrigger className="w-36" aria-label="主题标签">
            <SelectValue placeholder={themesLoading ? '加载主题…' : '所有主题'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有主题</SelectItem>
            {themes.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilter('status', v)}>
          <SelectTrigger className="w-32" aria-label="状态">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.sortBy} onValueChange={(v) => setFilter('sortBy', v)}>
          <SelectTrigger className="w-36" aria-label="排序">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeFilterCount > 0 && (
          <Button variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
            重置
            <Badge variant="secondary" className="tabular-nums">{activeFilterCount}</Badge>
          </Button>
        )}
        {!loading && (
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">共 {filteredBooks.length} 本</span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : filteredBooks.length === 0 ? (
        isFiltering ? (
          <EmptyState icon={<SearchX />} title="没有找到匹配的单词本" description="尝试调整筛选条件或搜索关键词" />
        ) : (
          <EmptyState
            icon={<BookOpen />}
            title="还没有单词本"
            description="创建你的第一个单词本开始学习吧"
            action="创建单词本"
            actionIcon={<Plus />}
            onAction={() => setCreatingBook(true)}
          />
        )
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {filteredBooks.map((book) => (
            <WordBookSummaryCard
              key={book.id}
              title={book.title}
              description={book.description}
              totalWords={book.total_words || 0}
              linkedPlans={book.linked_plans || 0}
              wordTypes={book.wordTypes}
              createdAt={book.created_at}
              lastUsed={book.last_used}
              icon={book.icon}
              iconColor={book.icon_color}
              status={book.deleted_at ? 'deleted' : book.status}
              // 已删除的单词本没有详情页：只能恢复
              onOpen={() => {
                if (!book.deleted_at) onNavigate?.('wordbook-detail', { id: book.id });
              }}
              onRestore={book.deleted_at ? () => handleRestore(book.id) : undefined}
            />
          ))}
        </div>
      )}
      <WordBookFormDialog isOpen={creatingBook} onClose={() => setCreatingBook(false)} onSaved={(id) => onNavigate?.('wordbook-detail', { id })} />
    </div>
  );
};
