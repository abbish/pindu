import React from 'react';
import styles from './WordBookStats.module.css';

export interface WordBookStatistics {
  /** 单词本总数 */
  totalBooks: number;
  /** 单词总数 */
  totalWords: number;
  /** 名词数量 */
  nouns: number;
  /** 动词数量 */
  verbs: number;
  /** 形容词数量 */
  adjectives: number;
}

export interface WordBookStatsProps {
  /** 统计数据 */
  stats: WordBookStatistics;
  /** 加载状态 */
  loading?: boolean;
}

/**
 * 单词本统计卡片组件
 */
export const WordBookStats: React.FC<WordBookStatsProps> = ({
  stats,
  loading = false
}) => {
  if (loading) {
    return (
      <section className={styles.statsSection}>
        <div className={styles.statsGrid}>
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className={styles.statCard}>
              <div className={styles.cardHeader}>
                <div className={`${styles.skeleton} ${styles.iconSkeleton}`} />
                <div className={`${styles.skeleton} ${styles.valueSkeleton}`} />
              </div>
              <div className={`${styles.skeleton} ${styles.labelSkeleton}`} />
              <div className={`${styles.skeleton} ${styles.descSkeleton}`} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.statsSection}>
      <div className={styles.statsGrid}>
        {/* 单词本总数 */}
        <div className={styles.statCard}>
          <div className={styles.cardHeader}>
            <div className={`${styles.icon} ${styles.primary}`}>
              <i className="fas fa-book" />
            </div>
            <span className={styles.value}>{stats.totalBooks}</span>
          </div>
          <h3 className={styles.label}>单词本总数</h3>
          <p className={styles.description}>已创建的单词本</p>
        </div>

        {/* 单词总数 */}
        <div className={styles.statCard}>
          <div className={styles.cardHeader}>
            <div className={`${styles.icon} ${styles.orange}`}>
              <i className="fas fa-font" />
            </div>
            <span className={styles.value}>{stats.totalWords.toLocaleString()}</span>
          </div>
          <h3 className={styles.label}>单词总数</h3>
          <p className={styles.description}>所有单词本中的单词</p>
        </div>

        {/* 名词 */}
        <div className={styles.statCard}>
          <div className={styles.cardHeader}>
            <div className={`${styles.icon} ${styles.green}`}>
              <i className="fas fa-cube" />
            </div>
            <span className={styles.value}>{stats.nouns}</span>
          </div>
          <h3 className={styles.label}>名词</h3>
          <p className={styles.description}>所有名词类单词</p>
        </div>

        {/* 动词 */}
        <div className={styles.statCard}>
          <div className={styles.cardHeader}>
            <div className={`${styles.icon} ${styles.blue}`}>
              <i className="fas fa-running" />
            </div>
            <span className={styles.value}>{stats.verbs}</span>
          </div>
          <h3 className={styles.label}>动词</h3>
          <p className={styles.description}>所有动词类单词</p>
        </div>

        {/* 形容词 */}
        <div className={styles.statCard}>
          <div className={styles.cardHeader}>
            <div className={`${styles.icon} ${styles.purple}`}>
              <i className="fas fa-star" />
            </div>
            <span className={styles.value}>{stats.adjectives}</span>
          </div>
          <h3 className={styles.label}>形容词</h3>
          <p className={styles.description}>所有形容词类单词</p>
        </div>
      </div>
    </section>
  );
};

export default WordBookStats;