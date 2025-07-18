import React, { useState, useEffect } from 'react';
import styles from './PlanningProgress.module.css';
import { WordBookService } from '../../services/wordbookService';
import type { AnalysisProgress } from '../../types';

export interface PlanningProgressProps {
  /** 是否显示进度 */
  isVisible: boolean;
  /** 取消回调 */
  onCancel: () => void;
}

/**
 * 学习计划规划进度组件
 */
export const PlanningProgress: React.FC<PlanningProgressProps> = ({
  isVisible,
  onCancel
}) => {
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [pollIntervalRef, setPollIntervalRef] = useState<number | null>(null);

  const wordBookService = new WordBookService();

  useEffect(() => {
    if (isVisible) {
      startProgressPolling();
    } else {
      clearPolling();
    }

    return () => {
      clearPolling();
    };
  }, [isVisible]);

  const startProgressPolling = () => {
    // 清理之前的轮询
    clearPolling();

    const pollInterval = setInterval(async () => {
      try {
        const result = await wordBookService.getAnalysisProgress();
        if (result.success && result.data) {
          setProgress(result.data);

          // 如果分析完成或出错，停止轮询
          if (result.data.status === 'completed' || result.data.status === 'error') {
            clearPolling();
          }
        }
      } catch (err) {
        console.error('Progress polling error:', err);
        clearPolling();
      }
    }, 500); // 每0.5秒轮询一次

    setPollIntervalRef(pollInterval);
  };

  const clearPolling = () => {
    if (pollIntervalRef) {
      clearInterval(pollIntervalRef);
      setPollIntervalRef(null);
    }
  };

  const handleCancel = () => {
    clearPolling();
    onCancel();
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h3>AI正在规划学习计划</h3>
          <p>请耐心等待，AI正在为您制定个性化的学习计划...</p>
        </div>

        <div className={styles.content}>
          {progress && (
            <>
              <div className={styles.statusSection}>
                <div className={styles.statusIcon}>
                  {progress.status === 'analyzing' && (
                    <i className={`fas fa-cog ${styles.spinning}`} />
                  )}
                  {progress.status === 'completed' && (
                    <i className="fas fa-check-circle" style={{ color: 'var(--color-success)' }} />
                  )}
                  {progress.status === 'error' && (
                    <i className="fas fa-exclamation-triangle" style={{ color: 'var(--color-error)' }} />
                  )}
                </div>
                <div className={styles.statusText}>
                  <div className={styles.currentStep}>{progress.current_step}</div>
                  <div className={styles.statusLabel}>
                    {progress.status === 'analyzing' && '规划中...'}
                    {progress.status === 'completed' && '规划完成'}
                    {progress.status === 'error' && '规划失败'}
                  </div>
                </div>
              </div>

              <div className={styles.progressStats}>
                <div className={styles.progressStat}>
                  <span className={styles.statLabel}>已接收:</span>
                  <span className={styles.statValue}>{progress.chunks_received} 块</span>
                </div>
                <div className={styles.progressStat}>
                  <span className={styles.statLabel}>字符数:</span>
                  <span className={styles.statValue}>{progress.total_chars.toLocaleString()}</span>
                </div>
                <div className={styles.progressStat}>
                  <span className={styles.statLabel}>用时:</span>
                  <span className={styles.statValue}>{progress.elapsed_seconds.toFixed(1)}s</span>
                </div>
              </div>

              {progress.elapsed_seconds > 60 && (
                <div className={styles.progressTip}>
                  <i className="fas fa-info-circle" />
                  <span>复杂的学习计划规划需要较长时间，请耐心等待。通常需要1-3分钟。</span>
                </div>
              )}

              {progress.error_message && (
                <div className={styles.errorMessage}>
                  <i className="fas fa-exclamation-triangle" />
                  <span>{progress.error_message}</span>
                </div>
              )}
            </>
          )}

          <div className={styles.progressBar}>
            <div
              className={`${styles.progressFill} ${
                progress?.status === 'completed' ? styles.progressComplete :
                progress?.chunks_received && progress.chunks_received > 0 ? styles.progressActive : styles.progressStarted
              }`}
            />
          </div>
        </div>

        <div className={styles.actions}>
          <button
            className={styles.cancelButton}
            onClick={handleCancel}
            disabled={progress?.status === 'completed'}
          >
            {progress?.status === 'completed' ? '关闭' : '取消规划'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlanningProgress;
