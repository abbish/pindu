import React from 'react';
import styles from './StudyProgress.module.css';

export interface StudyProgressProps {
  /** 当前完成的单词数 */
  current: number;
  /** 总单词数 */
  total: number;
  /** 进度条颜色主题 */
  color?: 'primary' | 'green' | 'blue' | 'orange';
}

/**
 * 学习进度条组件
 */
export const StudyProgress: React.FC<StudyProgressProps> = ({
  current,
  total,
  color = 'primary'
}) => {
  const percentage = Math.round((current / total) * 100);
  
  return (
    <div className={styles.container}>
      <div className={styles.wrapper}>
        <div className={styles.textRow}>
          <span className={styles.label}>学习进度</span>
          <span className={`${styles.counter} ${styles[color]}`}>
            {current} / {total}
          </span>
        </div>
        
        <div className={styles.progressBar}>
          <div 
            className={`${styles.progressFill} ${styles[color]}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default StudyProgress;