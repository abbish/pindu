import React, { useMemo, useState, useEffect } from 'react';
import styles from './StudyPlanCard.module.css';
import type { StudyPlanWithProgress, UnifiedStudyPlanStatus, StudyPlanStatistics } from '../../types';
import { getStatusDisplay } from '../../types/study';
import { studyService } from '../../services/studyService';

export interface StudyPlanCardProps {
  /** Study plan data */
  plan: StudyPlanWithProgress;
  /** Card display variant - compact for study plans page, full for homepage */
  variant?: 'full' | 'compact';
  /** Card click handler */
  onClick?: (planId: number) => void;
  /** Action button click handler */
  onActionClick?: (planId: number) => void;
  /** Menu action handler */
  onMenuAction?: (planId: number, action: string) => void;
}

interface ScheduleProgress {
  total: number;
  completed: number;
  overdue: number;
  upcoming: number;
}

// 辅助函数


/**
 * Study plan card component displaying plan information and progress
 */
export const StudyPlanCard: React.FC<StudyPlanCardProps> = ({
  plan,
  variant = 'full',
  onClick,
  onActionClick,
  onMenuAction
}) => {
  // 统计数据状态
  const [statistics, setStatistics] = useState<StudyPlanStatistics | null>(null);
  const [statisticsLoading, setStatisticsLoading] = useState(false);

  // 获取统计数据
  useEffect(() => {
    const loadStatistics = async () => {
      setStatisticsLoading(true);
      try {
        const result = await studyService.getStudyPlanStatistics(plan.id);
        if (result.success) {
          setStatistics(result.data);
        }
      } catch (error) {
        console.warn('Failed to load plan statistics:', error);
      } finally {
        setStatisticsLoading(false);
      }
    };

    loadStatistics();
  }, [plan.id]);

  // Get unified status
  const unifiedStatus = plan.unified_status ||
    (plan.status === 'deleted' ? 'Deleted' :
     plan.status === 'draft' ? 'Draft' :
     plan.lifecycle_status === 'pending' ? 'Pending' :
     plan.lifecycle_status === 'active' ? 'Active' :
     plan.lifecycle_status === 'completed' ? 'Completed' :
     plan.lifecycle_status === 'terminated' ? 'Terminated' : 'Draft');

  const statusDisplay = getStatusDisplay(unifiedStatus as UnifiedStudyPlanStatus);


  // 计算时间进度 - 与详情页面保持一致
  const timeProgress = useMemo(() => {
    if (!plan.start_date || !plan.end_date) return 0;

    const startDate = new Date(plan.start_date);
    const endDate = new Date(plan.end_date);
    const today = new Date();

    // 设置时间为当天开始，避免时区问题
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    today.setHours(0, 0, 0, 0);

    // 如果还没开始，时间进度为0%
    if (today < startDate) return 0;

    // 如果已经结束，时间进度为100%
    if (today > endDate) return 100;

    // 计算当前时间进度 - 与详情页面相同的逻辑
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1; // +1 包含开始日期
    const passedDays = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)); // 开始日期当天为0

    return Math.min(100, Math.max(0, (passedDays / totalDays) * 100));
  }, [plan.start_date, plan.end_date]);

  // 计算实际进度 - 使用统计数据
  const actualProgress = useMemo(() => {
    if (statistics) {
      return (statistics as any).actual_progress_percentage || 0;
    }
    // 如果统计数据还在加载，返回0作为占位符
    return 0;
  }, [statistics]);

  // 计算日程进度数据 - 基于统计数据
  const scheduleProgress: ScheduleProgress = useMemo(() => {
    if (statistics) {
      // 使用统计数据中的实际天数信息
      const total = (statistics as any).total_days || plan.study_period_days || 3;
      const completed = (statistics as any).completed_days || 0;
      const overdue = (statistics as any).overdue_days || 0;
      const upcoming = total - completed - overdue;

      return { total, completed, overdue, upcoming };
    } else {
      // 如果统计数据还在加载，使用保守的估算
      const total = plan.study_period_days || 3;
      const completed = 0; // 保守估计，等待统计数据
      const overdue = 0;
      const upcoming = total;

      return { total, completed, overdue, upcoming };
    }
  }, [statistics, plan.study_period_days]);

  const handleCardClick = () => {
    onClick?.(plan.id);
  };

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onActionClick?.(plan.id);
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // TODO: Show context menu
    onMenuAction?.(plan.id, 'menu');
  };

  // 渲染日程进度小方块
  const renderScheduleBlocks = () => {
    const blocks = [];

    // 已完成的日程（绿色）
    for (let i = 0; i < scheduleProgress.completed; i++) {
      blocks.push(
        <div key={`completed-${i}`} className={`${styles.scheduleBlock} ${styles.completed}`} />
      );
    }

    // 延期的日程（红色）
    for (let i = 0; i < scheduleProgress.overdue; i++) {
      blocks.push(
        <div key={`overdue-${i}`} className={`${styles.scheduleBlock} ${styles.overdue}`} />
      );
    }

    // 未开始的日程（灰色）
    for (let i = 0; i < scheduleProgress.upcoming; i++) {
      blocks.push(
        <div key={`upcoming-${i}`} className={`${styles.scheduleBlock} ${styles.upcoming}`} />
      );
    }

    return blocks;
  };

  const getProgressColor = () => {
    if (plan.lifecycle_status === 'completed') return 'var(--color-green)';
    if (plan.status === 'draft') return 'var(--color-orange)';
    if (plan.lifecycle_status === 'pending') return 'var(--color-blue)';
    return 'var(--color-primary)';
  };

  const getActionButtonText = () => {
    if (plan.status === 'draft') return '编辑计划';
    if (plan.lifecycle_status === 'completed') return '重新学习';
    if (plan.lifecycle_status === 'terminated') return '重新学习';
    if (plan.lifecycle_status === 'pending') return '开始学习';
    if (plan.lifecycle_status === 'active') return '继续学习';
    return '查看详情';
  };

  const getActionButtonColor = () => {
    if (plan.lifecycle_status === 'completed') return 'var(--color-blue)';
    if (plan.lifecycle_status === 'terminated') return 'var(--color-blue)';
    if (plan.status === 'draft') return 'var(--color-orange)';
    if (plan.lifecycle_status === 'pending') return 'var(--color-blue)';
    return 'var(--color-primary)';
  };

  // 基础内容结构（以首页为标准）
  const cardContent = (
    <>
      {/* Header - 状态标签和菜单 */}
      <div className={styles.header}>
        <span className={`${styles.status} ${styles[statusDisplay.color]}`}>
          {statusDisplay.text}
        </span>
        <button className={styles.menuBtn} onClick={handleMenuClick}>
          <i className="fas fa-ellipsis-v" />
        </button>
      </div>

      {/* Title and Description */}
      <div className={styles.content}>
        <h4 className={styles.title}>{plan.name}</h4>
        <p className={styles.description}>{plan.description}</p>
      </div>

      {/* 基本信息 */}
      <div className={styles.basicInfo}>
        <div className={styles.infoRow}>
          <span className={styles.label}>总单词数:</span>
          <span className={styles.value}>{plan.total_words}</span>
        </div>
        <div className={`${styles.infoRow} ${styles.multiGroup}`}>
          <div className={styles.infoGroup}>
            <span className={styles.label}>学习强度:</span>
            <span className={styles.value}>
              {plan.intensity_level === 'easy' ? '轻松' :
               plan.intensity_level === 'normal' ? '普通' :
               plan.intensity_level === 'intensive' ? '密集' : '普通'}
            </span>
          </div>
          <div className={styles.infoGroup}>
            <span className={styles.label}>学习周期:</span>
            <span className={styles.value}>{plan.study_period_days || 0} 天</span>
          </div>
        </div>
      </div>

      {/* 时间信息 */}
      {(plan.start_date || plan.end_date) && (
        <div className={styles.timeInfo}>
          <div className={`${styles.infoRow} ${styles.multiGroup}`}>
            {plan.start_date && (
              <div className={styles.infoGroup}>
                <span className={styles.label}>开始时间:</span>
                <span className={styles.value}>{plan.start_date}</span>
              </div>
            )}
            {plan.end_date && (
              <div className={styles.infoGroup}>
                <span className={styles.label}>结束时间:</span>
                <span className={styles.value}>{plan.end_date}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 进度信息 */}
      <div className={styles.progressSection}>
        <div className={styles.progressRow}>
          <div className={styles.progressItem}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>时间进度</span>
              <span className={styles.progressValue}>{timeProgress.toFixed(1)}%</span>
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${timeProgress}%` }}
              />
            </div>
          </div>

          <div className={styles.progressItem}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>学习进度</span>
              <span className={styles.progressValue}>{actualProgress.toFixed(1)}%</span>
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${actualProgress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 统计信息 */}
      <div className={styles.statsSection}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>已学单词</span>
          <span className={styles.statValue}>
            {statisticsLoading ? '加载中...' :
             statistics ? (statistics as any).completed_words || 0 :
             0}
          </span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>平均正确率</span>
          <span className={styles.statValue}>
            {statisticsLoading ? '加载中...' :
             statistics ? `${Math.round((statistics as any).average_accuracy_rate || 0)}%` :
             '暂无数据'}
          </span>
        </div>
      </div>

      {/* 日程进度 */}
      <div className={styles.scheduleSection}>
        <div className={styles.scheduleHeader}>
          <span className={styles.scheduleLabel}>日程进度</span>
          <span className={styles.scheduleStats}>
            {statisticsLoading ? '加载中...' :
             statistics ? `${(statistics as any).completed_days || 0}/${(statistics as any).total_days || plan.study_period_days || 0}` :
             `${scheduleProgress.completed}/${scheduleProgress.total}`}
          </span>
        </div>
        <div className={styles.scheduleBlocks}>
          {renderScheduleBlocks()}
        </div>
        <div className={styles.scheduleLegend}>
          <div className={styles.legendItem}>
            <div className={`${styles.legendBlock} ${styles.completed}`} />
            <span>已完成</span>
          </div>
          <div className={styles.legendItem}>
            <div className={`${styles.legendBlock} ${styles.overdue}`} />
            <span>延期</span>
          </div>
          <div className={styles.legendItem}>
            <div className={`${styles.legendBlock} ${styles.upcoming}`} />
            <span>未开始</span>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className={styles.progress}>
        <div className={styles.progressHeader}>
          <span className={styles.progressLabel}>学习进度</span>
          <span className={styles.progressValue}>{actualProgress.toFixed(0)}%</span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{
              width: `${actualProgress}%`,
              backgroundColor: getProgressColor()
            }}
          />
        </div>
      </div>

      {/* Action Button */}
      <button 
        className={styles.actionBtn}
        style={{ backgroundColor: getActionButtonColor() }}
        onClick={onActionClick ? handleActionClick : handleCardClick}
      >
        {getActionButtonText()}
      </button>
    </>
  );

  // 根据 variant 返回不同的布局容器
  if (variant === 'compact') {
    return (
      <div className={`${styles.card} ${styles.cardCompact}`} onClick={handleCardClick}>
        {cardContent}
      </div>
    );
  }

  // Full variant (default for homepage)
  return (
    <div className={styles.card} onClick={handleCardClick}>
      {cardContent}
    </div>
  );
};

export default StudyPlanCard;