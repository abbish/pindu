import React from 'react';
import styles from './WordBookHeader.module.css';
import type { ThemeOption } from '../ThemeSelector';

export interface WordBookDetailStats {
  /** 总单词数 */
  totalWords: number;
  /** 名词数量 */
  nouns: number;
  /** 动词数量 */
  verbs: number;
  /** 形容词数量 */
  adjectives: number;
}

export interface WordBookDetailInfo {
  /** 单词本ID */
  id: number;
  /** 单词本名称 */
  title: string;
  /** 描述 */
  description: string;
  /** 主题标签 */
  theme?: ThemeOption;
  /** 创建时间 */
  createdAt: string;
  /** 最后学习时间 */
  lastStudied: string;
  /** 学习次数 */
  studyCount: number;
  /** 统计数据 */
  stats: WordBookDetailStats;
}

export interface WordBookHeaderProps {
  /** 单词本信息 */
  wordBook: WordBookDetailInfo;
  /** 编辑回调 */
  onEdit?: () => void;
  /** 删除回调 */
  onDelete?: () => void;
  /** 加载状态 */
  loading?: boolean;
}

/**
 * 单词本详情头部组件
 */
export const WordBookHeader: React.FC<WordBookHeaderProps> = ({
  wordBook,
  onEdit,
  onDelete,
  loading = false
}) => {
  if (loading) {
    return (
      <section className={styles.container}>
        <div className={styles.loadingContainer}>
          <div className={styles.loadingHeader}>
            <div className={`${styles.skeleton} ${styles.titleSkeleton}`} />
            <div className={`${styles.skeleton} ${styles.tagSkeleton}`} />
          </div>
          <div className={`${styles.skeleton} ${styles.descSkeleton}`} />
          <div className={styles.loadingMeta}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={`${styles.skeleton} ${styles.metaSkeleton}`} />
            ))}
          </div>
          <div className={styles.loadingStats}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`${styles.skeleton} ${styles.statSkeleton}`} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.container}>
      <div className={styles.header}>
        <div className={styles.content}>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{wordBook.title}</h2>
            {wordBook.theme && (
              <span className={`${styles.themeTag} ${styles[wordBook.theme.color]}`}>
                <i className={`fas fa-${wordBook.theme.icon}`} />
                {wordBook.theme.name}
              </span>
            )}
          </div>
          
          <p className={styles.description}>{wordBook.description}</p>
          
          <div className={styles.metadata}>
            <div className={styles.metaItem}>
              <i className="fas fa-calendar" />
              <span>创建于 {wordBook.createdAt}</span>
            </div>
            <div className={styles.metaItem}>
              <i className="fas fa-clock" />
              <span>最后学习 {wordBook.lastStudied}</span>
            </div>
            <div className={styles.metaItem}>
              <i className="fas fa-eye" />
              <span>学习 {wordBook.studyCount} 次</span>
            </div>
          </div>
        </div>
        
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.editBtn}`}
            onClick={onEdit}
            title="编辑"
          >
            <i className="fas fa-edit" />
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.deleteBtn}`}
            onClick={onDelete}
            title="删除"
          >
            <i className="fas fa-trash" />
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className={styles.statsGrid}>
        <div className={`${styles.statCard} ${styles.primary}`}>
          <div className={styles.statValue}>{wordBook.stats.totalWords}</div>
          <div className={styles.statLabel}>总单词数</div>
        </div>
        <div className={`${styles.statCard} ${styles.blue}`}>
          <div className={styles.statValue}>{wordBook.stats.nouns}</div>
          <div className={styles.statLabel}>名词</div>
        </div>
        <div className={`${styles.statCard} ${styles.orange}`}>
          <div className={styles.statValue}>{wordBook.stats.verbs}</div>
          <div className={styles.statLabel}>动词</div>
        </div>
        <div className={`${styles.statCard} ${styles.purple}`}>
          <div className={styles.statValue}>{wordBook.stats.adjectives}</div>
          <div className={styles.statLabel}>形容词</div>
        </div>
      </div>
    </section>
  );
};

export default WordBookHeader;