import React, { useState, useMemo, useEffect } from 'react';
import styles from './CalendarPage.module.css';
import { Header, Breadcrumb, Button } from '../components';
import { calendarService, practiceService } from '../services';
import type { CalendarMonthResponse, TodayStudySchedule, LoadingState, PracticeSession } from '../types';

// 学习状态枚举
export type StudyStatus = 'completed' | 'partial' | 'missed' | 'planned' | 'today';

// 每日学习数据接口
export interface DayData {
  date: number;
  status: StudyStatus;
  wordsLearned: number;
  targetWords: number;
  newWords: number;
  reviewWords: number;
  isToday: boolean;
  isInPlan: boolean;
  isCurrentMonth: boolean;
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
  const [calendarData, setCalendarData] = useState<CalendarMonthResponse | null>(null);
  const [loading, setLoading] = useState<LoadingState>({ loading: false });
  const [todaySchedules, setTodaySchedules] = useState<TodayStudySchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState<LoadingState>({ loading: false });
  const [incompleteSessions, setIncompleteSessions] = useState<PracticeSession[]>([]);


  // 获取日历数据
  useEffect(() => {
    const fetchCalendarData = async () => {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;

      const result = await calendarService.getMonthData({
        year,
        month,
        includeOtherMonths: true
      }, setLoading);

      if (result.success) {
        setCalendarData(result.data);
      } else {
        console.error('Failed to fetch calendar data:', result.error);
        // TODO: 显示错误提示
      }
    };

    fetchCalendarData();
  }, [currentDate]);

  // 获取今日学习日程
  useEffect(() => {
    const fetchTodaySchedules = async () => {
      const result = await calendarService.getTodayStudySchedules(setSchedulesLoading);

      if (result.success) {
        console.log('Today schedules data:', result.data);
        setTodaySchedules(result.data);
      } else {
        console.error('Failed to fetch today schedules:', result.error);
        setTodaySchedules([]);
      }
    };

    fetchTodaySchedules();
  }, []);

  // 获取未完成的练习会话
  useEffect(() => {
    const fetchIncompleteSessions = async () => {
      try {
        const result = await practiceService.getIncompletePracticeSessions();
        if (result.success) {
          setIncompleteSessions(result.data);
        } else {
          console.error('获取未完成练习失败:', result.error);
        }
      } catch (error) {
        console.error('获取未完成练习时发生错误:', error);
      }
    };

    fetchIncompleteSessions();
  }, []);

  // 获取学习计划数据
  const studyPlans: StudyPlan[] = useMemo(() => {
    if (!calendarData || !calendarData.days || !Array.isArray(calendarData.days)) return [];

    // 从日历数据中提取所有学习计划
    const planMap = new Map<string, StudyPlan>();

    calendarData.days.forEach(day => {
      if (day.studyPlans && Array.isArray(day.studyPlans)) {
        day.studyPlans.forEach(plan => {
          const planId = plan.id.toString();
          if (!planMap.has(planId)) {
            planMap.set(planId, {
              id: planId,
              name: plan.name || '未命名计划',
              color: plan.color || 'var(--color-primary)',
              startDate: new Date(day.date), // 使用第一次出现的日期作为开始日期
              endDate: new Date(day.date),   // 会在后面更新为最后出现的日期
              targetWords: plan.targetWords || 0,
              completedWords: plan.completedWords || 0
            });
          } else {
            // 更新结束日期为最后出现的日期
            const existingPlan = planMap.get(planId)!;
            const dayDate = new Date(day.date);
            if (dayDate > existingPlan.endDate) {
              existingPlan.endDate = dayDate;
            }
            if (dayDate < existingPlan.startDate) {
              existingPlan.startDate = dayDate;
            }
          }
        });
      }
    });

    return Array.from(planMap.values());
  }, [calendarData]);



  // 获取月度统计数据
  const monthlyStats: MonthlyStats = useMemo(() => {
    if (!calendarData || !calendarData.monthlyStats) {
      return {
        studyDays: 0,
        totalDays: 0,
        wordsLearned: 0,
        averageDaily: 0,
        streakDays: 0
      };
    }

    const stats = calendarData.monthlyStats;
    return {
      studyDays: stats.studyDays || 0,
      totalDays: stats.totalDays || 0,
      wordsLearned: stats.totalWordsLearned || 0,
      averageDaily: stats.totalDays > 0 ? (stats.totalWordsLearned || 0) / stats.totalDays : 0,
      streakDays: stats.streakDays || 0
    };
  }, [calendarData]);

  // 转换真实数据为显示格式
  const displayCalendarData = useMemo(() => {
    if (!calendarData || !calendarData.days || !Array.isArray(calendarData.days)) return [];

    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    console.log('Converting calendar data for:', currentYear, currentMonth);
    console.log('Raw calendar data:', calendarData);

    const result = calendarData.days.map(day => {
      const dateObj = new Date(day.date);
      const dateNum = dateObj.getDate();
      const isCurrentMonth = dateObj.getFullYear() === currentYear && dateObj.getMonth() + 1 === currentMonth;

      // 转换状态
      let status: StudyStatus;
      switch (day.status) {
        case 'completed':
          status = 'completed';
          break;
        case 'in-progress':
          status = 'partial';
          break;
        case 'overdue':
          status = 'missed';
          break;
        default:
          status = day.isToday ? 'today' : 'planned';
      }

      // 修复字段名访问 - 后端使用下划线命名
      const dayAny = day as any; // 临时类型转换来访问下划线字段

      const converted = {
        date: dateNum,
        status,
        wordsLearned: dayAny.completed_words_count || 0,
        targetWords: dayAny.total_words_count || 0,
        newWords: dayAny.new_words_count || 0,
        reviewWords: dayAny.review_words_count || 0,
        isToday: dayAny.is_today,
        isInPlan: dayAny.is_in_plan,
        isCurrentMonth,
        plans: dayAny.study_plans?.map((plan: any) => plan.name || '未命名计划') || []
      };

      // 调试有计划的日期
      if (dayAny.is_in_plan) {
        console.log(`Day ${day.date}: isInPlan=${dayAny.is_in_plan}, isCurrentMonth=${isCurrentMonth}, newWords=${dayAny.new_words_count}, reviewWords=${dayAny.review_words_count}`);
      }

      return converted;
    });

    console.log('Converted calendar data:', result);
    const daysWithPlans = result.filter(d => d.isInPlan);
    console.log('Days with plans:', daysWithPlans.length, daysWithPlans.map(d => d.date));

    return result;
  }, [calendarData, currentDate]);

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

  const handleStartPractice = (schedule: TodayStudySchedule) => {
    // 导航到练习页面，传递学习计划ID和日程ID
    onNavigate?.('practice', {
      planId: schedule.planId,
      scheduleId: schedule.scheduleId
    });
  };

  // 处理继续未完成的练习
  const handleContinuePractice = (session: PracticeSession) => {
    console.log('继续练习:', session);
    if (onNavigate) {
      onNavigate('word-practice', {
        planId: session.planId,
        scheduleId: session.scheduleId,
        sessionId: session.sessionId
      });
    }
  };

  // 处理取消练习
  const handleCancelPractice = async (session: PracticeSession) => {
    try {
      const result = await practiceService.cancelPracticeSession(session.sessionId);
      if (result.success) {
        // 重新获取未完成练习列表
        const updatedResult = await practiceService.getIncompletePracticeSessions();
        if (updatedResult.success) {
          setIncompleteSessions(updatedResult.data);
        }
      } else {
        console.error('取消练习失败:', result.error);
      }
    } catch (error) {
      console.error('取消练习时发生错误:', error);
    }
  };

  const formatMonth = (date: Date) => {
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  };

  // const getStatusIcon = (status: StudyStatus) => {
  //   switch (status) {
  //     case 'completed':
  //       return 'fa-check';
  //     case 'partial':
  //       return 'fa-clock';
  //     case 'missed':
  //       return 'fa-times';
  //     case 'today':
  //       return 'fa-play';
  //     default:
  //       return 'fa-calendar';
  //   }
  // };

  // const getStatusColor = (status: StudyStatus) => {
  //   switch (status) {
  //     case 'completed':
  //       return 'var(--color-green)';
  //     case 'partial':
  //       return 'var(--color-orange)';
  //     case 'missed':
  //       return 'var(--color-pink)';
  //     case 'today':
  //       return 'var(--color-primary)';
  //     default:
  //       return 'var(--color-text-secondary)';
  //   }
  // };

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
                          key={`${plan.id}-${day}`}/*  */
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
                {loading.loading ? (
                  <div className={styles.loadingContainer}>
                    <i className="fas fa-spinner fa-spin" />
                    <span>加载中...</span>
                  </div>
                ) : (
                  (() => {
                    const weeks = [];
                    for (let i = 0; i < displayCalendarData.length; i += 7) {
                      const week = displayCalendarData.slice(i, i + 7);
                      weeks.push(
                        <div key={i} className={styles.weekRow}>
                          {week.map((day, dayIndex) => {
                            const cellClasses = [
                              styles.dayCell,
                              day.isToday ? styles.today : '',
                              !day.isCurrentMonth ? styles.otherMonth : '',
                              day.isInPlan ? styles.inPlan : '',
                              day.isInPlan ? styles[day.status] : ''
                            ].filter(Boolean).join(' ');

                            return (
                              <div
                                key={i + dayIndex}
                                className={cellClasses}
                                onClick={() => {
                                  if (day.isInPlan) {
                                    console.log('Clicked date:', day.date, 'isCurrentMonth:', day.isCurrentMonth, 'isInPlan:', day.isInPlan);
                                  }
                                }}
                              >
                                <div className={styles.dayNumber}>{day.date}</div>

                                {/* 调试信息 - 临时显示 */}
                                {day.isInPlan && (
                                  <div style={{ fontSize: '8px', color: 'red', position: 'absolute', top: '2px', right: '2px' }}>
                                    ✓
                                  </div>
                                )}

                                {day.isCurrentMonth && day.isInPlan && (
                                  <>
                                    <div className={styles.wordCounts}>
                                      {day.newWords > 0 && (
                                        <span className={styles.newWords}>新{day.newWords}</span>
                                      )}
                                      {day.reviewWords > 0 && (
                                        <span className={styles.reviewWords}>复{day.reviewWords}</span>
                                      )}
                                    </div>

                                    <div className={styles.progressBar}>
                                      <div
                                        className={styles.progressFill}
                                        style={{ '--progress-width': `${day.wordsLearned > 0 ? (day.wordsLearned / day.targetWords * 100) : 0}%` } as React.CSSProperties}
                                      />
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    return weeks;
                  })()
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className={styles.sidebar}>
            {/* Today's Plan */}
            <div className={styles.sidebarCard}>
              <h3 className={styles.cardTitle}>今日计划</h3>
              <div className={styles.todayPlans}>
                {schedulesLoading.loading ? (
                  <div className={styles.loadingContainer}>
                    <i className="fas fa-spinner fa-spin" />
                    <span>加载中...</span>
                  </div>
                ) : todaySchedules.length === 0 ? (
                  <div className={styles.emptyState}>
                    <i className="fas fa-calendar-check" />
                    <span>今日暂无学习计划</span>
                  </div>
                ) : (
                  todaySchedules.map((schedule) => (
                    <div key={schedule.scheduleId} className={styles.scheduleItem}>
                      <div className={styles.scheduleHeader}>
                        <div className={styles.scheduleName}>{schedule.planName}</div>
                        <div className={styles.scheduleStatus}>
                          {schedule.status === 'completed' && <span className={styles.statusCompleted}>已完成</span>}
                          {schedule.status === 'in-progress' && <span className={styles.statusInProgress}>进行中</span>}
                          {schedule.status === 'not-started' && <span className={styles.statusNotStarted}>未开始</span>}
                        </div>
                      </div>
                      <div className={styles.scheduleDetails}>
                        <div className={styles.wordCounts}>
                          {schedule.newWordsCount > 0 && (
                            <span className={styles.newWords}>新学 {schedule.newWordsCount}</span>
                          )}
                          {schedule.reviewWordsCount > 0 && (
                            <span className={styles.reviewWords}>复习 {schedule.reviewWordsCount}</span>
                          )}
                        </div>
                        <div className={styles.progress}>
                          <span className={styles.progressText}>
                            {schedule.completedWordsCount}/{schedule.totalWordsCount} 词
                          </span>
                          <div className={styles.progressBar}>
                            <div
                              className={styles.progressFill}
                              style={{ width: `${schedule.progressPercentage}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      {schedule.canStartPractice && (
                        <Button
                          onClick={() => handleStartPractice(schedule)}
                          className={styles.practiceBtn}
                          size="sm"
                        >
                          <i className="fas fa-play" />
                          继续学习
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
              {todaySchedules.length > 0 && (
                <Button
                  onClick={handleStartStudy}
                  className={styles.startStudyBtn}
                >
                  <i className="fas fa-list" style={{ marginRight: '8px' }} />
                  查看所有计划
                </Button>
              )}
            </div>

            {/* Incomplete Practice Sessions */}
            {incompleteSessions.length > 0 && (
              <div className={styles.sidebarCard}>
                <h3 className={styles.cardTitle}>未完成练习</h3>
                <div className={styles.incompleteSessions}>
                  {incompleteSessions.map((session) => (
                    <div key={session.sessionId} className={styles.sessionItem}>
                      <div className={styles.sessionHeader}>
                        <div className={styles.sessionName}>{session.planTitle}</div>
                        <div className={styles.sessionDate}>
                          {new Date(session.scheduleDate).toLocaleDateString('zh-CN', {
                            month: 'short',
                            day: 'numeric'
                          })}
                        </div>
                      </div>
                      <div className={styles.sessionDetails}>
                        <div className={styles.sessionTime}>
                          已练习 {Math.floor(session.activeTime / 60000)}分钟
                        </div>
                        {session.pauseCount > 0 && (
                          <div className={styles.pauseCount}>
                            暂停 {session.pauseCount} 次
                          </div>
                        )}
                      </div>
                      <div className={styles.sessionActions}>
                        <Button
                          onClick={() => handleContinuePractice(session)}
                          className={styles.continueBtn}
                          size="sm"
                          variant="primary"
                        >
                          <i className="fas fa-play" />
                          继续
                        </Button>
                        <Button
                          onClick={() => handleCancelPractice(session)}
                          className={styles.cancelBtn}
                          size="sm"
                          variant="secondary"
                        >
                          <i className="fas fa-times" />
                          取消
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                  <span className={styles.statValue}>{monthlyStats.averageDaily.toFixed(1)}词</span>
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