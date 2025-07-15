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
} from '../components';
import type {
  WordBookStatistics,
  WordBook
} from '../utils/database';
import { getWordBooks, getWordBookStatistics } from '../utils/database';

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
    filterAndSortBooks();
  }, [books, filters]);

  const loadWordBookData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // 使用真实API获取数据
      const [statsData, booksData] = await Promise.all([
        getWordBookStatistics(),
        getWordBooks()
      ]);

      setStats(statsData);
      setBooks(booksData);
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

    // Apply theme filter (simplified - would need proper theme mapping)
    if (filters.theme) {
      // This would need proper implementation based on your theme categorization
      console.log('Theme filter:', filters.theme);
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
          filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          break;
        case 'word_count':
          filtered.sort((a, b) => b.total_words - a.total_words);
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

  const handleBookEdit = (book: WordBook) => {
    // TODO: Navigate to edit word book page
    console.log('Edit word book:', book.id);
  };

  const handleBookDelete = (book: WordBook) => {
    // TODO: Show delete confirmation and handle deletion
    if (window.confirm(`确定要删除单词本"${book.title}"吗？`)) {
      console.log('Delete word book:', book.id);
    }
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
                  onEdit={handleBookEdit}
                  onDelete={handleBookDelete}
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