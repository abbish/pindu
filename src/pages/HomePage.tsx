import React, { useEffect, useState } from 'react';
import styles from './HomePage.module.css';
import { Header, StudyPlanCard } from '../components';
import { getStudyPlans, getStudyStatistics } from '../utils/database';
import type { StudyPlanWithProgress, StudyStatistics } from '../utils/database';

export interface HomePageProps {
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * Home page component displaying study overview and quick actions
 */
export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
  const [studyPlans, setStudyPlans] = useState<StudyPlanWithProgress[]>([]);
  const [statistics, setStatistics] = useState<StudyStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [plansData, statsData] = await Promise.all([
        getStudyPlans(),
        getStudyStatistics()
      ]);
      
      setStudyPlans(plansData);
      setStatistics(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handlePlanClick = (planId: number) => {
    onNavigate?.('plan-detail', { planId });
  };

  const handleStudyStart = (planId: number) => {
    onNavigate?.('start-study-plan', { planId });
  };

  const handleQuickAction = (action: string) => {
    if (action === 'create-plan') {
      onNavigate?.('create-plan');
    } else if (action === 'create-wordbook') {
      onNavigate?.('create-wordbook');
    } else {
      console.log('Quick action:', action);
      // TODO: Handle other quick actions
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <Header activeNav="home" />
        <main className={styles.main}>
          <div className={styles.loading}>加载中...</div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Header activeNav="home" />
        <main className={styles.main}>
          <div className={styles.error}>
            <p>{error}</p>
            <button onClick={loadData} className={styles.retryBtn}>重试</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header activeNav="home" onNavChange={onNavigate} />
      
      <main className={styles.main}>
        {/* Welcome Section */}
        <section className={styles.welcomeSection}>
          <h2 className={styles.welcomeTitle}>欢迎回来！</h2>
          <p className={styles.welcomeSubtitle}>继续你的单词学习之旅吧</p>
        </section>

        {/* Quick Actions */}
        <section className={styles.quickActionsSection}>
          <div className={styles.quickActions}>
            <div 
              className={styles.quickActionCard}
              onClick={() => handleQuickAction('create-wordbook')}
            >
              <div className={styles.quickActionHeader}>
                <div className={`${styles.quickActionIcon} ${styles.iconOrange}`}>
                  <i className="fas fa-plus" />
                </div>
                <i className="fas fa-arrow-right" />
              </div>
              <h3 className={styles.quickActionTitle}>创建单词本</h3>
              <p className={styles.quickActionDesc}>添加新的单词集合开始学习</p>
            </div>

            <div 
              className={styles.quickActionCard}
              onClick={() => handleQuickAction('create-plan')}
            >
              <div className={styles.quickActionHeader}>
                <div className={`${styles.quickActionIcon} ${styles.iconPurple}`}>
                  <i className="fas fa-calendar-plus" />
                </div>
                <i className="fas fa-arrow-right" />
              </div>
              <h3 className={styles.quickActionTitle}>创建学习计划</h3>
              <p className={styles.quickActionDesc}>制定个性化的学习计划</p>
            </div>
          </div>
        </section>

        {/* Study Plans */}
        <section className={styles.studyPlansSection}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>我的学习计划</h3>
            <button 
              className={styles.viewAllBtn}
              onClick={() => onNavigate?.('plans')}
            >
              查看全部
            </button>
          </div>
          
          <div className={styles.studyPlansGrid}>
            {studyPlans.map((plan) => (
              <StudyPlanCard
                key={plan.id}
                plan={plan}
                onClick={handlePlanClick}
                onActionClick={handleStudyStart}
              />
            ))}
          </div>
        </section>

        {/* Statistics Overview */}
        {statistics && (
          <section className={styles.statisticsSection}>
            <h3 className={styles.sectionTitle}>学习统计</h3>
            
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.iconPrimary}`}>
                  <i className="fas fa-book" />
                </div>
                <div className={styles.statValue}>{statistics.total_words_learned}</div>
                <div className={styles.statLabel}>总学习单词</div>
              </div>

              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.iconOrange}`}>
                  <i className="fas fa-target" />
                </div>
                <div className={styles.statValue}>{statistics.average_accuracy.toFixed(0)}%</div>
                <div className={styles.statLabel}>平均正确率</div>
              </div>

              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.iconGreen}`}>
                  <i className="fas fa-calendar" />
                </div>
                <div className={styles.statValue}>{statistics.streak_days}</div>
                <div className={styles.statLabel}>连续学习天数</div>
              </div>

              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.iconPurple}`}>
                  <i className="fas fa-check-circle" />
                </div>
                <div className={styles.statValue}>{statistics.completion_rate.toFixed(0)}%</div>
                <div className={styles.statLabel}>计划完成率</div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default HomePage;