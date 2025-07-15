import React from 'react';
import styles from './StatsOverview.module.css';

export interface StatsCard {
  id: string;
  title: string;
  value: string | number;
  icon: string;
  color: 'primary' | 'green' | 'orange' | 'blue' | 'purple';
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
}

export interface StatsOverviewProps {
  /** Statistics data */
  stats: StatsCard[];
  /** Loading state */
  loading?: boolean;
}

/**
 * Statistics overview component displaying key metrics in cards
 */
export const StatsOverview: React.FC<StatsOverviewProps> = ({
  stats,
  loading = false
}) => {
  const getIconColorClass = (color: StatsCard['color']) => {
    const colorMap = {
      primary: styles.iconPrimary,
      green: styles.iconGreen,
      orange: styles.iconOrange,
      blue: styles.iconBlue,
      purple: styles.iconPurple
    };
    return colorMap[color] || styles.iconPrimary;
  };

  const getChangeColorClass = (changeType?: StatsCard['changeType']) => {
    const changeMap = {
      positive: styles.changePositive,
      negative: styles.changeNegative,
      neutral: styles.changeNeutral
    };
    return changeMap[changeType || 'neutral'] || '';
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.grid}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={`${styles.card} ${styles.cardLoading}`}>
              <div className={styles.loadingContent}>
                <div className={styles.loadingIcon} />
                <div className={styles.loadingText} />
                <div className={styles.loadingLabel} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {stats.map((stat) => (
          <div key={stat.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={`${styles.iconContainer} ${getIconColorClass(stat.color)}`}>
                <i className={`fas fa-${stat.icon}`} />
              </div>
              {stat.change && (
                <span className={`${styles.change} ${getChangeColorClass(stat.changeType)}`}>
                  {stat.change}
                </span>
              )}
            </div>
            <div className={styles.cardContent}>
              <h3 className={styles.value}>{stat.value}</h3>
              <p className={styles.title}>{stat.title}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default StatsOverview;