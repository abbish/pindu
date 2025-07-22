import React, { useMemo } from 'react';
import styles from './StudyPlanCard.module.css';
import type { StudyPlanWithProgress, UnifiedStudyPlanStatus } from '../../types';
import { getStatusDisplay } from '../../types/study';

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
function getMasteryDisplay(level: number) {
  const stars = Math.min(Math.max(Math.floor(level / 20), 1), 5);
  let text = '';
  let color = '';

  if (level >= 80) {
    text = '精通';
    color = 'var(--color-green)';
  } else if (level >= 60) {
    text = '熟练';
    color = 'var(--color-blue)';
  } else if (level >= 40) {
    text = '一般';
    color = 'var(--color-orange)';
  } else {
    text = '初学';
    color = 'var(--color-red)';
  }

  return { text, color, stars };
}

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
  // Get unified status
  const unifiedStatus = plan.unified_status ||
    (plan.status === 'deleted' ? 'Deleted' :
     plan.status === 'draft' ? 'Draft' :
     plan.lifecycle_status === 'pending' ? 'Pending' :
     plan.lifecycle_status === 'active' ? 'Active' :
     plan.lifecycle_status === 'completed' ? 'Completed' :
     plan.lifecycle_status === 'terminated' ? 'Terminated' : 'Draft');

  const statusDisplay = getStatusDisplay(unifiedStatus as UnifiedStudyPlanStatus);
  const masteryDisplay = getMasteryDisplay(plan.mastery_level);

  // 计算时间进度
  const timeProgress = useMemo(() => {
    if (!plan.start_date || !plan.end_date) return 0;

    const startDate = new Date(plan.start_date);
    const endDate = new Date(plan.end_date);
    const today = new Date();

    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const passedDays = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    return Math.min(Math.max((passedDays / totalDays) * 100, 0), 100);
  }, [plan.start_date, plan.end_date]);

  // 计算实际进度
  const actualProgress = useMemo(() => {
    if (plan.total_words === 0) return 0;
    return (plan.learned_words / plan.total_words) * 100;
  }, [plan.learned_words, plan.total_words]);

  // 模拟日程进度数据（实际应该从API获取）
  const scheduleProgress: ScheduleProgress = useMemo(() => {
    const total = plan.study_period_days || 10;
    const completed = Math.floor(actualProgress / 100 * total);
    const overdue = Math.max(0, Math.floor(timeProgress / 100 * total) - completed);
    const upcoming = total - completed - overdue;

    return { total, completed, overdue, upcoming };
  }, [plan.study_period_days, actualProgress, timeProgress]);

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
          <span className={styles.statValue}>{plan.learned_words}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>平均正确率</span>
          <span className={styles.statValue}>
            {plan.accuracy_rate ? `${(plan.accuracy_rate * 100).toFixed(1)}%` : '暂无数据'}
          </span>
        </div>
      </div>

      {/* 日程进度 */}
      <div className={styles.scheduleSection}>
        <div className={styles.scheduleHeader}>
          <span className={styles.scheduleLabel}>日程进度</span>
          <span className={styles.scheduleStats}>
            {scheduleProgress.completed}/{scheduleProgress.total}
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
          <span className={styles.progressValue}>{plan.progress_percentage.toFixed(0)}%</span>
        </div>
        <div className={styles.progressBar}>
          <div 
            className={styles.progressFill}
            style={{ 
              width: `${plan.progress_percentage}%`,
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