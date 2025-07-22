import React, { useState } from 'react';
import styles from './WordListTable.module.css';

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
}

export interface WordListTableProps {
  /** 单词列表 */
  words: WordDetail[];
  /** 播放发音回调 */
  onPlayPronunciation?: (word: WordDetail) => void;

  /** 编辑单词回调 */
  onEditWord?: (word: WordDetail) => void;
  /** 删除单词回调 */
  onDeleteWord?: (word: WordDetail) => void;
  /** 批量删除回调 */
  onBatchDelete?: (words: WordDetail[]) => void;
  /** 补充单词回调 */
  onAddWords?: () => void;
  /** 加载状态 */
  loading?: boolean;
  /** 分页信息 */
  pagination?: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
  };
  /** 只读模式 */
  readonly?: boolean;
}

const PART_OF_SPEECH_CONFIG = {
  'n.': { label: '名词', color: 'blue' },
  'v.': { label: '动词', color: 'green' },
  'adj.': { label: '形容词', color: 'purple' },
  'adv.': { label: '副词', color: 'orange' },
  'prep.': { label: '介词', color: 'pink' },
  'conj.': { label: '连词', color: 'yellow' },
  'int.': { label: '感叹词', color: 'primary' },
  'pron.': { label: '代词', color: 'blue' }
};

// 生成页码数组的辅助函数
const generatePageNumbers = (current: number, total: number): (number | string)[] => {
  const pages: (number | string)[] = [];

  if (total <= 7) {
    // 如果总页数小于等于7，显示所有页码
    for (let i = 1; i <= total; i++) {
      pages.push(i);
    }
  } else {
    // 总是显示第一页
    pages.push(1);

    if (current <= 4) {
      // 当前页在前面
      for (let i = 2; i <= 5; i++) {
        pages.push(i);
      }
      pages.push('...');
      pages.push(total);
    } else if (current >= total - 3) {
      // 当前页在后面
      pages.push('...');
      for (let i = total - 4; i <= total; i++) {
        pages.push(i);
      }
    } else {
      // 当前页在中间
      pages.push('...');
      for (let i = current - 1; i <= current + 1; i++) {
        pages.push(i);
      }
      pages.push('...');
      pages.push(total);
    }
  }

  return pages;
};

/**
 * 单词列表表格组件
 */
export const WordListTable: React.FC<WordListTableProps> = ({
  words,
  onPlayPronunciation,
  onDeleteWord,
  onBatchDelete,
  onAddWords,
  loading = false,
  pagination,
  readonly = false
}) => {
  const [selectedWords, setSelectedWords] = useState<Set<number>>(new Set());



  const handlePlayPronunciation = (word: WordDetail) => {
    onPlayPronunciation?.(word);
  };



  const handleDeleteWord = (word: WordDetail) => {
    onDeleteWord?.(word);
  };

  // 多选相关函数
  const handleSelectWord = (wordId: number) => {
    const newSelected = new Set(selectedWords);
    if (newSelected.has(wordId)) {
      newSelected.delete(wordId);
    } else {
      newSelected.add(wordId);
    }
    setSelectedWords(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedWords.size === words.length) {
      setSelectedWords(new Set());
    } else {
      setSelectedWords(new Set(words.map(word => word.id)));
    }
  };

  const handleBatchDelete = () => {
    const wordsToDelete = words.filter(word => selectedWords.has(word.id));
    if (wordsToDelete.length > 0) {
      onBatchDelete?.(wordsToDelete);
      setSelectedWords(new Set());
    }
  };

  const handleClearSelection = () => {
    setSelectedWords(new Set());
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3 className={styles.title}>单词列表</h3>
          <div className={styles.searchWrapper}>
            <div className={`${styles.skeleton} ${styles.searchSkeleton}`} />
          </div>
        </div>
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>单词</th>
                <th>中文释义</th>
                <th>音标</th>
                <th>音节</th>
                <th>词性</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, index) => (
                <tr key={index}>
                  <td>
                    <div className={`${styles.skeleton} ${styles.wordSkeleton}`} />
                  </td>
                  <td>
                    <div className={`${styles.skeleton} ${styles.meaningSkeleton}`} />
                  </td>
                  <td>
                    <div className={`${styles.skeleton} ${styles.phoneticSkeleton}`} />
                  </td>
                  <td>
                    <div className={`${styles.skeleton} ${styles.syllablesSkeleton}`} />
                  </td>
                  <td>
                    <div className={`${styles.skeleton} ${styles.posSkeleton}`} />
                  </td>
                  <td>
                    <div className={styles.actionSkeletons}>
                      <div className={`${styles.skeleton} ${styles.actionSkeleton}`} />
                      <div className={`${styles.skeleton} ${styles.actionSkeleton}`} />
                      <div className={`${styles.skeleton} ${styles.actionSkeleton}`} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Filter Bar */}
      <div className={styles.filterBar}>
        <div className={styles.filterLeft}>
          <h3 className={styles.title}>单词列表</h3>
          <span className={styles.count}>
            {pagination ? `共 ${pagination.total} 个单词` : `共 ${words.length} 个单词`}
          </span>
        </div>

        <div className={styles.filterRight}>

          {/* 批量操作按钮 */}
          {!readonly && selectedWords.size > 0 && (
            <button
              type="button"
              className={styles.batchDeleteBtn}
              onClick={handleBatchDelete}
              title={`删除选中的 ${selectedWords.size} 个单词`}
            >
              <i className="fas fa-trash" />
              删除选中 ({selectedWords.size})
            </button>
          )}

          {/* 补充单词按钮 */}
          {onAddWords && (
            <button
              type="button"
              className={styles.addWordsBtn}
              onClick={onAddWords}
              title="补充单词"
            >
              <i className="fas fa-plus" />
              补充单词
            </button>
          )}
        </div>
      </div>

      {/* 批量操作提示条 */}
      {!readonly && selectedWords.size > 0 && (
        <div className={styles.selectionBar}>
          <div className={styles.selectionInfo}>
            <i className="fas fa-check-circle" />
            已选择 {selectedWords.size} 个单词
          </div>
          <div className={styles.selectionActions}>
            <button
              type="button"
              className={styles.selectAllBtn}
              onClick={handleSelectAll}
            >
              {selectedWords.size === words.length ? '取消全选' : '全选'}
            </button>
            <button
              type="button"
              className={styles.clearSelectionBtn}
              onClick={handleClearSelection}
            >
              清除选择
            </button>
          </div>
        </div>
      )}

      <div className={styles.tableContainer}>
        {words.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <i className="fas fa-search" />
            </div>
            <h4 className={styles.emptyTitle}>
              暂无单词
            </h4>
            <p className={styles.emptyDescription}>
              开始添加单词到这个单词本吧
            </p>
          </div>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  {!readonly && (
                    <th>
                      <input
                        type="checkbox"
                        checked={selectedWords.size > 0 && selectedWords.size === words.length}
                        onChange={handleSelectAll}
                        className={styles.selectCheckbox}
                        aria-label="全选单词"
                      />
                    </th>
                  )}
                  <th>单词</th>
                  <th>中文释义</th>
                  <th>音标</th>
                  <th>音节</th>
                  <th>词性</th>
                  {!readonly && <th>操作</th>}
                </tr>
              </thead>
              <tbody>
                {words.map((word) => {
                const posConfig = PART_OF_SPEECH_CONFIG[word.partOfSpeech] || { label: '其他', color: 'gray' };

                return (
                  <tr key={word.id} className={selectedWords.has(word.id) ? styles.selectedRow : ''}>
                    {!readonly && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedWords.has(word.id)}
                          onChange={() => handleSelectWord(word.id)}
                          className={styles.selectCheckbox}
                          aria-label={`选择单词 ${word.word}`}
                        />
                      </td>
                    )}
                    <td>
                      <div className={styles.wordCell}>
                        <h4 className={styles.wordText}>{word.word}</h4>
                      </div>
                    </td>
                    <td>
                      <span className={styles.meaning}>{word.meaning}</span>
                    </td>
                    <td>
                      <span className={styles.phonetic}>
                        {word.ipa || '-'}
                      </span>
                    </td>
                    <td>
                      <span className={styles.syllables}>
                        {word.syllables || '-'}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`${styles.partOfSpeech} ${styles[posConfig.color]}`}
                        title={posConfig.label}
                      >
                        {word.partOfSpeech}
                      </span>
                    </td>
                    {!readonly && (
                      <td>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => handlePlayPronunciation(word)}
                            title="播放发音"
                          >
                            <i className="fas fa-volume-up" />
                          </button>

                          <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.deleteBtn}`}
                            onClick={() => handleDeleteWord(word)}
                            title="删除"
                          >
                            <i className="fas fa-trash" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* 分页组件 */}
          {pagination && pagination.total > pagination.pageSize && (
            <div className={styles.pagination}>
              <div className={styles.paginationInfo}>
                显示第 {((pagination.current - 1) * pagination.pageSize) + 1} - {Math.min(pagination.current * pagination.pageSize, pagination.total)} 条，共 {pagination.total} 条
              </div>
              <div className={styles.paginationControls}>
                <button
                  type="button"
                  className={`${styles.paginationBtn} ${pagination.current === 1 ? styles.disabled : ''}`}
                  onClick={() => pagination.current > 1 && pagination.onChange(pagination.current - 1)}
                  disabled={pagination.current === 1}
                >
                  <i className="fas fa-chevron-left" />
                  上一页
                </button>

                <div className={styles.pageNumbers}>
                  {generatePageNumbers(pagination.current, Math.ceil(pagination.total / pagination.pageSize)).map((page, index) => (
                    page === '...' ? (
                      <span key={index} className={styles.ellipsis}>...</span>
                    ) : (
                      <button
                        key={index}
                        type="button"
                        className={`${styles.pageBtn} ${page === pagination.current ? styles.active : ''}`}
                        onClick={() => pagination.onChange(page as number)}
                      >
                        {page}
                      </button>
                    )
                  ))}
                </div>

                <button
                  type="button"
                  className={`${styles.paginationBtn} ${pagination.current >= Math.ceil(pagination.total / pagination.pageSize) ? styles.disabled : ''}`}
                  onClick={() => pagination.current < Math.ceil(pagination.total / pagination.pageSize) && pagination.onChange(pagination.current + 1)}
                  disabled={pagination.current >= Math.ceil(pagination.total / pagination.pageSize)}
                >
                  下一页
                  <i className="fas fa-chevron-right" />
                </button>
              </div>
            </div>
          )}
        </>
        )}
      </div>
    </div>
  );
};

export default WordListTable;