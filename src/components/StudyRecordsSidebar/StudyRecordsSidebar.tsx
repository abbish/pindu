import React from 'react';
import styles from './StudyRecordsSidebar.module.css';
import type { StudyRecord } from '../StudyRecordsTable';

export interface StudyRecordsSidebarProps {
  /** Study records data (limited) */
  records: StudyRecord[];
  /** Loading state */
  loading?: boolean;
}

/**
 * Study records sidebar component showing recent study sessions
 */
export const StudyRecordsSidebar: React.FC<StudyRecordsSidebarProps> = ({
  records,
  loading = false
}) => {
  const getStatusText = (status: StudyRecord['status']) => {
    switch (status) {
      case 'completed':
        return '已完成';
      case 'active':
        return '进行中';
      case 'paused':
        return '已暂停';
      default:
        return '未知';
    }
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 90) return 'green';
    if (accuracy >= 75) return 'orange';
    return 'yellow';
  };

  if (loading) {
    return (
      <div className={styles.sidebar}>
        <h3 className={styles.title}>学习记录</h3>
        <div className={styles.loading}>
          <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className={styles.sidebar}>
        <h3 className={styles.title}>学习记录</h3>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-history" />
          </div>
          <p className={styles.emptyText}>暂无学习记录</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sidebar}>
      <h3 className={styles.title}>学习记录</h3>
      
      <div className={styles.recordsList}>
        {records.map((record) => (
          <div key={record.id} className={styles.recordItem}>
            <div className={styles.recordHeader}>
              <div className={styles.sessionName}>{record.sessionName}</div>
              <span className={`${styles.statusBadge} ${styles[record.status]}`}>
                {getStatusText(record.status)}
              </span>
            </div>
            
            <div className={styles.recordTime}>
              {record.date} {record.time}
            </div>
            
            <div className={styles.recordStats}>
              <div className={styles.statItem}>
                <div className={styles.statValue}>{record.wordsStudied}</div>
                <div className={styles.statLabel}>单词</div>
              </div>
              <div className={styles.statItem}>
                <div className={`${styles.statValue} ${styles[getAccuracyColor(record.accuracy)]}`}>
                  {record.accuracy}%
                </div>
                <div className={styles.statLabel}>正确率</div>
              </div>
              <div className={styles.statItem}>
                <div className={`${styles.statValue} ${styles.orange}`}>
                  {record.duration}
                </div>
                <div className={styles.statLabel}>分钟</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default StudyRecordsSidebar;