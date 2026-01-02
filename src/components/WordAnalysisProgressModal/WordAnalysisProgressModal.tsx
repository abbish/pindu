/**
 * 批量单词分析进度展示组件
 */

import React, { useState, useCallback } from 'react';
import { wordAnalysisService } from '../../services/wordAnalysisService';
import type { BatchAnalysisProgress, BatchAnalysisResult } from '../../types/word-analysis';
import styles from './WordAnalysisProgressModal.module.css';

interface WordAnalysisProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (result: BatchAnalysisResult) => void;
  onError: (error: Error) => void;
}

export const WordAnalysisProgressModal: React.FC<WordAnalysisProgressModalProps> = ({
  isOpen,
  onClose,
  onError,
}) => {
  const [progress, setProgress] = useState<BatchAnalysisProgress>({
    status: 'idle',
    currentStep: '准备中',
    extractionProgress: null,
    analysisProgress: null,
    wordStatuses: null,
  });

  const [error, setError] = useState<string | null>(null);

  // 处理错误
  const handleError = useCallback((err: Error) => {
    setError(err.message);
    onError(err);
  }, [onError]);

  // 计算进度百分比
  const progressPercent = wordAnalysisService.calculateOverallProgress(progress);

  // 格式化进度文本
  const progressText = wordAnalysisService.formatProgressText(progress);

  // 估算剩余时间
  const remainingTime = wordAnalysisService.estimateRemainingTime(progress);

  // 格式化时间
  const formatTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${Math.round(seconds)}秒`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}分${secs}秒`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}小时${mins}分`;
    }
  };

  // 取消分析
  const handleCancel = async () => {
    try {
      await wordAnalysisService.cancelBatchAnalysis();
      setProgress(prev => ({
        ...prev,
        status: 'error',
        currentStep: '已取消',
      }));
      onClose();
    } catch (err) {
      handleError(err instanceof Error ? err : new Error('取消失败'));
    }
  };

  // 获取阶段图标
  const getPhaseIcon = (status: string): string => {
    switch (status) {
      case 'idle':
        return '⏳';
      case 'extracting':
        return '📝';
      case 'analyzing':
        return '🔍';
      case 'completed':
        return '✅';
      case 'error':
        return '❌';
      default:
        return '⏳';
    }
  };

  // 获取阶段颜色
  const getPhaseColor = (status: string): string => {
    switch (status) {
      case 'idle':
        return '#6c757d';
      case 'extracting':
        return '#007bff';
      case 'analyzing':
        return '#28a745';
      case 'completed':
        return '#17a2b8';
      case 'error':
        return '#dc3545';
      default:
        return '#6c757d';
    }
  };

  // 获取已用时间
  const getElapsedTime = (): number => {
    if (progress.analysisProgress) {
      return progress.analysisProgress.elapsedSeconds;
    } else if (progress.extractionProgress) {
      return progress.extractionProgress.elapsedSeconds;
    }
    return 0;
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            {getPhaseIcon(progress.status)} 批量分析进度
          </h2>
          {(progress.status === 'extracting' || progress.status === 'analyzing') && (
            <button
              className={styles.closeButton}
              onClick={handleCancel}
            >
              取消
            </button>
          )}
        </div>

        <div className={styles.content}>
          {/* 进度条 */}
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <span className={styles.progressText}>{progressText}</span>
              <span className={styles.progressPercent}>{progressPercent.toFixed(1)}%</span>
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: getPhaseColor(progress.status),
                }}
              />
            </div>
          </div>

          {/* 时间信息 */}
          <div className={styles.timeSection}>
            <div className={styles.timeItem}>
              <span className={styles.timeLabel}>已用时间:</span>
              <span className={styles.timeValue}>{formatTime(getElapsedTime())}</span>
            </div>
            {remainingTime !== null && (progress.status === 'extracting' || progress.status === 'analyzing') && (
              <div className={styles.timeItem}>
                <span className={styles.timeLabel}>预计剩余:</span>
                <span className={styles.timeValue}>{formatTime(remainingTime)}</span>
              </div>
            )}
          </div>

          {/* 提取阶段：显示loading状态，因为提取是单次API调用 */}
          {progress.status === 'extracting' && (
            <div className={styles.detailSection}>
              <h3 className={styles.detailTitle}>提取进度</h3>
              <div className={styles.detailContent}>
                <div className={styles.loadingContainer}>
                  <div className={styles.spinner}>
                    <i className="fas fa-spinner fa-spin" />
                  </div>
                  <p className={styles.loadingText}>正在提取单词...</p>
                  <p className={styles.loadingSubtext}>AI 正在分析文本并提取所有单词，请稍候</p>
                </div>
              </div>
            </div>
          )}

          {progress.analysisProgress && progress.status === 'analyzing' && (
            <div className={styles.detailSection}>
              <h3 className={styles.detailTitle}>分析进度</h3>
              <div className={styles.detailContent}>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>总单词数:</span>
                  <span className={styles.detailValue}>{progress.analysisProgress.totalWords}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>已完成:</span>
                  <span className={styles.detailValue}>{progress.analysisProgress.completedWords}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>失败:</span>
                  <span className={styles.detailValue}>{progress.analysisProgress.failedWords}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>当前单词:</span>
                  <span className={styles.detailValue}>
                    {progress.analysisProgress.currentWord || '-'}
                  </span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>批次进度:</span>
                  <span className={styles.detailValue}>
                    {progress.analysisProgress.batchInfo.completedBatches + 1} /{' '}
                    {progress.analysisProgress.batchInfo.totalBatches}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {error && (
            <div className={styles.errorSection}>
              <div className={styles.errorIcon}>⚠️</div>
              <div className={styles.errorText}>{error}</div>
            </div>
          )}

          {/* 完成状态 */}
          {progress.status === 'completed' && (
            <div className={styles.successSection}>
              <div className={styles.successIcon}>✅</div>
              <div className={styles.successText}>分析完成！</div>
              <button className={styles.closeButton} onClick={onClose}>
                关闭
              </button>
            </div>
          )}

          {/* 失败状态 */}
          {progress.status === 'error' && (
            <div className={styles.failedSection}>
              <div className={styles.failedIcon}>❌</div>
              <div className={styles.failedText}>分析失败</div>
              <button className={styles.closeButton} onClick={onClose}>
                关闭
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
