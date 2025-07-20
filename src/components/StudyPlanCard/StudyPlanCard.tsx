import React from 'react';
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
  const statusDisplay = getStatusDisplay(plan.unified_status as UnifiedStudyPlanStatus);
  const masteryDisplay = getMasteryDisplay(plan.mastery_level);

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

      {/* Statistics - 核心数据展示 */}
      <div className={styles.stats}>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>总单词数</span>
          <span className={styles.statValue}>{plan.total_words}</span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>已学习</span>
          <span className={styles.statValue}>{plan.learned_words}</span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>正确率</span>
          <span 
            className={styles.statValue}
            style={{ color: plan.accuracy_rate >= 80 ? 'var(--color-green)' : 'var(--color-orange)' }}
          >
            {plan.accuracy_rate.toFixed(0)}%
          </span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>巩固强度</span>
          <div className={styles.mastery}>
            <span 
              className={styles.masteryText}
              style={{ color: masteryDisplay.color }}
            >
              {masteryDisplay.text}
            </span>
            <div className={styles.stars}>
              {Array.from({ length: 5 }, (_, index) => (
                <i
                  key={index}
                  className={`${index < masteryDisplay.stars ? 'fas' : 'far'} fa-star`}
                  style={{ 
                    color: index < masteryDisplay.stars ? masteryDisplay.color : 'var(--color-border-dark)'
                  }}
                />
              ))}
            </div>
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