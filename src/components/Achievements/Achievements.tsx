import React from 'react';
import styles from './Achievements.module.css';

export interface Achievement {
  id: string;
  name: string;
  value: string;
  icon: string;
  type: 'earned' | 'streak' | 'mastery' | 'accuracy';
  earned: boolean;
}

export interface AchievementsProps {
  /** Achievements data */
  achievements: Achievement[];
  /** Loading state */
  loading?: boolean;
}

/**
 * Achievements component showing study badges
 */
export const Achievements: React.FC<AchievementsProps> = ({
  achievements,
  loading = false
}) => {
  if (loading) {
    return (
      <div className={styles.achievements}>
        <h3 className={styles.title}>成就徽章</h3>
        <div className={styles.loading}>
          <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  if (achievements.length === 0) {
    return (
      <div className={styles.achievements}>
        <h3 className={styles.title}>成就徽章</h3>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-medal" />
          </div>
          <p className={styles.emptyText}>暂无成就徽章</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.achievements}>
      <h3 className={styles.title}>成就徽章</h3>
      
      <div className={styles.badgesGrid}>
        {achievements.map((achievement) => (
          <div
            key={achievement.id}
            className={`${styles.badgeItem} ${styles[achievement.type]}`}
            title={`${achievement.name}: ${achievement.value}`}
          >
            <div className={`${styles.badgeIcon} ${styles[achievement.type]}`}>
              <i className={`fas fa-${achievement.icon}`} />
            </div>
            <div className={styles.badgeName}>{achievement.name}</div>
            <div className={styles.badgeValue}>{achievement.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Achievements;