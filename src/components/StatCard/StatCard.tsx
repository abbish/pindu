import React from 'react';
import styles from './StatCard.module.css';

export interface StatCardProps {
  /** Stat icon (Font Awesome class) */
  icon: string;
  /** Icon color variant */
  iconColor: 'primary' | 'green' | 'orange' | 'yellow' | 'blue' | 'purple' | 'pink';
  /** Stat label */
  label: string;
  /** Stat value */
  value: number | string;
  /** Value unit */
  unit: string;
  /** Loading state */
  loading?: boolean;
}

/**
 * Statistical data card component
 */
export const StatCard: React.FC<StatCardProps> = ({
  icon,
  iconColor,
  label,
  value,
  unit,
  loading = false
}) => {
  if (loading) {
    return (
      <div className={`${styles.statCard} ${styles.loading}`}>
        <div className={styles.header}>
          <div className={`${styles.icon} ${styles[iconColor]}`}>
            <i className={`fas fa-${icon}`} />
          </div>
          <span className={styles.label}>{label}</span>
        </div>
        <div className={styles.value}>---</div>
        <div className={styles.unit}>{unit}</div>
      </div>
    );
  }

  return (
    <div className={styles.statCard}>
      <div className={styles.header}>
        <div className={`${styles.icon} ${styles[iconColor]}`}>
          <i className={`fas fa-${icon}`} />
        </div>
        <span className={styles.label}>{label}</span>
      </div>
      <div className={styles.value}>{value}</div>
      <div className={styles.unit}>{unit}</div>
    </div>
  );
};

export default StatCard;