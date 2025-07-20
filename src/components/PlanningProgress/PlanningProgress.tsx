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

    let pollInterval = 1000; // 初始轮询间隔1秒
    let consecutiveErrors = 0;

    const poll = async () => {
      try {
        const result = await wordBookService.getAnalysisProgress();
        if (result.success && result.data) {
          setProgress(result.data);
          consecutiveErrors = 0; // 重置错误计数

          // 如果分析完成、出错或取消，停止轮询
          if (['completed', 'error', 'cancelled'].includes(result.data.status)) {
            clearPolling();
            return;
          }

          // 动态调整轮询间隔：分析进行中时可以稍微频繁一些
          pollInterval = result.data.chunks_received > 0 ? 800 : 1200;
        } else {
          consecutiveErrors++;
          // 如果连续错误，增加轮询间隔
          pollInterval = Math.min(pollInterval * 1.5, 5000);
        }
      } catch (err) {
        console.error('Progress polling error:', err);
        consecutiveErrors++;

        // 连续错误超过3次，停止轮询
        if (consecutiveErrors >= 3) {
          clearPolling();
          return;
        }

        // 增加轮询间隔
        pollInterval = Math.min(pollInterval * 2, 5000);
      }

      // 设置下次轮询
      const timeoutId = setTimeout(poll, pollInterval);
      setPollIntervalRef(timeoutId);
    };

    // 开始轮询
    poll();
  };

  const clearPolling = () => {
    if (pollIntervalRef) {
      clearTimeout(pollIntervalRef); // 改为clearTimeout，因为现在使用setTimeout
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
