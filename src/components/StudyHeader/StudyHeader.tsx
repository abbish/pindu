import React, { useState, useEffect } from 'react';
import styles from './StudyHeader.module.css';

export interface StudyHeaderProps {
  /** 学习计划标题 */
  planTitle: string;
  /** 学习计划描述 */
  planDescription: string;
  /** 初始倒计时时间(秒) */
  initialTime?: number;
  /** 返回按钮点击回调 */
  onBack?: () => void;
  /** 暂停按钮点击回调 */
  onPause?: () => void;
  /** 设置按钮点击回调 */
  onSettings?: () => void;
  /** 是否已暂停 */
  isPaused?: boolean;
}

/**
 * 学习页面头部组件
 */
export const StudyHeader: React.FC<StudyHeaderProps> = ({
  planTitle,
  planDescription,
  initialTime = 900, // 15分钟默认
  onBack,
  onPause,
  onSettings,
  isPaused = false
}) => {
  const [timeLeft, setTimeLeft] = useState(initialTime);

  useEffect(() => {
    if (!isPaused && timeLeft > 0) {
      const timer = setTimeout(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [timeLeft, isPaused]);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <div className={styles.leftSection}>
          <button 
            className={styles.backBtn}
            onClick={onBack}
            title="返回"
          >
            <i className="fas fa-arrow-left" />
          </button>
          
          <div className={styles.iconWrapper}>
            <i className="fas fa-book" />
          </div>
          
          <div className={styles.titleSection}>
            <h1 className={styles.title}>{planTitle}</h1>
            <p className={styles.description}>{planDescription}</p>
          </div>
        </div>

        <div className={styles.rightSection}>
          <div className={styles.timerWrapper}>
            <i className="fas fa-clock" />
            <span className={styles.timerText}>{formatTime(timeLeft)}</span>
          </div>
          
          <button 
            className={styles.controlBtn}
            onClick={onPause}
            title={isPaused ? "继续" : "暂停"}
          >
            <i className={`fas fa-${isPaused ? 'play' : 'pause'}`} />
          </button>
          
          <button 
            className={styles.controlBtn}
            onClick={onSettings}
            title="设置"
          >
            <i className="fas fa-cog" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default StudyHeader;