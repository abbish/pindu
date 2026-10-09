import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Library, Pencil, Plus, SearchX, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ListPagination, usePagination } from '@/components/ListPagination';
import { WordBookFormDialog } from '@/components/WordBookFormDialog/WordBookFormDialog';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { WordBookSummaryCard } from '@/components/WordBookSummaryCard/WordBookSummaryCard';
import { useToast } from '@/components/Toast/ToastContainer';
import { wordBookService } from '@/services/wordbookService';
import { byInstant, byNumber, byText, sortItems, type SortOption } from '@/utils/sorting';
import { SortSelect, useSortPref } from '@/components/SortSelect';
import type { WordBook as DbWordBook } from '@/types';
import { MaterialToolbar } from '@/components/MaterialToolbar/MaterialToolbar';
import { BatchDeleteButton, BatchDeleteDialog, BatchTagButton, SelectionBar, useSelection } from '@/components/MaterialSelection/MaterialSelection';
import type { NavigateFn } from '@/navigation';
import { PageError } from '@/components/PageError';
import { messageOf } from '@/utils/errorHandler';

export interface WordBookPageProps {
  /** Navigation handler */
  onNavigate?: NavigateFn;
  /** 嵌在标签页里：只列这个标签的单词本（不显示页头、统计与标签筛选） */
  tagId?: number;
}

interface BookItem extends DbWordBook {
  wordTypes: { nouns: number; verbs: number; adjectives: number; others: number };
}

interface Filters {
  /** 搜索关键词（前端按名称、描述过滤） */
  searchTerm: string;
  /** 主题标签 ID，'all' 为不限 */
  tag: string;
  /** 状态（后端过滤），'all' 为不限 */
  status: string;
}

const DEFAULT_FILTERS: Filters = { searchTerm: '', tag: 'all', status: 'all' };

const STATUS_OPTIONS = [
  { value: 'all', label: '所有状态' },
  { value: 'normal', label: '正常' },
  { value: 'deleted', label: '已删除' },
];

const SORT_OPTIONS: SortOption<BookItem>[] = [
  { value: 'recent', label: '最近创建', compare: byInstant((b) => b.created_at) },
  { value: 'used', label: '最近使用', compare: byInstant((b) => b.last_used) },
  { value: 'name', label: '名称', compare: byText((b) => b.title) },
  { value: 'words', label: '单词最多', compare: byNumber((b) => b.total_words) },
];

interface PageData {
  stats: { totalBooks: number; totalWords: number; nouns: number; verbs: number; adjectives: number };
  books: BookItem[];
}

/**
 * 单词本列表（shadcn，外壳由 AppShell 提供）：统计 + 搜索 / 主题 / 状态 / 排序 + 单词本卡片。
 * 功能清单见 .claude/work/ui-shadcn-migration/feature-inventory.md §5。
 */
export const WordBookPage: React.FC<WordBookPageProps> = ({ onNavigate, tagId }) => {
  const embedded = tagId !== undefined;
  const toast = useToast();
  const [creatingBook, setCreatingBook] = useState(false);
  const [editingBook, setEditingBook] = useState<DbWordBook | null>(null);
  const [toDelete, setToDelete] = useState<DbWordBook[] | null>(null);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const defaultFilters: Filters = embedded ? { ...DEFAULT_FILTERS, tag: String(tagId) } : DEFAULT_FILTERS;
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [sortBy, setSortBy] = useSortPref('word-books', SORT_OPTIONS);

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


  const filteredBooks = useMemo(() => {
    let books = [...(data?.books ?? [])];
    if (filters.searchTerm) {
      const q = filters.searchTerm.toLowerCase();
      books = books.filter((b) => b.title.toLowerCase().includes(q) || (b.description ?? '').toLowerCase().includes(q));
    }
    if (filters.tag !== 'all') {
      const tagId = Number(filters.tag);
      books = books.filter((b) => b.tags.some((t) => t.id === tagId));
    }
    return sortItems(books, SORT_OPTIONS, sortBy);
  }, [data, filters, sortBy]);
  // 已删除的单词本只能恢复，不参与勾选
  const selection = useSelection(useMemo(() => filteredBooks.filter((b) => !b.deleted_at).map((b) => b.id), [filteredBooks]));
  const pager = usePagination(loading ? null : filteredBooks, { id: embedded ? `word-books:tag${tagId}` : 'word-books', resetKey: `${JSON.stringify(filters)}|${sortBy}` });

  const activeFilterCount =
    (filters.searchTerm ? 1 : 0) + (!embedded && filters.tag !== 'all' ? 1 : 0) + (filters.status !== 'all' ? 1 : 0);
  const isFiltering = Boolean(filters.searchTerm) || filters.tag !== 'all' || filters.status !== 'all';
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
      <div className={embedded ? 'flex flex-col gap-6' : 'mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7'}>
        {!embedded && <PageHeader title="我的单词本" actions={createAction} />}
        <PageError title="无法加载单词本" message={error} onRetry={() => loadWordBookData(filters.status)} />
      </div>
    );
  }

  return (
    <div className={embedded ? 'flex flex-col gap-6' : 'mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7'}>
      {!embedded && <PageHeader title="我的单词本" actions={createAction} />}

      <section aria-label="单词本统计" className={cn('grid grid-cols-5 gap-3', embedded && 'hidden')}>
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} loading={loading && !data} />
        ))}
      </section>

      {selection.selecting ? (
        <SelectionBar selection={selection} unit="本">
          <BatchTagButton kind="word_book" ids={selection.ids} onDone={() => loadWordBookData(filters.status)} />
          <BatchDeleteButton count={selection.selected.size} onClick={() => setToDelete(filteredBooks.filter((b) => selection.selected.has(b.id)))} />
        </SelectionBar>
      ) : (
      <MaterialToolbar
        search={filters.searchTerm}
        onSearch={(v) => setFilter('searchTerm', v)}
        searchPlaceholder="搜索单词本"
        tag={embedded ? null : { kind: 'word_book', value: filters.tag, onChange: (v) => setFilter('tag', v), onTagsChanged: () => loadWordBookData(filters.status) }}
        activeCount={activeFilterCount}
        onReset={() => setFilters(defaultFilters)}
        countText={loading ? undefined : `共 ${filteredBooks.length} 本`}
      >
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
        <SortSelect value={sortBy} options={SORT_OPTIONS} onChange={setSortBy} />
      </MaterialToolbar>
      )}

      {loading ? (
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : filteredBooks.length === 0 ? (
        isFiltering ? (
          <EmptyState icon={<SearchX />} title="没有匹配的单词本" />
        ) : (
          <EmptyState
            icon={<BookOpen />}
            title="还没有单词本"
            action="创建单词本"
            actionIcon={<Plus />}
            onAction={() => setCreatingBook(true)}
          />
        )
      ) : (
        <>
        <div ref={pager.anchorRef} className="grid scroll-mt-20 grid-cols-3 gap-3">
          {(pager.pageItems ?? []).map((book) => (
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
              tags={book.tags}
              status={book.deleted_at ? 'deleted' : book.status}
              // 已删除的单词本没有详情页：只能恢复
              onOpen={() => {
                if (!book.deleted_at) onNavigate?.('wordbook-detail', { id: book.id });
              }}
              onRestore={book.deleted_at ? () => handleRestore(book.id) : undefined}
              actions={
                book.deleted_at
                  ? undefined
                  : [
                      { label: '打开', icon: <BookOpen />, onSelect: () => onNavigate?.('wordbook-detail', { id: book.id }) },
                      { label: '编辑…', icon: <Pencil />, onSelect: () => setEditingBook(book) },
                      { label: '删除…', icon: <Trash2 />, onSelect: () => setToDelete([book]), destructive: true, separator: true },
                    ]
              }
              select={book.deleted_at ? undefined : { checked: selection.selected.has(book.id), selecting: selection.selecting, onToggle: () => selection.toggle(book.id) }}
            />
          ))}
        </div>
        <ListPagination page={pager.page} pageSize={pager.pageSize} total={pager.total} onChange={pager.setPage} hideSinglePage unit="本" />
        </>
      )}
      <WordBookFormDialog
        isOpen={editingBook !== null}
        wordBook={editingBook}
        onClose={() => setEditingBook(null)}
        onSaved={() => loadWordBookData(filters.status)}
      />
      <BatchDeleteDialog
        items={toDelete}
        onClose={() => setToDelete(null)}
        unit="本单词本"
        description="删除后可以在「已删除」里恢复。被计划使用中的单词本不会删除。"
        nameOf={(b) => b.title}
        remove={(b) => wordBookService.deleteWordBook(b.id)}
        onDone={() => {
          selection.clear();
          loadWordBookData(filters.status);
        }}
      />
      <WordBookFormDialog isOpen={creatingBook} onClose={() => setCreatingBook(false)} onSaved={(id) => onNavigate?.('wordbook-detail', { id })} />
    </div>
  );
};
