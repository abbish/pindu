import React, { useState, useEffect } from 'react';
import styles from './WordBookPage.module.css';
import { 
  Header, 
  Breadcrumb,
  Button,
  WordBookStats,
  WordBookFilter,
  WordBookCard
} from '../components';
import type { 
  FilterOptions,
  WordBookStatistics
} from '../components';
import type { WordBook } from '../components/WordBookCard/WordBookCard';
import { WordBookService } from '../services/wordbookService';

export interface WordBookPageProps {
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * 单词本页面组件
 */
export const WordBookPage: React.FC<WordBookPageProps> = ({ 
  onNavigate 
}) => {
  const [stats, setStats] = useState<WordBookStatistics | null>(null);
  const [books, setBooks] = useState<WordBook[]>([]);
  const [filteredBooks, setFilteredBooks] = useState<WordBook[]>([]);
  const [filters, setFilters] = useState<FilterOptions>({
    searchTerm: '',
    theme: '',
    status: '',
    sortBy: ''
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWordBookData();
  }, []);

  useEffect(() => {
    loadWordBookData();
  }, [filters.status]);

  useEffect(() => {
    filterAndSortBooks();
  }, [books, filters]);

  const loadWordBookData = async () => {
    try {
      setLoading(true);
      setError(null);

      const wordBookService = new WordBookService();

      // 先更新所有单词本的单词数量
      await wordBookService.updateAllWordBookCounts();

      // 根据状态过滤器决定是否包含已删除的单词本
      const includeDeleted = filters.status === 'deleted' || filters.status === '';

      // 确定传递给后端的状态参数
      let statusParam: string | undefined = undefined;
      if (filters.status && filters.status !== '') {
        statusParam = filters.status;
      }

      // 使用真实API获取数据
      const [statsResult, booksResult] = await Promise.all([
        wordBookService.getWordBookStatistics(),
        wordBookService.getAllWordBooks(includeDeleted, statusParam)
      ]);

      if (!statsResult.success) {
        throw new Error(statsResult.error || '获取统计数据失败');
      }
      if (!booksResult.success) {
        throw new Error(booksResult.error || '获取单词本列表失败');
      }

      const statsData = statsResult.data;
      const booksData = booksResult.data;

      // Convert database types to component types and fetch word type statistics for each book
      const convertedBooks: WordBook[] = await Promise.all(
        booksData.map(async (dbBook: any) => {
          // 获取每个单词本的词性统计
          let wordTypes = {
            nouns: 0,
            verbs: 0,
            adjectives: 0,
            others: 0
          };

          try {
            const statsResult = await wordBookService.getWordBookTypeStatistics(dbBook.id);
            if (statsResult.success && statsResult.data) {
              wordTypes = {
                nouns: statsResult.data.nouns,
                verbs: statsResult.data.verbs,
                adjectives: statsResult.data.adjectives,
                others: statsResult.data.others
              };
            }
          } catch (error) {
            console.warn(`获取单词本 ${dbBook.id} 的统计信息失败:`, error);
            // 保持默认的0值
          }

          return {
            id: dbBook.id,
            title: dbBook.title,
            description: dbBook.description,
            icon: dbBook.icon,
            iconColor: dbBook.icon_color as any,
            totalWords: dbBook.total_words,
            linkedPlans: dbBook.linked_plans,
            wordTypes,
            createdAt: dbBook.created_at,
            lastUsed: dbBook.last_used,
            deletedAt: dbBook.deleted_at,
            status: dbBook.status as 'normal' | 'draft' | 'deleted'
          };
        })
      );

      // Convert stats as well
      const convertedStats: WordBookStatistics = {
        totalBooks: statsData.total_books,
        totalWords: statsData.total_words,
        nouns: statsData.word_types.nouns,
        verbs: statsData.word_types.verbs,
        adjectives: statsData.word_types.adjectives
      };

      setStats(convertedStats);
      setBooks(convertedBooks);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载单词本数据失败');
    } finally {
      setLoading(false);
    }
  };

  const filterAndSortBooks = () => {
    let filtered = [...books];

    // Apply search filter
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(book => 
        book.title.toLowerCase().includes(searchLower) ||
        book.description.toLowerCase().includes(searchLower)
      );
    }

    // Apply theme filter
    if (filters.theme) {
      const themeId = parseInt(filters.theme);
      filtered = filtered.filter(book => {
        const bookWithTags = book as any;
        return bookWithTags.theme_tags && bookWithTags.theme_tags.some((tag: any) => tag.id === themeId);
      });
    }

    // Apply status filter (simplified - would need status field in VocabularyBook)
    if (filters.status) {
      // This would need proper implementation based on your status logic
      console.log('Status filter:', filters.status);
    }

    // Apply sorting
    if (filters.sortBy) {
      switch (filters.sortBy) {
        case 'created_time':
          filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          break;
        case 'word_count':
          filtered.sort((a, b) => b.totalWords - a.totalWords);
          break;
        case 'completion':
          // Would need completion percentage in WordBook
          console.log('Completion sort not implemented');
          break;
        default:
          break;
      }
    }

    setFilteredBooks(filtered);
  };

  const handleNavChange = (nav: string) => {
    onNavigate?.(nav);
  };

  const handleBreadcrumbClick = (page: string) => {
    onNavigate?.(page);
  };

  const handleFilterChange = (newFilters: FilterOptions) => {
    setFilters(newFilters);
  };

  const handleFilterReset = () => {
    setFilters({
      searchTerm: '',
      theme: '',
      status: '',
      sortBy: ''
    });
  };

  const handleCreateWordBook = () => {
    onNavigate?.('create-wordbook');
  };

  const handleBookClick = (book: WordBook) => {
    onNavigate?.('wordbook-detail', { id: book.id });
  };



  if (loading) {
    return (
      <div className={styles.page}>
        <Header activeNav="wordbooks" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.loading}>
            <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
            <span>加载中...</span>
          </div>
        </main>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className={styles.page}>
        <Header activeNav="wordbooks" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.error}>
            <div className={styles.errorIcon}>
              <i className="fas fa-exclamation-triangle" />
            </div>
            <p className={styles.errorText}>{error || '加载数据失败'}</p>
            <div className={styles.errorActions}>
              <Button onClick={loadWordBookData}>重试</Button>
              <Button variant="secondary" onClick={() => onNavigate?.('home')}>
                返回首页
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header activeNav="wordbooks" onNavChange={handleNavChange} />
      
      <main className={styles.main}>
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: '首页', key: 'home', icon: 'home' }
          ]}
          current="单词本"
          onNavigate={handleBreadcrumbClick}
        />

        {/* Page Header */}
        <section className={styles.pageHeader}>
          <div className={styles.headerContent}>
            <div className={styles.headerInfo}>
              <h2 className={styles.pageTitle}>我的单词本</h2>
              <p className={styles.pageDescription}>管理和学习你的单词收藏</p>
            </div>
            <div className={styles.headerActions}>
              <Button
                variant="primary"
                onClick={handleCreateWordBook}
              >
                <i className="fas fa-plus" style={{ marginRight: '8px' }} />
                创建单词本
              </Button>
            </div>
          </div>
        </section>

        {/* Statistics Cards */}
        <WordBookStats stats={stats} loading={false} />

        {/* Filter and Search */}
        <WordBookFilter
          filters={filters}
          onFilterChange={handleFilterChange}
          onReset={handleFilterReset}
          loading={false}
        />



        {/* Word Books Grid */}
        <section className={styles.booksSection}>
          {filteredBooks.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <i className="fas fa-book" />
              </div>
              <h3 className={styles.emptyTitle}>
                {filters.searchTerm || filters.theme || filters.status ? '没有找到匹配的单词本' : '还没有单词本'}
              </h3>
              <p className={styles.emptyDescription}>
                {filters.searchTerm || filters.theme || filters.status 
                  ? '尝试调整筛选条件或搜索关键词' 
                  : '创建你的第一个单词本开始学习吧'
                }
              </p>
              {!(filters.searchTerm || filters.theme || filters.status) && (
                <Button
                  variant="primary"
                  onClick={handleCreateWordBook}
                >
                  <i className="fas fa-plus" style={{ marginRight: '8px' }} />
                  创建单词本
                </Button>
              )}
            </div>
          ) : (
            <div className={styles.booksGrid}>
              {filteredBooks.map(book => (
                <WordBookCard
                  key={book.id}
                  book={book}
                  onClick={handleBookClick}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default WordBookPage;