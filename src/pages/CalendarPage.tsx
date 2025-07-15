import React, { useState, useMemo } from 'react';
import styles from './CalendarPage.module.css';
import { Header, Breadcrumb, Button } from '../components';

// 学习状态枚举
export type StudyStatus = 'completed' | 'partial' | 'missed' | 'planned' | 'today';

// 每日学习数据接口
export interface DayData {
  date: number;
  status: StudyStatus;
  wordsLearned: number;
  targetWords: number;
  plans: string[];
}

// 学习计划接口
export interface StudyPlan {
  id: string;
  name: string;
  color: string;
  startDate: Date;
  endDate: Date;
  targetWords: number;
  completedWords: number;
}

// 月度统计接口
export interface MonthlyStats {
  studyDays: number;
  totalDays: number;
  wordsLearned: number;
  averageDaily: number;
  streakDays: number;
}

// 今日计划接口
export interface TodayPlan {
  id: string;
  name: string;
  color: string;
  icon: string;
  targetWords: number;
  completedWords: number;
}

export interface CalendarPageProps {
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * 日历页面组件
 */
export const CalendarPage: React.FC<CalendarPageProps> = ({ onNavigate }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const today = new Date();

  // Mock 数据
  const studyPlans: StudyPlan[] = [
    {
      id: '1',
      name: '基础词汇',
      color: 'var(--color-primary)',
      startDate: new Date(2024, 0, 1),
      endDate: new Date(2024, 0, 7),
      targetWords: 140,
      completedWords: 140
    },
    {
      id: '2',
      name: '动物世界',
      color: 'var(--color-orange)',
      startDate: new Date(2024, 0, 3),
      endDate: new Date(2024, 0, 10),
      targetWords: 120,
      completedWords: 95
    },
    {
      id: '3',
      name: '颜色认知',
      color: 'var(--color-purple)',
      startDate: new Date(2024, 0, 8),
      endDate: new Date(2024, 0, 14),
      targetWords: 105,
      completedWords: 0
    },
    {
      id: '4',
      name: '日常用品',
      color: 'var(--color-blue)',
      startDate: new Date(2024, 0, 12),
      endDate: new Date(2024, 0, 18),
      targetWords: 90,
      completedWords: 0
    }
  ];

  const todayPlans: TodayPlan[] = [
    {
      id: '1',
      name: '基础词汇',
      color: 'var(--color-primary)',
      icon: 'book',
      targetWords: 20,
      completedWords: 0
    },
    {
      id: '3',
      name: '颜色认知',
      color: 'var(--color-purple)',
      icon: 'palette',
      targetWords: 15,
      completedWords: 0
    }
  ];

  const monthlyStats: MonthlyStats = {
    studyDays: 9,
    totalDays: 13,
    wordsLearned: 284,
    averageDaily: 31.6,
    streakDays: 3
  };

  // 生成日历数据
  const calendarData = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    const endDate = new Date(lastDay);

    // 调整到周一开始
    const dayOfWeek = (firstDay.getDay() + 6) % 7;
    startDate.setDate(firstDay.getDate() - dayOfWeek);
    endDate.setDate(lastDay.getDate() + (6 - ((lastDay.getDay() + 6) % 7)));

    const days: DayData[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const dateNum = current.getDate();
      const isCurrentMonth = current.getMonth() === month;
      const isToday = current.toDateString() === today.toDateString();
      
      let status: StudyStatus = 'planned';
      let wordsLearned = 0;

      if (isCurrentMonth && current <= today) {
        if (isToday) {
          status = 'today';
        } else {
          // Mock 学习数据
          const dayOfMonth = current.getDate();
          if ([4, 11].includes(dayOfMonth)) {
            status = 'missed';
            wordsLearned = 0;
          } else if ([3, 8].includes(dayOfMonth)) {
            status = 'partial';
            wordsLearned = Math.floor(Math.random() * 20) + 10;
          } else {
            status = 'completed';
            wordsLearned = Math.floor(Math.random() * 20) + 20;
          }
        }
      }

      if (isCurrentMonth) {
        days.push({
          date: dateNum,
          status,
          wordsLearned,
          targetWords: 35,
          plans: []
        });
      } else {
        days.push({
          date: dateNum,
          status: 'planned',
          wordsLearned: 0,
          targetWords: 0,
          plans: []
        });
      }

      current.setDate(current.getDate() + 1);
    }

    return days;
  }, [currentDate, today]);

  const handleNavChange = (page: string) => {
    onNavigate?.(page);
  };

  const handleBreadcrumbClick = (key: string) => {
    onNavigate?.(key);
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleCreatePlan = () => {
    onNavigate?.('create-plan');
  };

  const handleStartStudy = () => {
    onNavigate?.('plans');
  };

  const handlePlanClick = (planId: string) => {
    onNavigate?.('plan-detail', { planId: parseInt(planId) });
  };

  const formatMonth = (date: Date) => {
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  };

  const getStatusIcon = (status: StudyStatus) => {
    switch (status) {
      case 'completed':
        return 'fa-check';
      case 'partial':
        return 'fa-clock';
      case 'missed':
        return 'fa-times';
      case 'today':
        return 'fa-play';
      default:
        return 'fa-calendar';
    }
  };

  const getStatusColor = (status: StudyStatus) => {
    switch (status) {
      case 'completed':
        return 'var(--color-green)';
      case 'partial':
        return 'var(--color-orange)';
      case 'missed':
        return 'var(--color-pink)';
      case 'today':
        return 'var(--color-primary)';
      default:
        return 'var(--color-text-secondary)';
    }
  };

  return (
    <div className={styles.page}>
      {/* Global Header */}
      <Header 
        activeNav="calendar"
        onNavChange={handleNavChange}
      />

      <main className={styles.main}>
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: '首页', key: 'home', icon: 'home' }
          ]}
          current="学习日历"
          onNavigate={handleBreadcrumbClick}
        />

        {/* Page Header */}
        <section className={styles.pageHeader}>
          <div className={styles.headerContent}>
            <div className={styles.headerInfo}>
              <h1 className={styles.pageTitle}>学习日历</h1>
              <p className={styles.pageSubtitle}>查看学习计划和每日完成情况</p>
            </div>
            <div className={styles.headerActions}>
              <Button onClick={handleCreatePlan}>
                <i className="fas fa-plus" style={{ marginRight: '8px' }} />
                新建计划
              </Button>
            </div>
          </div>
        </section>

        {/* Calendar Navigation */}
        <section className={styles.calendarNav}>
          <div className={styles.navContent}>
            <button className={styles.navBtn} onClick={handlePrevMonth}>
              <i className="fas fa-chevron-left" />
              <span>上个月</span>
            </button>
            <h2 className={styles.currentMonth}>{formatMonth(currentDate)}</h2>
            <button className={styles.navBtn} onClick={handleNextMonth}>
              <span>下个月</span>
              <i className="fas fa-chevron-right" />
            </button>
          </div>
        </section>

        {/* Content Layout */}
        <div className={styles.contentLayout}>
          {/* Main Calendar */}
          <div className={styles.calendarSection}>
            <div className={styles.calendarContainer}>
              {/* Week Headers */}
              <div className={styles.weekHeaders}>
                {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((day) => (
                  <div key={day} className={styles.weekHeader}>{day}</div>
                ))}
              </div>

              {/* Study Plan Events */}
              <div className={styles.planEvents}>
                {studyPlans.map((plan) => {
                  const events = [];
                  const currentMonth = currentDate.getMonth();
                  const currentYear = currentDate.getFullYear();
                  
                  // 检查计划是否在当前月份内
                  if (
                    (plan.startDate.getFullYear() === currentYear && plan.startDate.getMonth() === currentMonth) ||
                    (plan.endDate.getFullYear() === currentYear && plan.endDate.getMonth() === currentMonth) ||
                    (plan.startDate <= new Date(currentYear, currentMonth, 1) && 
                     plan.endDate >= new Date(currentYear, currentMonth + 1, 0))
                  ) {
                    const startDay = Math.max(1, 
                      plan.startDate.getMonth() === currentMonth ? plan.startDate.getDate() : 1
                    );
                    const endDay = Math.min(
                      new Date(currentYear, currentMonth + 1, 0).getDate(),
                      plan.endDate.getMonth() === currentMonth ? plan.endDate.getDate() : 
                      new Date(currentYear, currentMonth + 1, 0).getDate()
                    );
                    
                    for (let day = startDay; day <= endDay; day++) {
                      const dayIndex = day - 1;
                      const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
                      const adjustedFirstDay = (firstDayOfMonth + 6) % 7; // 调整为周一开始
                      const position = dayIndex + adjustedFirstDay;
                      
                      events.push(
                        <div
                          key={`${plan.id}-${day}`}
                          className={styles.planEvent}
                          style={{
                            '--plan-color': plan.color,
                            gridColumn: (position % 7) + 1,
                            gridRow: Math.floor(position / 7) + 2, // +2 because of header row
                          } as React.CSSProperties}
                          onClick={() => handlePlanClick(plan.id)}
                          title={`${plan.name} (第${day}天)`}
                        >
                          <div className={styles.planEventDot}></div>
                        </div>
                      );
                    }
                  }
                  
                  return events;
                })}
              </div>

              {/* Calendar Days */}
              <div className={styles.calendarGrid}>
                {calendarData.map((day, index) => (
                  <div
                    key={index}
                    className={`${styles.dayCell} ${styles[day.status]}`}
                  >
                    <div className={styles.dayNumber}>{day.date}</div>
                    <div 
                      className={styles.statusIcon}
                      style={{ backgroundColor: `${getStatusColor(day.status)}20`, color: getStatusColor(day.status) }}
                    >
                      <i className={`fas ${getStatusIcon(day.status)}`} />
                    </div>
                    <div className={styles.wordCount} style={{ color: getStatusColor(day.status) }}>
                      {day.status === 'today' ? '今天' : 
                       day.status === 'planned' ? '计划' : 
                       `${day.wordsLearned}词`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className={styles.sidebar}>
            {/* Today's Plan */}
            <div className={styles.sidebarCard}>
              <h3 className={styles.cardTitle}>今日计划</h3>
              <div className={styles.todayPlans}>
                {todayPlans.map((plan) => (
                  <div key={plan.id} className={styles.planItem} style={{ backgroundColor: `${plan.color}10` }}>
                    <div className={styles.planIcon} style={{ backgroundColor: plan.color }}>
                      <i className={`fas fa-${plan.icon}`} />
                    </div>
                    <div className={styles.planInfo}>
                      <div className={styles.planName}>{plan.name}</div>
                      <div className={styles.planTarget}>目标: {plan.targetWords}词</div>
                    </div>
                    <div className={styles.planProgress} style={{ color: plan.color }}>
                      {plan.completedWords}/{plan.targetWords}
                    </div>
                  </div>
                ))}
              </div>
              <Button 
                onClick={handleStartStudy}
                className={styles.startStudyBtn}
              >
                <i className="fas fa-play" style={{ marginRight: '8px' }} />
                开始学习
              </Button>
            </div>

            {/* Monthly Stats */}
            <div className={styles.sidebarCard}>
              <h3 className={styles.cardTitle}>本月统计</h3>
              <div className={styles.statsGrid}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>学习天数</span>
                  <span className={styles.statValue}>{monthlyStats.studyDays}/{monthlyStats.totalDays}天</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>完成单词</span>
                  <span className={styles.statValue}>{monthlyStats.wordsLearned}个</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>平均每日</span>
                  <span className={styles.statValue}>{monthlyStats.averageDaily}词</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>连续天数</span>
                  <span className={styles.statValue}>{monthlyStats.streakDays}天</span>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className={styles.sidebarCard}>
              <h3 className={styles.cardTitle}>图例说明</h3>
              <div className={styles.legend}>
                <div className={styles.legendItem}>
                  <div className={styles.legendIcon} style={{ backgroundColor: 'rgba(76, 175, 80, 0.2)', color: 'var(--color-green)' }}>
                    <i className="fas fa-check" />
                  </div>
                  <span>已完成目标</span>
                </div>
                <div className={styles.legendItem}>
                  <div className={styles.legendIcon} style={{ backgroundColor: 'rgba(255, 149, 0, 0.2)', color: 'var(--color-orange)' }}>
                    <i className="fas fa-clock" />
                  </div>
                  <span>部分完成</span>
                </div>
                <div className={styles.legendItem}>
                  <div className={styles.legendIcon} style={{ backgroundColor: 'rgba(233, 30, 99, 0.2)', color: 'var(--color-pink)' }}>
                    <i className="fas fa-times" />
                  </div>
                  <span>未完成</span>
                </div>
                <div className={styles.legendItem}>
                  <div className={styles.legendIcon} style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}>
                    <i className="fas fa-play" />
                  </div>
                  <span>今天</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CalendarPage;