import React from 'react';
import styles from './WordBookSelector.module.css';

export interface WordBookOption {
  id: number;
  name: string;
  description: string;
  wordCount: number;
  category?: string;
}

export interface WordBookSelectorProps {
  /** Available word books */
  books: WordBookOption[];
  /** Selected book IDs */
  selectedBooks: number[];
  /** Selection change handler */
  onSelectionChange: (selectedIds: number[]) => void;
  /** Loading state */
  loading?: boolean;
}

/**
 * Word book selection component
 */
export const WordBookSelector: React.FC<WordBookSelectorProps> = ({
  books,
  selectedBooks,
  onSelectionChange,
  loading = false
}) => {
  const handleBookToggle = (bookId: number) => {
    const isSelected = selectedBooks.includes(bookId);
    let newSelection: number[];
    
    if (isSelected) {
      newSelection = selectedBooks.filter(id => id !== bookId);
    } else {
      newSelection = [...selectedBooks, bookId];
    }
    
    onSelectionChange(newSelection);
  };

  const getTotalWords = () => {
    return books
      .filter(book => selectedBooks.includes(book.id))
      .reduce((total, book) => total + book.wordCount, 0);
  };

  const getSelectedCount = () => selectedBooks.length;

  if (loading) {
    return (
      <div className={styles.section}>
        <div className={styles.loading}>
          <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
          <span>加载单词本...</span>
        </div>
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div className={styles.section}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-book-open" />
          </div>
          <p className={styles.emptyText}>暂无可用的单词本</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h4 className={styles.title}>选择单词本</h4>
        <p className={styles.description}>
          从下列单词本中选择要加入学习计划的内容
        </p>
      </div>

      <div className={styles.booksList}>
        {books.map((book) => {
          const isSelected = selectedBooks.includes(book.id);
          
          return (
            <div
              key={book.id}
              className={`${styles.bookItem} ${isSelected ? styles.selected : ''}`}
              onClick={() => handleBookToggle(book.id)}
            >
              <label className={styles.bookLabel}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={isSelected}
                  onChange={() => handleBookToggle(book.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                
                <div className={styles.bookContent}>
                  <div className={styles.bookHeader}>
                    <h5 className={styles.bookTitle}>{book.name}</h5>
                    <span className={styles.wordCount}>
                      {book.wordCount}个单词
                    </span>
                  </div>
                  <p className={styles.bookDescription}>
                    {book.description}
                  </p>
                </div>
              </label>
            </div>
          );
        })}
      </div>

      {selectedBooks.length > 0 && (
        <div className={styles.summary}>
          <h5 className={styles.summaryTitle}>选择统计</h5>
          <div className={styles.summaryStats}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{getSelectedCount()}</span>
              <div className={styles.statLabel}>已选单词本</div>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{getTotalWords()}</span>
              <div className={styles.statLabel}>总单词数</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WordBookSelector;