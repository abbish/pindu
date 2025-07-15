import React from 'react';
import styles from './StudyStatistics.module.css';

export interface StudyStatisticsData {
  /** 学习单词数量 */
  totalWords: number;
  /** 正确答案数量 */
  correctAnswers: number;
  /** 准确率百分比 */
  accuracy: number;
  /** 学习时长(分钟) */
  studyTime: number;
}

export interface StudyStatisticsProps {
  /** 统计数据 */
  statistics: StudyStatisticsData;
}

/**
 * 学习统计组件
 */
export const StudyStatistics: React.FC<StudyStatisticsProps> = ({
  statistics
}) => {
  const stats = [
    {
      icon: 'fas fa-book',
      value: statistics.totalWords,
      label: '学习单词',
      color: 'primary'
    },
    {
      icon: 'fas fa-check',
      value: statistics.correctAnswers,
      label: '正确答案',
      color: 'green'
    },
    {
      icon: 'fas fa-percentage',
      value: `${statistics.accuracy}%`,
      label: '准确率',
      color: 'orange'
    },
    {
      icon: 'fas fa-clock',
      value: statistics.studyTime,
      label: '学习时长(分钟)',
      color: 'blue'
    }
  ];

  return (
    <div className={styles.container}>
      {stats.map((stat, index) => (
        <div key={index} className={styles.statCard}>
          <div className={`${styles.iconWrapper} ${styles[`icon_${stat.color}`]}`}>
            <i className={stat.icon} />
          </div>
          <h3 className={`${styles.value} ${styles[`value_${stat.color}`]}`}>
            {stat.value}
          </h3>
          <p className={styles.label}>{stat.label}</p>
        </div>
      ))}
    </div>
  );
};

export default StudyStatistics;