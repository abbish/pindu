import React, { useState, useMemo } from 'react';
import styles from './WordList.module.css';

export interface Word {
  id: number;
  word: string;
  partOfSpeech: string;
  meaning: string;
  phonetic: string;
  category?: string;
}

export interface WordListProps {
  /** Words data */
  words: Word[];
  /** Items per page */
  itemsPerPage?: number;
  /** Loading state */
  loading?: boolean;
  /** Word action handler */
  onWordAction?: (wordId: number) => void;
}

/**
 * Word list component with search and pagination
 */
export const WordList: React.FC<WordListProps> = ({
  words,
  itemsPerPage = 10,
  loading = false,
  onWordAction
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Filter words based on search term
  const filteredWords = useMemo(() => {
    if (!searchTerm.trim()) return words;
    
    const term = searchTerm.toLowerCase().trim();
    return words.filter(word =>
      word.word.toLowerCase().includes(term) ||
      word.meaning.toLowerCase().includes(term) ||
      word.phonetic.toLowerCase().includes(term)
    );
  }, [words, searchTerm]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredWords.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentWords = filteredWords.slice(startIndex, endIndex);

  // Reset to first page when search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleWordAction = (wordId: number) => {
    onWordAction?.(wordId);
  };

  const getPaginationRange = () => {
    const range: (number | string)[] = [];
    const delta = 2;

    for (let i = Math.max(2, currentPage - delta); 
         i <= Math.min(totalPages - 1, currentPage + delta); 
         i++) {
      range.push(i);
    }

    if (currentPage - delta > 2) {
      range.unshift('...');
    }
    if (currentPage + delta < totalPages - 1) {
      range.push('...');
    }

    range.unshift(1);
    if (totalPages !== 1) {
      range.push(totalPages);
    }

    return range;
  };

  if (loading) {
    return (
      <div className={styles.section}>
        <div className={styles.header}>
          <h3 className={styles.title}>单词列表</h3>
        </div>
        <div className={styles.loading}>
          <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className={styles.section}>
        <div className={styles.header}>
          <h3 className={styles.title}>单词列表</h3>
        </div>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-spell-check" />
          </div>
          <p className={styles.emptyText}>暂无单词数据</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>单词列表</h3>
        <div className={styles.searchContainer}>
          <input
            type="text"
            placeholder="搜索单词..."
            value={searchTerm}
            onChange={handleSearchChange}
            className={styles.searchInput}
          />
          <i className={`fas fa-search ${styles.searchIcon}`} />
        </div>
      </div>

      {filteredWords.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-search" />
          </div>
          <p className={styles.emptyText}>
            未找到包含 "{searchTerm}" 的单词
          </p>
        </div>
      ) : (
        <>
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead className={styles.tableHead}>
                <tr>
                  <th>单词</th>
                  <th className={styles.center}>词性</th>
                  <th className={styles.center}>中文意思</th>
                  <th className={styles.center}>自然拼读</th>
                  <th className={styles.center}>操作</th>
                </tr>
              </thead>
              <tbody className={styles.tableBody}>
                {currentWords.map((word) => (
                  <tr key={word.id}>
                    <td>
                      <div className={styles.wordCell}>{word.word}</div>
                    </td>
                    <td className={styles.center}>
                      <span className={styles.posTag}>
                        {word.partOfSpeech}
                      </span>
                    </td>
                    <td className={styles.center}>
                      <span className={styles.meaning}>{word.meaning}</span>
                    </td>
                    <td className={styles.center}>
                      <span className={styles.phonetic}>{word.phonetic}</span>
                    </td>
                    <td className={styles.actionCell}>
                      <div className={styles.actionLinks}>
                        <button
                          className={`${styles.actionLink} ${styles.viewLink}`}
                          onClick={() => handleWordAction(word.id)}
                          title="查看单词详解"
                        >
                          详解
                        </button>
                        <span className={styles.linkDivider}>|</span>
                        <button
                          className={`${styles.actionLink} ${styles.playLink}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            // TODO: 播放单词发音
                            console.log('Play pronunciation for:', word.word);
                          }}
                          title="播放发音"
                        >
                          发音
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <div className={styles.paginationInfo}>
                显示 {startIndex + 1}-{Math.min(endIndex, filteredWords.length)} 条，
                共 {filteredWords.length} 条记录
              </div>
              
              <div className={styles.paginationControls}>
                <button
                  className={styles.pageBtn}
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  <i className="fas fa-chevron-left" />
                </button>
                
                {getPaginationRange().map((page, index) => (
                  <button
                    key={index}
                    className={`${styles.pageBtn} ${
                      page === currentPage ? styles.active : ''
                    }`}
                    onClick={() => typeof page === 'number' && handlePageChange(page)}
                    disabled={typeof page === 'string'}
                  >
                    {page}
                  </button>
                ))}
                
                <button
                  className={styles.pageBtn}
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  <i className="fas fa-chevron-right" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default WordList;