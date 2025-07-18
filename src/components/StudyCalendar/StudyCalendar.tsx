import React, { useState, useEffect } from 'react';
import type { StudyPlanAIResult, CalendarDayData } from '../../types';
import styles from './StudyCalendar.module.css';

export interface StudyCalendarProps {
  /** AI规划数据 */
  aiPlanData: StudyPlanAIResult | null;
  /** 日期点击回调 */
  onDateClick: (date: string) => void;
  /** Loading state */
  loading?: boolean;
}

/**
 * Study calendar component showing study progress
 */
export const StudyCalendar: React.FC<StudyCalendarProps> = ({
  aiPlanData,
  onDateClick,
  loading = false
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarData, setCalendarData] = useState<CalendarDayData[]>([]);

  // 生成日历数据
  useEffect(() => {
    if (!aiPlanData) return;

    const today = new Date();
    const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);

    const startOfCalendar = new Date(startOfMonth);
    startOfCalendar.setDate(startOfCalendar.getDate() - startOfCalendar.getDay());

    const days: CalendarDayData[] = [];
    const currentDate = new Date(startOfCalendar);

    // 生成6周的日历数据
    for (let week = 0; week < 6; week++) {
      for (let day = 0; day < 7; day++) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const isToday = currentDate.toDateString() === today.toDateString();
        const isInCurrentMonth = currentDate.getMonth() === currentMonth.getMonth();

        // 查找该日期的学习计划
        const dailyPlan = aiPlanData.dailyPlans.find(plan => plan.date === dateStr);
        const isInPlan = !!dailyPlan;

        let status: CalendarDayData['status'] = 'not-started';
        let newWordsCount = 0;
        let reviewWordsCount = 0;
        let totalWordsCount = 0;
        let completedWordsCount = 0;
        let progressPercentage = 0;

        if (dailyPlan) {
          newWordsCount = dailyPlan.words.filter(w => !w.isReview).length;
          reviewWordsCount = dailyPlan.words.filter(w => w.isReview).length;
          totalWordsCount = dailyPlan.words.length;

          // 模拟完成状态计算
          if (currentDate < today) {
            // 过去的日期，模拟完成状态
            completedWordsCount = Math.floor(totalWordsCount * 0.8); // 假设80%完成率
            progressPercentage = (completedWordsCount / totalWordsCount) * 100;

            if (progressPercentage >= 100) {
              status = 'completed';
            } else if (progressPercentage > 0) {
              status = 'overdue';
            } else {
              status = 'overdue';
            }
          } else if (currentDate.toDateString() === today.toDateString()) {
            // 今天，模拟进行中状态
            completedWordsCount = Math.floor(totalWordsCount * 0.3); // 假设30%完成
            progressPercentage = (completedWordsCount / totalWordsCount) * 100;
            status = 'in-progress';
          } else {
            // 未来的日期
            status = 'not-started';
          }
        }

        days.push({
          date: dateStr,
          isToday,
          isInPlan: isInPlan && isInCurrentMonth,
          status,
          newWordsCount,
          reviewWordsCount,
          totalWordsCount,
          completedWordsCount,
          progressPercentage
        });

        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    setCalendarData(days);
  }, [currentMonth, aiPlanData]);

  // 切换月份
  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  // 获取月份名称
  const getMonthName = (date: Date) => {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  };

  // 渲染日历头部
  const renderHeader = () => (
    <div className={styles.calendarHeader}>
      <button
        className={styles.navButton}
        onClick={handlePrevMonth}
        type="button"
        aria-label="上个月"
      >
        <i className="fas fa-chevron-left" />
      </button>
      <h3 className={styles.monthTitle}>{getMonthName(currentMonth)}</h3>
      <button
        className={styles.navButton}
        onClick={handleNextMonth}
        type="button"
        aria-label="下个月"
      >
        <i className="fas fa-chevron-right" />
      </button>
    </div>
  );

  // 渲染星期标题
  const renderWeekdays = () => {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return (
      <div className={styles.weekdaysRow}>
        {weekdays.map(day => (
          <div key={day} className={styles.weekdayCell}>
            {day}
          </div>
        ))}
      </div>
    );
  };

  // 渲染日期单元格
  const renderDayCell = (dayData: CalendarDayData) => {
    const date = new Date(dayData.date);
    const dayNumber = date.getDate();
    const isCurrentMonth = date.getMonth() === currentMonth.getMonth();

    const cellClasses = [
      styles.dayCell,
      dayData.isToday ? styles.today : '',
      !isCurrentMonth ? styles.otherMonth : '',
      dayData.isInPlan ? styles.inPlan : '',
      dayData.isInPlan ? styles[dayData.status] : ''
    ].filter(Boolean).join(' ');

    return (
      <div
        key={dayData.date}
        className={cellClasses}
        onClick={() => dayData.isInPlan && onDateClick(dayData.date)}
      >
        <div className={styles.dayNumber}>{dayNumber}</div>

        {dayData.isInPlan && (
          <>
            <div className={styles.wordCounts}>
              {dayData.newWordsCount > 0 && (
                <span className={styles.newWords}>新{dayData.newWordsCount}</span>
              )}
              {dayData.reviewWordsCount > 0 && (
                <span className={styles.reviewWords}>复{dayData.reviewWordsCount}</span>
              )}
            </div>

            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ '--progress-width': `${dayData.progressPercentage}%` } as React.CSSProperties}
              />
            </div>
          </>
        )}
      </div>
    );
  };

  // 渲染日历网格
  const renderCalendarGrid = () => {
    const weeks = [];
    for (let i = 0; i < calendarData.length; i += 7) {
      const week = calendarData.slice(i, i + 7);
      weeks.push(
        <div key={i} className={styles.weekRow}>
          {week.map(dayData => renderDayCell(dayData))}
        </div>
      );
    }
    return weeks;
  };

  if (loading) {
    return (
      <div className={styles.studyCalendar}>
        <div className={styles.loading}>
          <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.studyCalendar}>
      {renderHeader()}
      {renderWeekdays()}
      <div className={styles.calendarGrid}>
        {renderCalendarGrid()}
      </div>

      {/* 图例 */}
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <div className={`${styles.legendColor} ${styles.notStarted}`} />
          <span>未开始</span>
        </div>
        <div className={styles.legendItem}>
          <div className={`${styles.legendColor} ${styles.inProgress}`} />
          <span>进行中</span>
        </div>
        <div className={styles.legendItem}>
          <div className={`${styles.legendColor} ${styles.completed}`} />
          <span>已完成</span>
        </div>
        <div className={styles.legendItem}>
          <div className={`${styles.legendColor} ${styles.overdue}`} />
          <span>逾期</span>
        </div>
      </div>
    </div>
  );
};

export default StudyCalendar;