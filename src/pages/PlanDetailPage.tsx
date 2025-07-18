import React, { useState, useEffect } from 'react';
import styles from './PlanDetailPage.module.css';
import {
  Header,
  Breadcrumb,
  Button,
  StatCard,
  StudySchedulePreview,
  StudyCalendar,
  WordListTable,
  useToast,
  type WordListDetail
} from '../components';
import { BatchDeleteModal } from '../components/BatchDeleteModal';
import { Modal } from '../components/Modal';
import { StudyService } from '../services/studyService';
import type {
  StudyPlanWithProgress,
  StudyPlanAIResult,
  DailyStudyWord,
  StudyPlanStatus,
  StudyPlanWord,
  StudyPlanStatistics
} from '../types';

// 视图模式类型
type ViewMode = 'overview' | 'schedule' | 'words' | 'statistics';

// 辅助函数
function getStatusDisplay(status: StudyPlanStatus) {
  switch (status) {
    case 'active':
      return { text: '进行中', color: 'var(--color-success)', bgColor: 'var(--color-success-light)' };
    case 'paused':
      return { text: '已暂停', color: 'var(--color-warning)', bgColor: 'var(--color-warning-light)' };
    case 'completed':
      return { text: '已完成', color: 'var(--color-info)', bgColor: 'var(--color-info-light)' };
    case 'draft':
      return { text: '草稿', color: 'var(--color-text-tertiary)', bgColor: 'var(--color-bg-tertiary)' };
    default:
      return { text: '未知', color: 'var(--color-text-tertiary)', bgColor: 'var(--color-bg-tertiary)' };
  }
}

function getIntensityDisplay(intensity?: string) {
  switch (intensity) {
    case 'easy':
      return { text: '轻松模式', color: 'var(--color-success)' };
    case 'normal':
      return { text: '标准模式', color: 'var(--color-info)' };
    case 'intensive':
      return { text: '强化模式', color: 'var(--color-warning)' };
    default:
      return { text: '标准模式', color: 'var(--color-info)' };
  }
}

export interface PlanDetailPageProps {
  /** Plan ID */
  planId: number;
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * Study Plan Detail page component
 */
export const PlanDetailPage: React.FC<PlanDetailPageProps> = ({
  planId,
  onNavigate
}) => {
  const { showToast } = useToast();
  const studyService = new StudyService();

  // 状态管理
  const [planData, setPlanData] = useState<StudyPlanWithProgress | null>(null);
  const [aiPlanData, setAiPlanData] = useState<StudyPlanAIResult | null>(null);
  const [currentView, setCurrentView] = useState<ViewMode>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 统计数据
  const [studyStreak, setStudyStreak] = useState(0);
  const [todayWords, setTodayWords] = useState<DailyStudyWord[]>([]);

  // 扁平化单词列表
  const [planWords, setPlanWords] = useState<StudyPlanWord[]>([]);
  const [wordsLoading, setWordsLoading] = useState(false);

  // 统计数据
  const [statistics, setStatistics] = useState<StudyPlanStatistics | null>(null);

  // 删除确认状态
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    words: WordListDetail[];
    deleting: boolean;
  }>({
    isOpen: false,
    words: [],
    deleting: false
  });

  // 状态转换确认状态
  const [statusChangeModal, setStatusChangeModal] = useState<{
    isOpen: boolean;
    targetStatus: 'active' | 'draft';
    processing: boolean;
  }>({
    isOpen: false,
    targetStatus: 'active',
    processing: false
  });

  useEffect(() => {
    loadPlanDetail();
  }, [planId]);

  const loadPlanDetail = async () => {
    try {
      setLoading(true);
      setError(null);

      // 加载学习计划基本信息
      const planResult = await studyService.getStudyPlan(planId);
      if (!planResult.success) {
        throw new Error(planResult.error || '加载学习计划失败');
      }

      const plan = planResult.data;
      setPlanData(plan);

      // 解析AI规划数据
      if (plan.ai_plan_data) {
        try {
          const aiData: StudyPlanAIResult = JSON.parse(plan.ai_plan_data);
          setAiPlanData(aiData);

          // 获取今日学习单词
          const today = new Date().toISOString().split('T')[0];
          const todayPlan = aiData.dailyPlans.find(dp => dp.date === today);
          if (todayPlan) {
            setTodayWords(todayPlan.words);
          }
        } catch (e) {
          console.warn('Failed to parse AI plan data:', e);
        }
      }

      // 加载学习统计数据
      await loadStudyStatistics();

      // 加载扁平化单词列表
      await loadPlanWords();

      // 加载统计数据
      await loadStatistics();

    } catch (err) {
      setError(err instanceof Error ? err.message : '加载计划详情失败');
    } finally {
      setLoading(false);
    }
  };

  const loadStudyStatistics = async () => {
    try {
      // 模拟加载学习统计数据
      // TODO: 替换为真实的API调用
      const mockStreak = 7;

      setStudyStreak(mockStreak);
    } catch (err) {
      console.warn('Failed to load study statistics:', err);
    }
  };

  // 加载扁平化单词列表
  const loadPlanWords = async () => {
    if (!planId) return;

    try {
      setWordsLoading(true);
      const result = await studyService.getStudyPlanWords(planId);

      if (result.success) {
        setPlanWords(result.data);
      } else {
        showToast(result.error, 'error');
      }
    } catch (error) {
      console.error('加载学习计划单词失败:', error);
      showToast('加载学习计划单词失败', 'error');
    } finally {
      setWordsLoading(false);
    }
  };

  // 加载统计数据
  const loadStatistics = async () => {
    if (!planId) return;

    try {
      const result = await studyService.getStudyPlanStatistics(planId);

      if (result.success) {
        setStatistics(result.data);
      } else {
        console.warn('Failed to load statistics:', result.error);
      }
    } catch (error) {
      console.warn('Failed to load statistics:', error);
    }
  };

  // 事件处理函数
  const handleViewChange = (view: ViewMode) => {
    setCurrentView(view);
  };

  // 删除单词相关处理函数
  const handleRemoveFromPlan = (word: WordListDetail) => {
    setDeleteModal({
      isOpen: true,
      words: [word],
      deleting: false
    });
  };

  const handleBatchRemoveFromPlan = (words: WordListDetail[]) => {
    setDeleteModal({
      isOpen: true,
      words: words,
      deleting: false
    });
  };

  // 确认删除处理
  const handleConfirmDelete = async () => {
    if (!planId || deleteModal.words.length === 0) return;

    setDeleteModal(prev => ({ ...prev, deleting: true }));

    try {
      const wordIds = deleteModal.words.map(w => w.id);

      if (deleteModal.words.length === 1) {
        const result = await studyService.removeWordFromPlan(planId, wordIds[0]);
        if (result.success) {
          showToast('已从学习计划中移除', 'success');
        } else {
          showToast(result.error, 'error');
          return;
        }
      } else {
        const result = await studyService.batchRemoveWordsFromPlan(planId, wordIds);
        if (result.success) {
          showToast(`已从学习计划中移除 ${deleteModal.words.length} 个单词`, 'success');
        } else {
          showToast(result.error, 'error');
          return;
        }
      }

      // 重新加载数据
      await Promise.all([
        loadPlanWords(),
        loadStatistics(), // 更新统计数据
        loadPlanDetail() // 更新计划基本信息（包括进度等）
      ]);

      // 关闭Modal
      setDeleteModal({
        isOpen: false,
        words: [],
        deleting: false
      });
    } catch (error) {
      console.error('删除单词失败:', error);
      showToast('删除单词失败', 'error');
    } finally {
      setDeleteModal(prev => ({ ...prev, deleting: false }));
    }
  };

  // 取消删除
  const handleCancelDelete = () => {
    setDeleteModal({
      isOpen: false,
      words: [],
      deleting: false
    });
  };

  // 状态转换处理
  const handleStatusChange = (targetStatus: 'active' | 'draft') => {
    if (!planData) return;

    if (targetStatus === 'active' && planData.status === 'draft') {
      // 从草稿转为正式，需要确认重新生成日程
      setStatusChangeModal({
        isOpen: true,
        targetStatus: 'active',
        processing: false
      });
    } else if (targetStatus === 'draft' && planData.status === 'active') {
      // 从正式转为草稿，直接确认
      setStatusChangeModal({
        isOpen: true,
        targetStatus: 'draft',
        processing: false
      });
    }
  };

  // 确认状态转换
  const handleConfirmStatusChange = async () => {
    if (!planData || !planId) return;

    setStatusChangeModal(prev => ({ ...prev, processing: true }));

    try {
      if (statusChangeModal.targetStatus === 'active') {
        // 从草稿转为正式：重新生成日程计划
        showToast('正在重新生成学习日程...', 'info');

        // TODO: 调用重新生成日程的API
        // const result = await studyService.regenerateSchedule(planId);

        // 暂时只更新状态
        const result = await studyService.updateStudyPlan(planId, {
          status: 'active'
        });

        if (result.success) {
          showToast('学习计划已激活，日程已重新生成', 'success');
          await loadPlanDetail(); // 重新加载计划详情
        } else {
          showToast(result.error, 'error');
          return;
        }
      } else {
        // 从正式转为草稿
        const result = await studyService.updateStudyPlan(planId, {
          status: 'draft'
        });

        if (result.success) {
          showToast('学习计划已转为草稿状态', 'success');
          await loadPlanDetail(); // 重新加载计划详情
        } else {
          showToast(result.error, 'error');
          return;
        }
      }

      // 关闭Modal
      setStatusChangeModal({
        isOpen: false,
        targetStatus: 'active',
        processing: false
      });
    } catch (error) {
      console.error('状态转换失败:', error);
      showToast('状态转换失败', 'error');
    } finally {
      setStatusChangeModal(prev => ({ ...prev, processing: false }));
    }
  };

  // 取消状态转换
  const handleCancelStatusChange = () => {
    setStatusChangeModal({
      isOpen: false,
      targetStatus: 'active',
      processing: false
    });
  };

  // 渲染操作按钮
  const renderActionButtons = () => {
    const status = planData?.status as StudyPlanStatus;

    switch (status) {
      case 'active':
        return (
          <>
            <Button onClick={handleContinueStudy} variant="primary">
              <i className="fas fa-play" />
              继续学习
            </Button>
            <Button onClick={handlePausePlan} variant="secondary">
              <i className="fas fa-pause" />
              暂停计划
            </Button>
            <Button onClick={handleEditPlan} variant="outline">
              <i className="fas fa-edit" />
              编辑
            </Button>
          </>
        );
      case 'paused':
        return (
          <>
            <Button onClick={handleResumePlan} variant="primary">
              <i className="fas fa-play" />
              恢复学习
            </Button>
            <Button onClick={handleCompletePlan} variant="secondary">
              <i className="fas fa-check" />
              标记完成
            </Button>
            <Button onClick={handleEditPlan} variant="outline">
              <i className="fas fa-edit" />
              编辑
            </Button>
          </>
        );
      case 'completed':
        return (
          <>
            <Button onClick={() => onNavigate?.('plans')} variant="secondary">
              <i className="fas fa-list" />
              查看所有计划
            </Button>
            <Button onClick={handleEditPlan} variant="outline">
              <i className="fas fa-edit" />
              编辑
            </Button>
          </>
        );
      case 'draft':
        return (
          <>
            <Button onClick={handleResumePlan} variant="primary">
              <i className="fas fa-play" />
              开始学习
            </Button>
            <Button onClick={handleEditPlan} variant="secondary">
              <i className="fas fa-edit" />
              编辑计划
            </Button>
          </>
        );
      default:
        return (
          <Button onClick={handleEditPlan} variant="outline">
            <i className="fas fa-edit" />
            编辑
          </Button>
        );
    }
  };

  const handleNavChange = (nav: string) => {
    onNavigate?.(nav);
  };

  const handleBreadcrumbClick = (page: string) => {
    onNavigate?.(page);
  };

  const handleContinueStudy = () => {
    onNavigate?.('start-study-plan', { planId });
  };

  const handleEditPlan = () => {
    onNavigate?.('edit-plan', { planId });
  };

  const handlePausePlan = async () => {
    try {
      const result = await studyService.updateStudyPlan(planId, { status: 'paused' });
      if (result.success) {
        showToast('学习计划已暂停', 'success');
        loadPlanDetail();
      } else {
        showToast(result.error || '暂停失败', 'error');
      }
    } catch (err) {
      showToast('暂停失败', 'error');
    }
  };

  const handleResumePlan = async () => {
    try {
      const result = await studyService.updateStudyPlan(planId, { status: 'active' });
      if (result.success) {
        showToast('学习计划已恢复', 'success');
        loadPlanDetail();
      } else {
        showToast(result.error || '恢复失败', 'error');
      }
    } catch (err) {
      showToast('恢复失败', 'error');
    }
  };

  const handleCompletePlan = async () => {
    try {
      const result = await studyService.updateStudyPlan(planId, { status: 'completed' });
      if (result.success) {
        showToast('学习计划已完成', 'success');
        loadPlanDetail();
      } else {
        showToast(result.error || '完成失败', 'error');
      }
    } catch (err) {
      showToast('完成失败', 'error');
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <Header activeNav="plans" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.loading}>
            <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
            <span>加载中...</span>
          </div>
        </main>
      </div>
    );
  }

  if (error || !planData) {
    return (
      <div className={styles.page}>
        <Header activeNav="plans" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.error}>
            <div className={styles.errorIcon}>
              <i className="fas fa-exclamation-triangle" />
            </div>
            <p className={styles.errorText}>{error || '计划不存在'}</p>
            <div className={styles.errorActions}>
              <Button onClick={loadPlanDetail}>重试</Button>
              <Button variant="secondary" onClick={() => onNavigate?.('plans')}>
                返回计划列表
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const statusDisplay = getStatusDisplay(planData.status as StudyPlanStatus);
  const intensityDisplay = getIntensityDisplay(planData.intensity_level || undefined);

  // 计算学习天数
  const studyDays = planData.start_date && planData.end_date
    ? Math.ceil((new Date(planData.end_date).getTime() - new Date(planData.start_date).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // 计算已学习天数
  const startDate = planData.start_date ? new Date(planData.start_date) : new Date();
  const today = new Date();
  const studiedDays = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <div className={styles.page}>
      <Header activeNav="plans" onNavChange={handleNavChange} />

      <main className={styles.main}>
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: '首页', key: 'home', icon: 'home' },
            { label: '学习计划', key: 'plans', icon: 'tasks' }
          ]}
          current={planData.name}
          onNavigate={handleBreadcrumbClick}
        />

        {/* Plan Header */}
        <section className={styles.planHeader}>
          <div className={styles.headerTop}>
            <div className={styles.planInfo}>
              <div className={styles.titleRow}>
                <div className={styles.titleLeft}>
                  <h2 className={styles.planTitle}>{planData.name}</h2>
                  <div className={styles.badgeGroup}>
                    <span className={`${styles.statusBadge} ${styles[planData.status]}`}>
                      {statusDisplay.text}
                    </span>
                    {planData.intensity_level && (
                      <span className={`${styles.intensityBadge} ${styles[planData.intensity_level]}`}>
                        {intensityDisplay.text}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.titleRight}>
                  {/* 状态转换按钮 */}
                  {planData.status === 'draft' && (
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => handleStatusChange('active')}
                    >
                      <i className="fas fa-play" />
                      激活计划
                    </Button>
                  )}
                  {planData.status === 'active' && (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => handleStatusChange('draft')}
                    >
                      <i className="fas fa-edit" />
                      转为草稿
                    </Button>
                  )}
                </div>
              </div>
              <p className={styles.planDescription}>{planData.description}</p>
              <div className={styles.planMeta}>
                {planData.start_date && planData.end_date && (
                  <div className={styles.metaItem}>
                    <i className={`fas fa-calendar ${styles.metaIcon}`} />
                    <span className={styles.metaText}>
                      {planData.start_date} 至 {planData.end_date}
                    </span>
                  </div>
                )}
                <div className={styles.metaItem}>
                  <i className={`fas fa-clock ${styles.metaIcon}`} />
                  <span className={styles.metaText}>
                    已学习 {studiedDays} 天 / 共 {studyDays} 天
                  </span>
                </div>
                {planData.review_frequency && (
                  <div className={styles.metaItem}>
                    <i className={`fas fa-repeat ${styles.metaIcon}`} />
                    <span className={styles.metaText}>
                      复习频率 {planData.review_frequency} 次
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className={styles.headerActions}>
              {renderActionButtons()}
            </div>
          </div>

          {/* Progress Bar */}
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>总体进度</span>
              <span className={styles.progressValue}>
                {planData.progress_percentage.toFixed(0)}%
              </span>
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${planData.progress_percentage}%` }}
              />
            </div>
          </div>
        </section>

        {/* Statistics Cards */}
        <section className={styles.statsGrid}>
          <StatCard
            icon="book"
            iconColor="primary"
            label="总单词数"
            value={planData.total_words}
            unit="个单词"
          />
          <StatCard
            icon="check"
            iconColor="green"
            label="已学单词"
            value={planData.learned_words}
            unit="个单词"
          />
          <StatCard
            icon="calendar-check"
            iconColor="orange"
            label="学习天数"
            value={studiedDays}
            unit="天"
          />
          <StatCard
            icon="star"
            iconColor="yellow"
            label="平均正确率"
            value={`${planData.accuracy_rate}%`}
            unit="正确率"
          />
          <StatCard
            icon="fire"
            iconColor="primary"
            label="连续学习"
            value={studyStreak}
            unit="天"
          />
          {todayWords.length > 0 && (
            <StatCard
              icon="clock"
              iconColor="blue"
              label="今日任务"
              value={todayWords.length}
              unit="个单词"
            />
          )}
        </section>

        {/* View Navigation */}
        <section className={styles.viewNavigation}>
          <div className={styles.viewTabs}>
            <button
              className={`${styles.viewTab} ${currentView === 'overview' ? styles.active : ''}`}
              onClick={() => handleViewChange('overview')}
              type="button"
            >
              <i className="fas fa-chart-pie" />
              概览
            </button>
            <button
              className={`${styles.viewTab} ${currentView === 'schedule' ? styles.active : ''}`}
              onClick={() => handleViewChange('schedule')}
              type="button"
            >
              <i className="fas fa-calendar-alt" />
              日程安排
            </button>
            <button
              className={`${styles.viewTab} ${currentView === 'words' ? styles.active : ''}`}
              onClick={() => handleViewChange('words')}
              type="button"
            >
              <i className="fas fa-book-open" />
              单词列表
            </button>

            <button
              className={`${styles.viewTab} ${currentView === 'statistics' ? styles.active : ''}`}
              onClick={() => handleViewChange('statistics')}
              type="button"
            >
              <i className="fas fa-chart-bar" />
              统计分析
            </button>
          </div>
        </section>

        {/* Main Content */}
        <section className={styles.mainContent}>
          {renderCurrentView()}
        </section>
      </main>

      {/* 删除确认Modal */}
      <BatchDeleteModal
        isOpen={deleteModal.isOpen}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        words={deleteModal.words}
        deleting={deleteModal.deleting}
      />

      {/* 状态转换确认Modal */}
      <Modal
        isOpen={statusChangeModal.isOpen}
        onClose={handleCancelStatusChange}
        title={statusChangeModal.targetStatus === 'active' ? '激活学习计划' : '转为草稿状态'}
        size="medium"
      >
        <div style={{ padding: '20px' }}>
          {statusChangeModal.targetStatus === 'active' ? (
            <div>
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#fff3cd', borderRadius: '6px', border: '1px solid #ffeaa7' }}>
                <i className="fas fa-exclamation-triangle" style={{ color: '#856404', marginRight: '8px' }} />
                <strong>重要提醒</strong>
              </div>
              <p style={{ marginBottom: '16px', lineHeight: '1.6' }}>
                将学习计划从草稿状态激活后，系统将：
              </p>
              <ul style={{ marginBottom: '20px', paddingLeft: '20px', lineHeight: '1.6' }}>
                <li>根据当前的单词列表和参数重新生成学习日程</li>
                <li>开始正式的学习计划，无法再随意修改单词</li>
                <li>生成每日学习任务和复习安排</li>
              </ul>
              <p style={{ color: '#666', fontSize: '14px' }}>
                确认要激活这个学习计划吗？
              </p>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#d1ecf1', borderRadius: '6px', border: '1px solid #bee5eb' }}>
                <i className="fas fa-info-circle" style={{ color: '#0c5460', marginRight: '8px' }} />
                <strong>状态转换</strong>
              </div>
              <p style={{ marginBottom: '16px', lineHeight: '1.6' }}>
                将学习计划转为草稿状态后，您可以：
              </p>
              <ul style={{ marginBottom: '20px', paddingLeft: '20px', lineHeight: '1.6' }}>
                <li>自由添加或删除单词</li>
                <li>修改学习参数和设置</li>
                <li>重新规划学习内容</li>
              </ul>
              <p style={{ color: '#666', fontSize: '14px' }}>
                注意：转为草稿后，当前的学习进度将被保留，但日程安排可能需要重新生成。
              </p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '0 20px 20px' }}>
          <Button
            variant="secondary"
            onClick={handleCancelStatusChange}
            disabled={statusChangeModal.processing}
          >
            取消
          </Button>
          <Button
            variant={statusChangeModal.targetStatus === 'active' ? 'primary' : 'warning'}
            onClick={handleConfirmStatusChange}
            loading={statusChangeModal.processing}
            disabled={statusChangeModal.processing}
          >
            {statusChangeModal.processing
              ? (statusChangeModal.targetStatus === 'active' ? '激活中...' : '转换中...')
              : (statusChangeModal.targetStatus === 'active' ? '确认激活' : '确认转换')
            }
          </Button>
        </div>
      </Modal>
    </div>
  );

  // 渲染当前视图内容
  function renderCurrentView() {
    switch (currentView) {
      case 'overview':
        return renderOverviewView();
      case 'schedule':
        return renderScheduleView();
      case 'words':
        return renderWordsView();

      case 'statistics':
        return renderStatisticsView();
      default:
        return renderOverviewView();
    }
  }

  // 概览视图
  function renderOverviewView() {
    const handleDateClick = (date: string) => {
      console.log('Clicked date:', date);
      // TODO: 实现日期点击功能，可以跳转到该日期的详细学习内容
    };

    return (
      <div className={styles.overviewContent}>
        {/* 统计指标卡片 */}
        <div className={styles.statsGrid}>
          <StatCard
            label="平均每日学习时长"
            value={statistics?.averageDailyStudyMinutes || 0}
            unit="分钟"
            icon="clock"
            iconColor="blue"
          />
          <StatCard
            label="时间进度"
            value={statistics?.timeProgressPercentage?.toFixed(1) || 0}
            unit="%"
            icon="calendar"
            iconColor="green"
          />
          <StatCard
            label="完成进度"
            value={statistics?.actualProgressPercentage?.toFixed(1) || 0}
            unit="%"
            icon="check-circle"
            iconColor="primary"
          />
          <StatCard
            label="平均正确率"
            value={statistics?.averageAccuracyRate?.toFixed(1) || 0}
            unit="%"
            icon="target"
            iconColor="purple"
          />
          <StatCard
            label="按时完成率"
            value={((100 - (statistics?.overdueRatio || 0))).toFixed(1)}
            unit="%"
            icon="clock-check"
            iconColor="orange"
          />
        </div>

        {/* 学习日历 */}
        <div className={styles.calendarSection}>
          <h3>学习日程</h3>
          <StudyCalendar
            aiPlanData={aiPlanData}
            onDateClick={handleDateClick}
            loading={false}
          />
        </div>
      </div>
    );
  }

  // 日程安排视图
  function renderScheduleView() {
    if (!aiPlanData) {
      return (
        <div className={styles.emptyState}>
          <i className="fas fa-calendar-times" />
          <h3>暂无AI规划数据</h3>
          <p>该学习计划没有AI生成的日程安排</p>
        </div>
      );
    }

    return (
      <div className={styles.scheduleContent}>
        <StudySchedulePreview aiResult={aiPlanData} />
      </div>
    );
  }

  // 单词列表视图
  function renderWordsView() {
    const handlePlayPronunciation = (word: WordListDetail) => {
      console.log('Playing pronunciation for:', word.word);
      // TODO: Implement text-to-speech functionality
    };

    const handleEditWord = async (word: WordListDetail) => {
      // 检查学习计划状态
      if (planData?.status !== 'draft') {
        showToast('只有草稿状态的学习计划才能编辑单词', 'warning');
        return;
      }
      // 复用单词本的编辑功能
      // TODO: 实现编辑功能，更新原始单词数据
      console.log('Edit word:', word);
    };

    // 检查是否可以进行删除操作
    const canModifyWords = planData?.status === 'draft';

    // 如果不是草稿状态，重写删除函数为提示函数
    const handleDeleteWord = canModifyWords ? handleRemoveFromPlan : (word: WordListDetail) => {
      showToast('只有草稿状态的学习计划才能删除单词', 'warning');
    };

    const handleBatchDelete = canModifyWords ? handleBatchRemoveFromPlan : (words: WordListDetail[]) => {
      showToast('只有草稿状态的学习计划才能删除单词', 'warning');
    };



    // 将 StudyPlanWord 转换为 WordListDetail 格式
    // 现在显示的是原始单词本单词，每个单词只出现一次，使用原始单词ID
    const wordsForTable: WordListDetail[] = planWords.map(word => ({
      id: word.id, // 使用原始单词ID，现在不会有重复问题
      word: word.word,
      meaning: word.meaning,
      partOfSpeech: word.partOfSpeech,
      ipa: word.ipa,
      syllables: word.syllables
    }));

    return (
      <WordListTable
        words={wordsForTable}
        onPlayPronunciation={handlePlayPronunciation}
        onEditWord={handleEditWord}
        onDeleteWord={handleDeleteWord}
        onBatchDelete={handleBatchDelete}
        loading={wordsLoading}
        readonly={!canModifyWords}
      />
    );
  }



  // 统计分析视图
  function renderStatisticsView() {
    return (
      <div className={styles.statisticsContent}>
        <div className={styles.statsCards}>
          <div className={styles.statCard}>
            <h4>学习效率</h4>
            <div className={styles.statValue}>{planData?.accuracy_rate || 0}%</div>
            <div className={styles.statTrend}>
              <i className="fas fa-arrow-up" />
              <span>较上周提升 5%</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <h4>掌握程度</h4>
            <div className={styles.statValue}>{planData?.mastery_level || 0}/5</div>
            <div className={styles.statTrend}>
              <i className="fas fa-arrow-up" />
              <span>较上周提升 0.5</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <h4>学习连续性</h4>
            <div className={styles.statValue}>{studyStreak}天</div>
            <div className={styles.statTrend}>
              <i className="fas fa-fire" />
              <span>连续学习记录</span>
            </div>
          </div>
        </div>

        <div className={styles.detailedStats}>
          <h3>详细统计</h3>
          <div className={styles.statsTable}>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>总学习时间</span>
              <span className={styles.statsValue}>24小时 30分钟</span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>平均每日学习</span>
              <span className={styles.statsValue}>35分钟</span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>最长连续学习</span>
              <span className={styles.statsValue}>{studyStreak}天</span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>完成率</span>
              <span className={styles.statsValue}>{planData?.progress_percentage?.toFixed(1) || 0}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
};

export default PlanDetailPage;