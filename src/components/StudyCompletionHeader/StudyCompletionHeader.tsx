import React from 'react';
import styles from './StudyCompletionHeader.module.css';

export interface StudyCompletionHeaderProps {
  /** 学习计划标题 */
  planTitle: string;
  /** 完成百分比 */
  completionPercentage?: number;
  /** 返回主页回调 */
  onHome?: () => void;
  /** 分享回调 */
  onShare?: () => void;
}

/**
 * 学习完成页面头部组件
 */
export const StudyCompletionHeader: React.FC<StudyCompletionHeaderProps> = ({
  planTitle,
  completionPercentage = 100,
  onHome,
  onShare
}) => {
  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <div className={styles.leftSection}>
          <button 
            className={styles.homeBtn}
            onClick={onHome}
            title="返回主页"
          >
            <i className="fas fa-home" />
          </button>
          
          <div className={styles.iconWrapper}>
            <i className="fas fa-trophy" />
          </div>
          
          <div className={styles.titleSection}>
            <h1 className={styles.title}>学习完成！</h1>
            <p className={styles.subtitle}>{planTitle} - 全部完成</p>
          </div>
        </div>

        <div className={styles.rightSection}>
          <div className={styles.completionBadge}>
            <i className="fas fa-check" />
            <span>{completionPercentage}%</span>
          </div>
          
          <button 
            className={styles.shareBtn}
            onClick={onShare}
            title="分享成果"
          >
            <i className="fas fa-share-alt" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default StudyCompletionHeader;