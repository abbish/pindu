import React from 'react';
import styles from './PerformanceAnalysis.module.css';
import type { WordData } from '../WordCard';

export interface DifficultWord extends WordData {
  /** 错误次数 */
  attempts: number;
  /** 总尝试次数 */
  totalAttempts: number;
  /** 错误类型 */
  errorType: string;
}

export interface PerformanceAnalysisProps {
  /** 需要加强的单词 */
  difficultWords: DifficultWord[];
  /** 已掌握的单词 */
  masteredWords: WordData[];
  /** 重点练习回调 */
  onPracticeWords?: (words: DifficultWord[]) => void;
  /** 查看全部掌握单词回调 */
  onViewMastered?: (words: WordData[]) => void;
}

/**
 * 学习表现分析组件
 */
export const PerformanceAnalysis: React.FC<PerformanceAnalysisProps> = ({
  difficultWords,
  masteredWords,
  onPracticeWords,
  onViewMastered
}) => {
  const handlePracticeWords = () => {
    onPracticeWords?.(difficultWords);
  };

  const handleViewMastered = () => {
    onViewMastered?.(masteredWords);
  };

  const handleRetryWord = (word: DifficultWord) => {
    onPracticeWords?.([word]);
  };

  // 显示前6个已掌握的单词
  const displayedMasteredWords = masteredWords.slice(0, 6);

  return (
    <div className={styles.container}>
      {/* 需要加强的单词 */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            <i className="fas fa-exclamation-triangle" />
            需要加强的单词
          </h3>
          <span className={styles.countBadge}>
            {difficultWords.length} 个
          </span>
        </div>

        <div className={styles.difficultWords}>
          {difficultWords.map((word) => (
            <div key={word.id} className={styles.difficultWordCard}>
              <div className={styles.wordInfo}>
                {word.imageUrl && (
                  <img 
                    src={word.imageUrl} 
                    alt={word.word}
                    className={styles.wordImage}
                  />
                )}
                <div className={styles.wordDetails}>
                  <h4 className={styles.wordTitle}>{word.word}</h4>
                  <p className={styles.wordError}>
                    {word.meaning} - {word.errorType}
                  </p>
                </div>
              </div>
              <div className={styles.wordActions}>
                <span className={styles.scoreText}>
                  {word.attempts}/{word.totalAttempts}
                </span>
                <button 
                  className={styles.retryBtn}
                  onClick={() => handleRetryWord(word)}
                  type="button"
                >
                  <i className="fas fa-redo" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {difficultWords.length > 0 && (
          <button 
            className={styles.practiceAllBtn}
            onClick={handlePracticeWords}
            type="button"
          >
            <i className="fas fa-dumbbell" />
            重点练习这些单词
          </button>
        )}
      </div>

      {/* 已掌握的单词 */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            <i className="fas fa-medal" />
            已掌握的单词
          </h3>
          <span className={`${styles.countBadge} ${styles.success}`}>
            {masteredWords.length} 个
          </span>
        </div>

        <div className={styles.masteredWords}>
          {displayedMasteredWords.map((word) => (
            <div key={word.id} className={styles.masteredWordCard}>
              <div className={styles.masteredWordTitle}>{word.word}</div>
              <div className={styles.masteredWordScore}>100%</div>
            </div>
          ))}
        </div>

        {masteredWords.length > 0 && (
          <button 
            className={styles.viewAllBtn}
            onClick={handleViewMastered}
            type="button"
          >
            <i className="fas fa-eye" />
            查看全部掌握单词
          </button>
        )}
      </div>
    </div>
  );
};

export default PerformanceAnalysis;