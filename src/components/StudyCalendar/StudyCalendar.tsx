import React from 'react';
import styles from './StudyCalendar.module.css';

export interface StudyCalendarProps {
  /** Study dates (YYYY-MM-DD format) */
  studyDates: string[];
  /** Current streak days */
  streakDays: number;
  /** Loading state */
  loading?: boolean;
}

/**
 * Study calendar component showing study progress
 */
export const StudyCalendar: React.FC<StudyCalendarProps> = ({
  studyDates,
  streakDays,
  loading = false
}) => {
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  
  // Get first day of month and number of days
  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  // Generate calendar days
  const calendarDays = [];
  
  // Add empty cells for days before month starts
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(null);
  }
  
  // Add days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  const formatDate = (day: number) => {
    const date = new Date(currentYear, currentMonth, day);
    return date.toISOString().split('T')[0];
  };

  const isStudyDate = (day: number) => {
    const dateString = formatDate(day);
    return studyDates.includes(dateString);
  };

  const isToday = (day: number) => {
    return day === today.getDate() && 
           currentMonth === today.getMonth() && 
           currentYear === today.getFullYear();
  };

  if (loading) {
    return (
      <div className={styles.calendar}>
        <h3 className={styles.title}>学习日历</h3>
        <div className={styles.loading}>
          <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.calendar}>
      <h3 className={styles.title}>学习日历</h3>
      
      <div className={styles.calendarGrid}>
        {/* Day headers */}
        {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
          <div key={day} className={styles.dayHeader}>
            {day}
          </div>
        ))}
        
        {/* Calendar days */}
        {calendarDays.map((day, index) => (
          <div
            key={index}
            className={`${styles.dayCell} ${
              day === null 
                ? styles.inactive 
                : isToday(day) 
                  ? styles.today
                  : isStudyDate(day)
                    ? styles.studied
                    : styles.active
            }`}
          >
            {day}
          </div>
        ))}
      </div>
      
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <div className={`${styles.legendDot} ${styles.studied}`} />
          <span className={styles.legendText}>已完成</span>
        </div>
        <span className={styles.streakText}>
          连续学习 {streakDays} 天
        </span>
      </div>
    </div>
  );
};

export default StudyCalendar;