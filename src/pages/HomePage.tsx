import React, { useState } from 'react';
import styles from './HomePage.module.css';
import { Header, StudyPlanCard, useToast } from '../components';
import { WordBookCard } from '../components/WordBookCard';
import { ErrorModal } from '../components/ErrorModal';
import { LogViewer } from '../components/LogViewer';
import { StudyService } from '../services/studyService';
import { WordBookService } from '../services/wordbookService';
import { useMultipleAsyncData } from '../hooks/useAsyncData';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { showErrorMessage } from '../utils/errorHandler';

export interface HomePageProps {
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * Home page component displaying study overview and quick actions
 */
export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
  const toast = useToast();
  const studyService = new StudyService();
  const wordBookService = new WordBookService();
  const { errorState, showError, hideError } = useErrorHandler();
  const [showLogViewer, setShowLogViewer] = useState(false);

  const { data, loading, errors, refresh } = useMultipleAsyncData({
    studyPlans: async () => {
      const result = await studyService.getAllStudyPlans();
      if (result.success) {
        return result.data;
      } else {
        throw new Error(result.error || '获取学习计划失败');
      }
    },
    wordBooks: async () => {
      const result = await wordBookService.getAllWordBooks(false, 'normal');
      if (result.success) {
        // 获取每个单词本的词性统计，与单词本列表页面保持一致
        const booksWithStats = await Promise.all(
          result.data.map(async (book: any) => {
            let wordTypes = {
              nouns: 0,
              verbs: 0,
              adjectives: 0,
              others: 0
            };

            try {
              const statsResult = await wordBookService.getWordBookTypeStatistics(book.id);
              if (statsResult.success && statsResult.data) {
                wordTypes = {
                  nouns: statsResult.data.nouns,
                  verbs: statsResult.data.verbs,
                  adjectives: statsResult.data.adjectives,
                  others: statsResult.data.others
                };
              }
            } catch (error) {
              console.warn(`获取单词本 ${book.id} 的统计信息失败:`, error);
            }

            return {
              ...book,
              wordTypes
            };
          })
        );
        return booksWithStats;
      } else {
        throw new Error(result.error || '获取单词本失败');
      }
    },
    statistics: async () => {
      const result = await studyService.getStudyStatistics();
      if (result.success) {
        return result.data;
      } else {
        throw new Error(result.error || '获取统计数据失败');
      }
    }
  });

  // 调试信息
  React.useEffect(() => {
    console.log('HomePage mounted - Environment check:', {
      isBrowser: typeof window !== 'undefined',
      hasTauri: typeof window !== 'undefined' && '__TAURI__' in window,
      hasTauriInternals: typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
      windowKeys: typeof window !== 'undefined' ? Object.keys(window).filter(k => k.includes('TAURI') || k.includes('tauri')) : [],
    });
  }, []);

  // 当有错误时显示错误模态
  React.useEffect(() => {
    if (errors.studyPlans) {
      showError(errors.studyPlans, () => refresh());
    } else if (errors.statistics) {
      showError(errors.statistics, () => refresh());
    }
  }, [errors, showError, refresh]);

  // 过滤学习计划：只显示正常状态的计划（排除删除、草稿状态）
  const studyPlans = (data.studyPlans && Array.isArray(data.studyPlans))
    ? data.studyPlans.filter(plan =>
        plan.status === 'normal' && (
          plan.lifecycle_status === 'pending' ||
          plan.lifecycle_status === 'active' ||
          plan.lifecycle_status === 'completed' ||
          plan.lifecycle_status === 'terminated'
        )
      )
    : [];
  const wordBooks = (data.wordBooks && Array.isArray(data.wordBooks)) ? data.wordBooks : [];
  const statistics = data.statistics || {
    total_words_learned: 0,
    average_accuracy: 0,
    streak_days: 0,
    completion_rate: 0,
    weekly_progress: []
  };



  const handlePlanClick = (planId: number) => {
    onNavigate?.('plan-detail', { planId });
  };

  const handleStudyStart = (planId: number) => {
    onNavigate?.('start-study-plan', { planId });
  };

  const handleWordBookClick = (book: any) => {
    onNavigate?.('wordbook-detail', { id: book.id });
  };

  const handleQuickAction = (action: string) => {
    if (action === 'create-plan') {
      toast.showInfo('导航到创建学习计划', '正在跳转到学习计划创建页面...');
      onNavigate?.('create-plan');
    } else if (action === 'create-wordbook') {
      toast.showInfo('导航到创建单词本', '正在跳转到单词本创建页面...');
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
          <div className={styles.loading}>
            <div className={styles.loadingSpinner}>
              <i className="fas fa-spinner fa-spin"></i>
            </div>
            <p>正在加载数据...</p>
          </div>
        </main>
      </div>
    );
  }

  // 显示错误信息但仍然渲染页面内容
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className={styles.page}>
      <Header activeNav="home" onNavChange={onNavigate} />
      
      <main className={styles.main}>
        {/* Error Messages */}
        {hasErrors && (
          <section className={styles.errorSection}>
            <div className={styles.errorBanner}>
              <div className={styles.errorIcon}>
                <i className="fas fa-exclamation-triangle" />
              </div>
              <div className={styles.errorContent}>
                <h4>数据加载出现问题</h4>
                <ul className={styles.errorList}>
                  {errors.studyPlans && (
                    <li>学习计划: {showErrorMessage(errors.studyPlans)}</li>
                  )}
                  {errors.wordBooks && (
                    <li>单词本: {showErrorMessage(errors.wordBooks)}</li>
                  )}
                  {errors.statistics && (
                    <li>学习统计: {showErrorMessage(errors.statistics)}</li>
                  )}
                </ul>
                <button type="button" onClick={refresh} className={styles.retryBtn}>
                  <i className="fas fa-redo" />
                  重试
                </button>
              </div>
            </div>
          </section>
        )}
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
              type="button"
              className={styles.viewAllBtn}
              onClick={() => onNavigate?.('plans')}
            >
              查看全部
            </button>
          </div>
          
          <div className={styles.studyPlansGrid}>
            {studyPlans.length > 0 ? (
              studyPlans.map((plan) => (
                <StudyPlanCard
                  key={plan.id}
                  plan={plan}
                  onClick={handlePlanClick}
                  onActionClick={handleStudyStart}
                />
              ))
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>
                  <i className="fas fa-calendar-plus" />
                </div>
                <h4 className={styles.emptyTitle}>还没有学习计划</h4>
                <p className={styles.emptyDescription}>创建你的第一个学习计划开始学习吧</p>
                <button
                  type="button"
                  className={styles.createBtn}
                  onClick={() => onNavigate?.('create-plan')}
                >
                  <i className="fas fa-plus" />
                  创建学习计划
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Word Books */}
        <section className={styles.studyPlansSection}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>我的单词本</h3>
            <button
              type="button"
              className={styles.viewAllBtn}
              onClick={() => onNavigate?.('wordbooks')}
            >
              查看全部
            </button>
          </div>

          <div className={styles.wordBooksGrid}>
            {wordBooks.length > 0 ? (
              wordBooks.slice(0, 6).map((book) => (
                <WordBookCard
                  key={book.id}
                  book={{
                    id: book.id,
                    title: book.title,
                    description: book.description,
                    icon: book.icon || 'book',
                    iconColor: (book.icon_color as any) || 'primary',
                    totalWords: book.total_words || 0,
                    linkedPlans: book.linked_plans || 0,
                    wordTypes: book.wordTypes || {
                      nouns: 0,
                      verbs: 0,
                      adjectives: 0,
                      others: 0
                    },
                    createdAt: book.created_at,
                    lastUsed: book.last_used || '从未使用',
                    deletedAt: book.deleted_at,
                    status: (book.status as any) || 'normal'
                  }}
                  onClick={handleWordBookClick}
                />
              ))
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>
                  <i className="fas fa-book" />
                </div>
                <h4 className={styles.emptyTitle}>还没有单词本</h4>
                <p className={styles.emptyDescription}>创建你的第一个单词本开始学习吧</p>
                <button
                  type="button"
                  className={styles.createBtn}
                  onClick={() => onNavigate?.('create-wordbook')}
                >
                  <i className="fas fa-plus" />
                  创建单词本
                </button>
              </div>
            )}
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
                <div className={styles.statValue}>{statistics.total_words_learned || 0}</div>
                <div className={styles.statLabel}>总学习单词</div>
              </div>

              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.iconOrange}`}>
                  <i className="fas fa-target" />
                </div>
                <div className={styles.statValue}>{(statistics.average_accuracy || 0).toFixed(0)}%</div>
                <div className={styles.statLabel}>平均正确率</div>
              </div>

              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.iconGreen}`}>
                  <i className="fas fa-calendar" />
                </div>
                <div className={styles.statValue}>{statistics.streak_days || 0}</div>
                <div className={styles.statLabel}>连续学习天数</div>
              </div>

              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.iconPurple}`}>
                  <i className="fas fa-check-circle" />
                </div>
                <div className={styles.statValue}>{(statistics.completion_rate || 0).toFixed(0)}%</div>
                <div className={styles.statLabel}>计划完成率</div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* 调试按钮 */}
      <button
        type="button"
        onClick={() => setShowLogViewer(true)}
        className="fixed bottom-4 right-4 w-12 h-12 bg-gray-600 text-white rounded-full shadow-lg hover:bg-gray-700 transition-colors z-40"
        title="查看系统日志"
      >
        <i className="fas fa-bug"></i>
      </button>

      {/* 错误模态 */}
      <ErrorModal
        isOpen={errorState.isOpen}
        onClose={hideError}
        title={errorState.title}
        message={errorState.message}
        details={errorState.details}
        onRetry={errorState.retryAction}
      />

      {/* 日志查看器 */}
      <LogViewer
        isOpen={showLogViewer}
        onClose={() => setShowLogViewer(false)}
      />
    </div>
  );
};

export default HomePage;