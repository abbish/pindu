import React from 'react';
import styles from './StudyRecordsTable.module.css';

export interface StudyRecord {
  id: number;
  sessionName: string;
  description: string;
  date: string;
  time: string;
  wordsStudied: number;
  accuracy: number;
  duration: number;
  status: 'completed' | 'active' | 'paused';
}

export interface StudyRecordsTableProps {
  /** Study records data */
  records: StudyRecord[];
  /** Loading state */
  loading?: boolean;
}

/**
 * Study records table component
 */
export const StudyRecordsTable: React.FC<StudyRecordsTableProps> = ({
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
      <div className={styles.section}>
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
      <div className={styles.section}>
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
    <div className={styles.section}>
      <h3 className={styles.title}>学习记录</h3>
      
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead className={styles.tableHead}>
            <tr>
              <th>学习周期</th>
              <th className={styles.center}>学习时间</th>
              <th className={styles.center}>学习单词</th>
              <th className={styles.center}>正确率</th>
              <th className={styles.center}>学习时长</th>
              <th className={styles.center}>状态</th>
            </tr>
          </thead>
          <tbody className={styles.tableBody}>
            {records.map((record) => (
              <tr key={record.id}>
                <td>
                  <div className={styles.sessionInfo}>
                    <div className={styles.sessionTitle}>{record.sessionName}</div>
                    <div className={styles.sessionDesc}>{record.description}</div>
                  </div>
                </td>
                <td>
                  <div className={styles.timeInfo}>
                    <div className={styles.date}>{record.date}</div>
                    <div className={styles.time}>{record.time}</div>
                  </div>
                </td>
                <td>
                  <div className={styles.statValue}>
                    <div className={styles.value}>{record.wordsStudied}</div>
                    <div className={styles.valueUnit}>个</div>
                  </div>
                </td>
                <td>
                  <div className={styles.statValue}>
                    <div className={`${styles.value} ${styles[getAccuracyColor(record.accuracy)]}`}>
                      {record.accuracy}%
                    </div>
                  </div>
                </td>
                <td>
                  <div className={styles.statValue}>
                    <div className={`${styles.value} ${styles.orange}`}>{record.duration}</div>
                    <div className={styles.valueUnit}>分钟</div>
                  </div>
                </td>
                <td className={styles.statusCell}>
                  <span className={`${styles.statusBadge} ${styles[record.status]}`}>
                    {getStatusText(record.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StudyRecordsTable;