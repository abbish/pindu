import React from 'react';
import styles from './VocabProgress.module.css';

export interface VocabProgressItem {
  id: number;
  name: string;
  totalWords: number;
  learnedWords: number;
  progressPercentage: number;
  status: 'active' | 'completed' | 'pending';
  color: 'primary' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink';
}

export interface VocabProgressProps {
  /** Vocabulary progress data */
  progressData: VocabProgressItem[];
  /** Loading state */
  loading?: boolean;
}

/**
 * Vocabulary books progress component
 */
export const VocabProgress: React.FC<VocabProgressProps> = ({
  progressData,
  loading = false
}) => {
  const getStatusText = (status: VocabProgressItem['status']) => {
    switch (status) {
      case 'active':
        return '进行中';
      case 'completed':
        return '已完成';
      case 'pending':
        return '待开始';
      default:
        return '未知';
    }
  };

  if (loading) {
    return (
      <div className={styles.section}>
        <h3 className={styles.title}>单词本进度</h3>
        <div className={styles.loading}>
          <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  if (progressData.length === 0) {
    return (
      <div className={styles.section}>
        <h3 className={styles.title}>单词本进度</h3>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-book-open" />
          </div>
          <p className={styles.emptyText}>暂无单词本数据</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.title}>单词本进度</h3>
      
      <div className={styles.progressList}>
        {progressData.map((item) => (
          <div key={item.id} className={styles.progressItem}>
            <div className={styles.progressHeader}>
              <h4 className={styles.bookName}>{item.name}</h4>
              <span className={styles.wordCount}>
                {item.learnedWords}/{item.totalWords}
              </span>
            </div>
            
            <div className={styles.progressBar}>
              <div
                className={`${styles.progressFill} ${styles[item.color]}`}
                style={{ width: `${item.progressPercentage}%` }}
              />
            </div>
            
            <div className={styles.progressFooter}>
              <span className={styles.progressText}>
                已完成 {item.progressPercentage.toFixed(0)}%
              </span>
              <span className={`${styles.statusBadge} ${styles[item.status]}`}>
                {getStatusText(item.status)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VocabProgress;