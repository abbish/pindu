import React from 'react';
import styles from './StudyPlanSection.module.css';
import { StudyPlanCard } from '../StudyPlanCard';
import type { StudyPlanWithProgress } from '../../types';

export interface StudyPlanSectionProps {
  /** Section title */
  title: string;
  /** Status indicator color */
  statusColor: 'green' | 'yellow' | 'blue' | 'primary';
  /** Number of plans in this section */
  count: number;
  /** Study plans data */
  plans: StudyPlanWithProgress[];
  /** Plan click handler */
  onPlanClick?: (planId: number) => void;
  /** Study start handler */
  onStudyStart?: (planId: number) => void;
  /** Menu action handler */
  onMenuAction?: (planId: number, action: string) => void;
  /** Loading state */
  loading?: boolean;
}

/**
 * Study plan section component for grouping plans by status
 */
export const StudyPlanSection: React.FC<StudyPlanSectionProps> = ({
  title,
  statusColor,
  count,
  plans,
  onPlanClick,
  onStudyStart,
  onMenuAction,
  loading = false
}) => {
  const getStatusColorClass = () => {
    const colorMap = {
      green: styles.statusGreen,
      yellow: styles.statusYellow,
      blue: styles.statusBlue,
      primary: styles.statusPrimary
    };
    return colorMap[statusColor] || styles.statusPrimary;
  };

  if (loading) {
    return (
      <div className={styles.section}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <div className={`${styles.statusDot} ${getStatusColorClass()}`} />
            <h3 className={styles.title}>{title}</h3>
            <span className={`${styles.count} ${getStatusColorClass()}`}>
              {count}
            </span>
          </div>
        </div>
        <div className={styles.grid}>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className={styles.loadingCard}>
              <div className={styles.loadingContent}>
                <div className={styles.loadingHeader} />
                <div className={styles.loadingProgress} />
                <div className={styles.loadingStats} />
                <div className={styles.loadingButton} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className={styles.section}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <div className={`${styles.statusDot} ${getStatusColorClass()}`} />
            <h3 className={styles.title}>{title}</h3>
            <span className={`${styles.count} ${getStatusColorClass()}`}>
              {count}
            </span>
          </div>
        </div>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-folder-open" />
          </div>
          <p className={styles.emptyText}>暂无{title}的学习计划</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <div className={`${styles.statusDot} ${getStatusColorClass()}`} />
          <h3 className={styles.title}>{title}</h3>
          <span className={`${styles.count} ${getStatusColorClass()}`}>
            {count}
          </span>
        </div>
      </div>
      
      <div className={styles.grid}>
        {plans.map((plan) => (
          <StudyPlanCard
            key={plan.id}
            plan={plan}
            variant="compact"
            onClick={onPlanClick}
            onActionClick={onStudyStart}
            onMenuAction={onMenuAction}
          />
        ))}
      </div>
    </div>
  );
};

export default StudyPlanSection;