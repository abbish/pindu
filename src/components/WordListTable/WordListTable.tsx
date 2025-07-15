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
  /** 音标 */
  phonetic?: string;
}

export interface WordListTableProps {
  /** 单词列表 */
  words: WordDetail[];
  /** 搜索关键词 */
  searchTerm?: string;
  /** 搜索变化回调 */
  onSearchChange?: (term: string) => void;
  /** 播放发音回调 */
  onPlayPronunciation?: (word: WordDetail) => void;
  /** 编辑单词回调 */
  onEditWord?: (word: WordDetail) => void;
  /** 删除单词回调 */
  onDeleteWord?: (word: WordDetail) => void;
  /** 加载状态 */
  loading?: boolean;
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

/**
 * 单词列表表格组件
 */
export const WordListTable: React.FC<WordListTableProps> = ({
  words,
  searchTerm = '',
  onSearchChange,
  onPlayPronunciation,
  onEditWord,
  onDeleteWord,
  loading = false
}) => {
  const [internalSearchTerm, setInternalSearchTerm] = useState(searchTerm);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInternalSearchTerm(value);
    onSearchChange?.(value);
  };

  const handlePlayPronunciation = (word: WordDetail) => {
    onPlayPronunciation?.(word);
  };

  const handleEditWord = (word: WordDetail) => {
    onEditWord?.(word);
  };

  const handleDeleteWord = (word: WordDetail) => {
    if (window.confirm(`确定要删除单词"${word.word}"吗？`)) {
      onDeleteWord?.(word);
    }
  };

  const filteredWords = words.filter(word =>
    word.word.toLowerCase().includes(internalSearchTerm.toLowerCase()) ||
    word.meaning.toLowerCase().includes(internalSearchTerm.toLowerCase())
  );

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
                    <div className={`${styles.skeleton} ${styles.posSkeleton}`} />
                  </td>
                  <td>
                    <div className={styles.actionSkeletons}>
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
      <div className={styles.header}>
        <h3 className={styles.title}>单词列表</h3>
        <div className={styles.searchWrapper}>
          <i className="fas fa-search" />
          <input
            type="text"
            placeholder="搜索单词..."
            value={internalSearchTerm}
            onChange={handleSearchChange}
            className={styles.searchInput}
          />
          {internalSearchTerm && (
            <button
              className={styles.clearBtn}
              onClick={() => {
                setInternalSearchTerm('');
                onSearchChange?.('');
              }}
              title="清除搜索"
            >
              <i className="fas fa-times" />
            </button>
          )}
        </div>
      </div>

      <div className={styles.tableContainer}>
        {filteredWords.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <i className="fas fa-search" />
            </div>
            <h4 className={styles.emptyTitle}>
              {internalSearchTerm ? '没有找到匹配的单词' : '暂无单词'}
            </h4>
            <p className={styles.emptyDescription}>
              {internalSearchTerm 
                ? '尝试调整搜索关键词' 
                : '开始添加单词到这个单词本吧'
              }
            </p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>单词</th>
                <th>中文释义</th>
                <th>词性</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredWords.map((word) => {
                const posConfig = PART_OF_SPEECH_CONFIG[word.partOfSpeech];
                
                return (
                  <tr key={word.id}>
                    <td>
                      <div className={styles.wordCell}>
                        <h4 className={styles.wordText}>{word.word}</h4>
                        <button
                          className={styles.pronunciationBtn}
                          onClick={() => handlePlayPronunciation(word)}
                          title="播放发音"
                        >
                          <i className="fas fa-volume-up" />
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className={styles.meaning}>{word.meaning}</span>
                    </td>
                    <td>
                      <span 
                        className={`${styles.partOfSpeech} ${styles[posConfig.color]}`}
                        title={posConfig.label}
                      >
                        {word.partOfSpeech}
                      </span>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          className={styles.actionBtn}
                          onClick={() => handleEditWord(word)}
                          title="编辑"
                        >
                          <i className="fas fa-edit" />
                        </button>
                        <button
                          className={`${styles.actionBtn} ${styles.deleteBtn}`}
                          onClick={() => handleDeleteWord(word)}
                          title="删除"
                        >
                          <i className="fas fa-trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default WordListTable;