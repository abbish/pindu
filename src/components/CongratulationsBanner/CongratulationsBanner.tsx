import React from 'react';
import styles from './CongratulationsBanner.module.css';

export interface CongratulationsBannerProps {
  /** 学习计划标题 */
  planTitle: string;
  /** 完成单词数量 */
  completedWords: number;
  /** 自定义图标 */
  icon?: string;
  /** 自定义消息 */
  message?: string;
}

/**
 * 恭喜完成横幅组件
 */
export const CongratulationsBanner: React.FC<CongratulationsBannerProps> = ({
  planTitle: _planTitle,
  completedWords,
  icon = 'fas fa-star',
  message
}) => {
  const defaultMessage = `你已经成功掌握了所有${completedWords}个单词，表现非常棒！`;

  return (
    <div className={styles.banner}>
      <div className={styles.container}>
        <div className={styles.iconWrapper}>
          <i className={icon} />
        </div>
        <h2 className={styles.title}>恭喜完成学习！</h2>
        <p className={styles.description}>
          {message || defaultMessage}
        </p>
      </div>
    </div>
  );
};

export default CongratulationsBanner;