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

import { Modal } from '../components/Modal';
import { EditPlanModal } from '../components/EditPlanModal';
import { StudyService } from '../services/studyService';
import { practiceService } from '../services';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import type {
  StudyPlanWithProgress,
  StudyPlanAIResult,
  DailyStudyWord,
  StudyPlanStatus,
  StudyPlanLifecycleStatus,
  StudyPlanWord,
  StudyPlanStatistics,
  UnifiedStudyPlanStatus,
  StudyPlanAction,
  PracticeSession
} from '../types';
import {
  getStatusDisplay,
  getAvailableActions
} from '../types/study';

// 视图模式类型
type ViewMode = 'overview' | 'schedule' | 'words' | 'statistics' | 'logs';





// 辅助函数

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

function getActionConfig(action: string, currentStatus?: UnifiedStudyPlanStatus) {
  switch (action) {
    case 'edit':
      // 根据当前状态调整编辑按钮的文字
      if (currentStatus === 'Draft') {
        return { label: '继续编辑', icon: 'edit', color: 'primary' };
      } else if (currentStatus === 'Active') {
        return { label: '修改计划', icon: 'edit', color: 'primary' };
      } else {
        return { label: '编辑计划', icon: 'edit', color: 'primary' };
      }
    case 'publish':
      return { label: '发布计划', icon: 'paper-plane', color: 'primary' };
    case 'start':
      return { label: '开始学习', icon: 'play', color: 'primary' };
    case 'complete':
      return { label: '完成学习', icon: 'check', color: 'primary' };
    case 'terminate':
      return { label: '终止学习', icon: 'stop', color: 'danger' };
    case 'restart':
      return { label: '重新学习', icon: 'redo', color: 'primary' };
    case 'delete':
      return { label: '删除计划', icon: 'trash', color: 'danger' };
    case 'restore':
      return { label: '恢复计划', icon: 'undo', color: 'primary' };
    case 'permanentDelete':
      return { label: '永久删除', icon: 'trash-alt', color: 'danger' };
    default:
      return { label: action, icon: 'cog', color: 'primary' };
  }
}

function getPartOfSpeechDisplay(pos: string) {
  switch (pos) {
    case 'n.':
      return { label: '名词', icon: 'cube', color: 'blue' };
    case 'v.':
      return { label: '动词', icon: 'play', color: 'green' };
    case 'adj.':
      return { label: '形容词', icon: 'palette', color: 'purple' };
    case 'adv.':
      return { label: '副词', icon: 'fast-forward', color: 'orange' };
    case 'prep.':
      return { label: '介词', icon: 'link', color: 'teal' };
    case 'conj.':
      return { label: '连词', icon: 'plus', color: 'indigo' };
    case 'int.':
      return { label: '感叹词', icon: 'exclamation', color: 'red' };
    case 'pron.':
      return { label: '代词', icon: 'user', color: 'pink' };
    default:
      return { label: '其他', icon: 'question', color: 'gray' };
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
  const audioPlayer = useAudioPlayer();

  // 状态管理
  const [planData, setPlanData] = useState<StudyPlanWithProgress | null>(null);
  const [aiPlanData, setAiPlanData] = useState<StudyPlanAIResult | null>(null);
  const [currentView, setCurrentView] = useState<ViewMode>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsRegeneration] = useState(false);

  // 统计数据
  // const [studyStreak, setStudyStreak] = useState(0);
  const [todayWords, setTodayWords] = useState<DailyStudyWord[]>([]);

  // 扁平化单词列表
  const [planWords, setPlanWords] = useState<StudyPlanWord[]>([]);
  const [wordsLoading, setWordsLoading] = useState(false);

  // 统计数据
  const [statistics, setStatistics] = useState<StudyPlanStatistics | null>(null);

  // 词性统计数据
  const [partOfSpeechStats, setPartOfSpeechStats] = useState<{[key: string]: number}>({});

  // 练习会话数据（替代学习日志）
  const [practiceSessions, setPracticeSessions] = useState<PracticeSession[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);



  // 状态转换确认状态
  const [statusChangeModal, setStatusChangeModal] = useState<{
    isOpen: boolean;
    action: 'start' | 'complete' | 'terminate' | 'restart' | 'edit' | 'publish' | 'delete';
    actionLabel: string;
    confirmMessage: string;
    processing: boolean;
  }>({
    isOpen: false,
    action: 'start',
    actionLabel: '',
    confirmMessage: '',
    processing: false
  });

  // 编辑计划模态框状态
  const [editPlanModal, setEditPlanModal] = useState<{
    isOpen: boolean;
    saving: boolean;
  }>({
    isOpen: false,
    saving: false
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

      // 确保状态字段的类型正确性
      const normalizedPlan = {
        ...plan,
        status: plan.status as StudyPlanStatus,
        lifecycle_status: plan.lifecycle_status as StudyPlanLifecycleStatus,
        unified_status: plan.unified_status as UnifiedStudyPlanStatus
      };

      console.log('Plan data received:', {
        id: plan.id,
        name: plan.name,
        status: plan.status,
        lifecycle_status: plan.lifecycle_status,
        unified_status: plan.unified_status,
        statusType: typeof plan.status,
        lifecycleStatusType: typeof plan.lifecycle_status,
        unifiedStatusType: typeof plan.unified_status
      });

      setPlanData(normalizedPlan);

      // 解析AI规划数据
      if (plan.ai_plan_data) {
        try {
          const aiData: StudyPlanAIResult = JSON.parse(plan.ai_plan_data);
          setAiPlanData(aiData);

          // 获取今日学习单词
          const today = new Date().toISOString().split('T')[0];
          const todayPlan = aiData.dailyPlans?.find(dp => dp.date === today);
          if (todayPlan) {
            setTodayWords(todayPlan.words);
          }
        } catch (e) {
          console.warn('Failed to parse AI plan data:', e);
        }
      }

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



  // 加载扁平化单词列表
  const loadPlanWords = async () => {
    if (!planId) return;

    try {
      setWordsLoading(true);
      const result = await studyService.getStudyPlanWords(planId);

      if (result.success) {
        setPlanWords(result.data);
        // 计算词性统计
        const posStats = calculatePartOfSpeechStats(result.data);
        setPartOfSpeechStats(posStats);
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
    console.log('loadStatistics called, planId:', planId);
    if (!planId) {
      console.log('loadStatistics: planId is empty, returning');
      return;
    }

    try {
      console.log('loadStatistics: calling getStudyPlanStatistics with planId:', planId);
      const result = await studyService.getStudyPlanStatistics(planId);
      console.log('loadStatistics: API result:', result);

      if (result.success) {
        console.log('loadStatistics: setting statistics:', result.data);
        setStatistics(result.data);
        // 同时设置该计划的连续练习天数
        // setStudyStreak(result.data?.streakDays || 0);
        console.log('loadStatistics: set streakDays to:', result.data?.streakDays || 0);
      } else {
        console.warn('Failed to load statistics:', result.error);
        // setStudyStreak(0);
      }
    } catch (error) {
      console.warn('Failed to load statistics:', error);
    }
  };

  // 加载练习会话数据
  const loadPracticeSessions = async () => {
    if (!planId) return;

    try {
      setLogsLoading(true);
      const result = await practiceService.getPlanPracticeSessions(planId);

      if (result.success) {
        setPracticeSessions(result.data);
      } else {
        console.error('加载练习会话失败:', result.error);
        showToast('加载练习会话失败', 'error');
      }
    } catch (error) {
      console.error('加载练习会话失败:', error);
      showToast('加载练习会话失败', 'error');
    } finally {
      setLogsLoading(false);
    }
  };

  // 计算词性统计 - 基于唯一单词ID，避免重复计算复习单词
  const calculatePartOfSpeechStats = (words: StudyPlanWord[]) => {
    const stats: {[key: string]: number} = {};
    const uniqueWords = new Map<number, StudyPlanWord>();

    // 去重：基于word_id，只保留每个单词的一个实例
    words.forEach(word => {
      if (!uniqueWords.has(word.id)) {
        uniqueWords.set(word.id, word);
      }
    });

    // 统计唯一单词的词性分布
    uniqueWords.forEach(word => {
      const pos = word.partOfSpeech || 'unknown';
      stats[pos] = (stats[pos] || 0) + 1;
    });

    return stats;
  };

  // 事件处理函数
  const handleViewChange = (view: ViewMode) => {
    setCurrentView(view);

    // 根据视图加载相应数据
    if (view === 'words' && planWords.length === 0) {
      loadPlanWords();
    } else if (view === 'statistics' && !statistics) {
      loadStatistics();
    } else if (view === 'logs' && practiceSessions.length === 0) {
      loadPracticeSessions();
    }
  };



  // 状态转换处理
  const handleStatusAction = (action: 'start' | 'complete' | 'terminate' | 'restart' | 'edit' | 'publish' | 'delete') => {
    if (!planData) return;

    // 如果是草稿状态下的编辑操作，直接打开编辑模态框
    if (action === 'edit' && planData.unified_status === 'Draft') {
      handleEditPlan();
      return;
    }

    const availableActions = getAvailableActions(planData.unified_status as UnifiedStudyPlanStatus);
    const isActionAvailable = availableActions.includes(action as any);

    if (!isActionAvailable) return;

    const actionConfig = getActionConfig(action, planData.unified_status as UnifiedStudyPlanStatus);

    setStatusChangeModal({
      isOpen: true,
      action,
      actionLabel: (actionConfig as any).label,
      confirmMessage: (actionConfig as any).confirmMessage || `确认${(actionConfig as any).label}吗？`,
      processing: false
    });
  };

  // 确认状态转换
  const handleConfirmStatusChange = async () => {
    if (!planData || !planId) return;

    setStatusChangeModal(prev => ({ ...prev, processing: true }));

    try {
      let result;

      switch (statusChangeModal.action) {
        case 'start':
          result = await studyService.startStudyPlan(planId);
          if (result.success) {
            showToast('学习计划已开始', 'success');
          }
          break;

        case 'complete':
          result = await studyService.completeStudyPlan(planId);
          if (result.success) {
            showToast('学习计划已完成', 'success');
          }
          break;

        case 'terminate':
          result = await studyService.terminateStudyPlan(planId);
          if (result.success) {
            showToast('学习计划已终止', 'success');
          }
          break;

        case 'restart':
          result = await studyService.restartStudyPlan(planId);
          if (result.success) {
            showToast('学习计划已重置，请重新生成日程', 'success');
          }
          break;

        case 'edit':
          // 如果是草稿状态，打开编辑模态框
          if (planData.status === 'draft') {
            handleEditPlan();
            return; // 不需要API调用，直接返回
          }
          // 如果是正常状态，转为草稿状态
          result = await studyService.editStudyPlan(planId);
          if (result.success) {
            showToast('学习计划已转为草稿状态，学习进度已重置', 'success');
          }
          break;

        case 'publish':
          result = await studyService.publishStudyPlan(planId);
          if (result.success) {
            showToast('学习计划已发布', 'success');
          }
          break;

        case 'delete':
          result = await studyService.deleteStudyPlan(planId);
          if (result.success) {
            showToast('学习计划已删除', 'success');
            // 删除后跳转到列表页
            onNavigate?.('plans');
            return;
          }
          break;

        default:
          throw new Error('未知的操作类型');
      }

      if (!result.success) {
        showToast(result.error, 'error');
        return;
      }

      // 重新加载计划详情
      await loadPlanDetail();

      // 关闭Modal
      setStatusChangeModal({
        isOpen: false,
        action: 'start',
        actionLabel: '',
        confirmMessage: '',
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
      action: 'start',
      actionLabel: '',
      confirmMessage: '',
      processing: false
    });
  };

  // 打开编辑计划模态框
  const handleEditPlan = () => {
    setEditPlanModal({
      isOpen: true,
      saving: false
    });
  };

  // 处理进入练习
  const handleStartPractice = async () => {
    if (!planData) return;

    try {
      // 获取当前应该练习的日程
      const studyService = new StudyService();
      const schedulesResult = await studyService.getStudyPlanSchedules(planData.id);

      if (schedulesResult.success) {
        if (schedulesResult.data.length > 0) {
          // 找到今天的日程，如果没有则使用第一个未完成的日程
          const today = new Date().toISOString().split('T')[0];
          let targetSchedule = schedulesResult.data.find(schedule =>
            schedule.schedule_date === today && !schedule.completed
          );

          // 如果没有今天的日程，找第一个未完成的日程
          if (!targetSchedule) {
            targetSchedule = schedulesResult.data.find(schedule => !schedule.completed);
          }

          // 如果还是没有，使用第一个日程
          if (!targetSchedule) {
            targetSchedule = schedulesResult.data[0];
          }

          if (targetSchedule) {
            onNavigate?.('word-practice', {
              planId: planData.id,
              scheduleId: targetSchedule.id
            });
          } else {
            showToast('没有找到可练习的日程', 'error');
          }
        } else {
          // 没有日程数据，提示用户生成日程
          showToast('该学习计划还没有生成学习日程，请先编辑计划并生成AI规划', 'warning');
        }
      } else {
        showToast('获取学习日程失败', 'error');
      }
    } catch (error) {
      console.error('进入练习失败:', error);
      showToast('进入练习时发生错误', 'error');
    }
  };

  // 处理开始指定日程的练习
  const handleStartSchedulePractice = async (planId: number, scheduleDate: string) => {
    if (!planData) return;

    try {
      // 获取该日期的日程
      const studyService = new StudyService();
      const schedulesResult = await studyService.getStudyPlanSchedules(planId);

      if (schedulesResult.success) {
        // 找到对应日期的日程
        const targetSchedule = schedulesResult.data.find(schedule =>
          schedule.schedule_date === scheduleDate
        );

        if (targetSchedule) {
          // 导航到练习页面
          onNavigate?.('word-practice', {
            planId: planId,
            scheduleId: targetSchedule.id
          });
        } else {
          showToast('未找到对应日期的学习日程', 'error');
        }
      } else {
        showToast(schedulesResult.error || '获取学习日程失败', 'error');
      }
    } catch (error) {
      console.error('开始练习失败:', error);
      showToast('开始练习失败', 'error');
    }
  };

  // 关闭编辑计划模态框
  const handleCloseEditPlan = () => {
    setEditPlanModal({
      isOpen: false,
      saving: false
    });
  };

  // 保存编辑计划
  const handleSaveEditPlan = async () => {
    try {
      setEditPlanModal(prev => ({ ...prev, saving: true }));

      // 重新加载计划数据
      await loadPlanDetail();

      // 不需要显示toast，EditPlanModal内部已经显示了
      handleCloseEditPlan();
    } catch (err) {
      console.error('Failed to reload plan after edit:', err);
      showToast('更新成功，但刷新数据失败', 'warning');
    } finally {
      setEditPlanModal(prev => ({ ...prev, saving: false }));
    }
  };



  const handleNavChange = (nav: string) => {
    onNavigate?.(nav);
  };

  const handleBreadcrumbClick = (page: string) => {
    onNavigate?.(page);
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

  const intensityDisplay = getIntensityDisplay(planData.intensity_level || undefined);



  // 计算时间进度（基于日程自然日进度）
  const calculateTimeProgress = () => {
    if (!planData.start_date || !planData.end_date) return 0;

    const startDate = new Date(planData.start_date);
    const endDate = new Date(planData.end_date);
    const today = new Date();

    // 设置时间为当天开始，避免时区问题
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    today.setHours(0, 0, 0, 0);

    // 如果还没开始，时间进度为0%
    if (today < startDate) return 0;

    // 如果已经结束，时间进度为100%
    if (today > endDate) return 100;

    // 计算当前时间进度 - 修复计算逻辑
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1; // +1 包含开始日期
    const passedDays = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)); // 开始日期当天为0

    console.log('时间进度计算:', {
      startDate: planData.start_date,
      endDate: planData.end_date,
      today: today.toISOString().split('T')[0],
      totalDays,
      passedDays,
      progress: (passedDays / totalDays) * 100
    });

    return Math.min(100, Math.max(0, (passedDays / totalDays) * 100));
  };

  const timeProgress = calculateTimeProgress();
  // 使用统计数据的实际进度，如果没有则显示0
  const actualProgress = statistics ? (statistics as any).actual_progress_percentage || 0 : 0;

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
          {/* Title Row - 独立容器 */}
          <div className={styles.titleRow}>
            <div className={styles.titleSection}>
              <h2 className={styles.planTitle}>{planData.name}</h2>
              <p className={styles.planDescription}>{planData.description}</p>
            </div>
            <div className={styles.headerActions}>
              {/* 主要操作按钮 - 按优先级和相关性排列 */}

              {/* 1. 进入练习按钮 - 最高优先级 */}
              {planData.unified_status === 'Active' && (
                <Button
                  variant="primary"
                  onClick={handleStartPractice}
                >
                  进入练习
                </Button>
              )}

              {/* 2. 状态转换按钮 - 按操作流程排列 */}
              {getAvailableActions(planData.unified_status as UnifiedStudyPlanStatus)
                .sort((a, b) => {
                  // 定义按钮优先级顺序
                  const priority: Record<StudyPlanAction, number> = {
                    'start': 1,     // 开始学习
                    'publish': 2,   // 发布计划
                    'complete': 3,  // 完成学习
                    'edit': 4,      // 编辑计划
                    'terminate': 5, // 终止学习
                    'restart': 6,   // 重新开始
                    'delete': 7,    // 删除计划
                    'restore': 8,   // 恢复计划
                    'permanentDelete': 9 // 永久删除
                  };
                  return (priority[a] || 99) - (priority[b] || 99);
                })
                .map((action) => {
                  const actionConfig = getActionConfig(action, planData.unified_status as UnifiedStudyPlanStatus);
                  return (
                    <Button
                      key={action}
                      variant={actionConfig.color === 'danger' ? 'danger' : actionConfig.color === 'warning' ? 'secondary' : 'primary'}
                      onClick={() => handleStatusAction(action as any)}
                    >
                      {actionConfig.label}
                    </Button>
                  );
                })}
            </div>
          </div>

          {/* Info Cards - 独立容器 */}
          <div className={styles.infoCardsContainer}>
            <div className={styles.infoGrid}>
              <div className={styles.infoCard}>
                <div className={styles.infoHeader}>
                  <i className="fas fa-info-circle" />
                  <span>计划状态</span>
                </div>
                <div className={styles.infoContent}>
                  <span className={`${styles.statusText} ${styles[planData.unified_status?.toLowerCase()]}`}>
                    {getStatusDisplay(planData.unified_status as UnifiedStudyPlanStatus).text}
                  </span>
                </div>
              </div>

              <div className={styles.infoCard}>
                <div className={styles.infoHeader}>
                  <i className="fas fa-tachometer-alt" />
                  <span>学习强度</span>
                </div>
                <div className={styles.infoContent}>
                  <span className={`${styles.intensityText} ${planData.intensity_level ? styles[planData.intensity_level] : ''}`}>
                    {intensityDisplay.text}
                  </span>
                </div>
              </div>

              <div className={styles.infoCard}>
                <div className={styles.infoHeader}>
                  <i className="fas fa-calendar" />
                  <span>学习周期</span>
                </div>
                <div className={styles.infoContent}>
                  {planData.start_date && planData.end_date ? (
                    <div className={styles.dateRange}>
                      <div>{planData.start_date}</div>
                      <div className={styles.dateSeparator}>至</div>
                      <div>{planData.end_date}</div>
                    </div>
                  ) : (
                    <span className={styles.noData}>未设置</span>
                  )}
                </div>
              </div>

              <div className={styles.infoCard}>
                <div className={styles.infoHeader}>
                  <i className="fas fa-book" />
                  <span>单词数量</span>
                </div>
                <div className={styles.infoContent}>
                  <span>{planData.total_words || 0} 个单词</span>
                </div>
              </div>

              {planData.review_frequency && (
                <div className={styles.infoCard}>
                  <div className={styles.infoHeader}>
                    <i className="fas fa-repeat" />
                    <span>复习频率</span>
                  </div>
                  <div className={styles.infoContent}>
                    <span>{planData.review_frequency} 次</span>
                  </div>
                </div>
              )}
            </div>
          </div>

        {/* Draft Status Alert */}
        {planData.status === 'draft' && (
          <div className={styles.draftAlert}>
            <div className={styles.draftAlertContent}>
              <div className={styles.draftAlertIcon}>
                <i className="fas fa-edit" />
              </div>
              <div className={styles.draftAlertText}>
                <h4>草稿状态</h4>
                <p>当前计划处于草稿状态，您可以自由修改计划内容和单词列表。</p>
                {needsRegeneration && (
                  <p className={styles.regenerationWarning}>
                    <i className="fas fa-exclamation-triangle" />
                    检测到内容变更，建议重新生成学习日程以获得最佳学习效果。
                  </p>
                )}
              </div>
              <div className={styles.draftAlertActions}>
                {needsRegeneration && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      // TODO: 实现重新生成日程的功能
                      showToast('重新生成日程功能开发中', 'info');
                    }}
                  >
                    <i className="fas fa-sync-alt" />
                    重新生成日程
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleStatusAction('publish')}
                >
                  <i className="fas fa-paper-plane" />
                  发布计划
                </Button>
              </div>
            </div>
          </div>
        )}

          {/* Progress Bars */}
          <div className={styles.progressSection}>
            {/* 时间进度 */}
            <div className={styles.progressItem}>
              <div className={styles.progressHeader}>
                <span className={styles.progressLabel}>时间进度</span>
                <span className={styles.progressValue}>
                  {timeProgress.toFixed(0)}%
                </span>
              </div>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${timeProgress}%` }}
                />
              </div>
            </div>

            {/* 实际进度 */}
            <div className={styles.progressItem}>
              <div className={styles.progressHeader}>
                <span className={styles.progressLabel}>实际进度</span>
                <span className={styles.progressValue}>
                  {actualProgress.toFixed(0)}%
                </span>
              </div>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${actualProgress}%` }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Core Statistics Cards - 核心指标 */}
        <section className={styles.coreStatsGrid}>
          <StatCard
            icon="book"
            iconColor="primary"
            label="总单词数"
            value={planData.total_words}
            unit="个"
          />
          <StatCard
            icon="check"
            iconColor="green"
            label="已学单词"
            value={(statistics as any)?.completed_words || 0}
            unit="个"
          />
          <StatCard
            icon="star"
            iconColor="yellow"
            label="平均正确率"
            value={`${Math.round((statistics as any)?.average_accuracy_rate || 0)}%`}
            unit=""
          />
          <StatCard
            icon="fire"
            iconColor="orange"
            label="连续学习"
            value={(statistics as any)?.streak_days || 0}
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

        {/* Main Content */}
        <section className={styles.mainContent}>
          {/* View Navigation */}
          <div className={styles.viewNavigation}>
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
              <button
                className={`${styles.viewTab} ${currentView === 'logs' ? styles.active : ''}`}
                onClick={() => handleViewChange('logs')}
                type="button"
              >
                <i className="fas fa-history" />
                学习日志
              </button>
            </div>
          </div>

          {/* Content Area */}
          <div className={styles.contentArea}>
            {renderCurrentView()}
          </div>
        </section>
      </main>



      {/* 状态转换确认Modal */}
      <Modal
        isOpen={statusChangeModal.isOpen}
        onClose={handleCancelStatusChange}
        title={statusChangeModal.actionLabel}
        size="medium"
      >
        <div className={styles.modalContent}>
          <div className={styles.confirmMessage}>
            <i className="fas fa-question-circle" />
            <p>{statusChangeModal.confirmMessage}</p>
          </div>

          <div className={styles.modalActions}>
            <Button
              variant="secondary"
              onClick={handleCancelStatusChange}
              disabled={statusChangeModal.processing}
            >
              取消
            </Button>
            <Button
              variant={statusChangeModal.action === 'delete' ? 'danger' : 'primary'}
              onClick={handleConfirmStatusChange}
              loading={statusChangeModal.processing}
              disabled={statusChangeModal.processing}
            >
              {statusChangeModal.processing ? '处理中...' : `确认${statusChangeModal.actionLabel}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 编辑计划Modal */}
      <EditPlanModal
        isOpen={editPlanModal.isOpen}
        onClose={handleCloseEditPlan}
        plan={planData}
        onSave={handleSaveEditPlan}
        saving={editPlanModal.saving}
      />
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
      case 'logs':
        return renderLogsView();
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
        {/* 学习日历 */}
        <div className={styles.calendarSection}>
          <h3 className={styles.sectionTitle}>学习日程</h3>
          <StudyCalendar
            planId={planId}
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
        <StudySchedulePreview
          aiResult={aiPlanData}
          mode="edit"
          planId={planData?.id}
          onStartPractice={handleStartSchedulePractice}
        />
      </div>
    );
  }

  // 单词列表视图
  function renderWordsView() {
    const handlePlayPronunciation = (word: WordListDetail) => {
      audioPlayer.playWord(word.word);
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
        loading={wordsLoading}
        readonly={true}
      />
    );
  }



  // 统计分析视图
  function renderStatisticsView() {
    return (
      <div className={styles.statisticsContent}>
        {/* 学习效率指标 */}
        <div className={styles.statsSection}>
          <h3 className={styles.sectionTitle}>学习效率</h3>
          <div className={styles.statsGrid}>
            <StatCard
              label="平均每日学习时长"
              value={(statistics as any)?.average_daily_study_minutes || 0}
              unit="分钟"
              icon="clock"
              iconColor="blue"
            />
            <StatCard
              label="时间进度"
              value={Math.round((statistics as any)?.time_progress_percentage || 0).toString()}
              unit="%"
              icon="calendar"
              iconColor="green"
            />
            <StatCard
              label="按时完成率"
              value={Math.round((statistics as any)?.actual_progress_percentage || 0).toString()}
              unit="%"
              icon="clock-check"
              iconColor="orange"
            />
          </div>
        </div>

        {/* 学习内容统计 */}
        <div className={styles.statsSection}>
          <h3 className={styles.sectionTitle}>学习内容统计</h3>
          <div className={styles.statsGrid}>
            {Object.entries(partOfSpeechStats).map(([pos, count]) => {
              const posDisplay = getPartOfSpeechDisplay(pos);
              return (
                <StatCard
                  key={pos}
                  label={posDisplay.label}
                  value={count}
                  unit="个"
                  icon={posDisplay.icon}
                  iconColor={posDisplay.color as any}
                />
              );
            })}
          </div>
        </div>

        {/* 详细统计 */}
        <div className={styles.statsSection}>
          <h3 className={styles.sectionTitle}>详细统计</h3>
          <div className={styles.statsTable}>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>总学习时间</span>
              <span className={styles.statsValue}>
                {(statistics as any)?.total_study_minutes ?
                  `${Math.floor((statistics as any).total_study_minutes / 60)}小时 ${(statistics as any).total_study_minutes % 60}分钟` :
                  '0小时 0分钟'
                }
              </span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>平均每日学习</span>
              <span className={styles.statsValue}>{(statistics as any)?.average_daily_study_minutes || 0}分钟</span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>最长连续学习</span>
              <span className={styles.statsValue}>{(statistics as any)?.streak_days || 0}天</span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>计划完成率</span>
              <span className={styles.statsValue}>{Math.round((statistics as any)?.actual_progress_percentage || 0)}%</span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>时间完成率</span>
              <span className={styles.statsValue}>{Math.round((statistics as any)?.time_progress_percentage || 0)}%</span>
            </div>
          </div>
        </div>


      </div>
    );
  }

  // 练习会话视图
  function renderLogsView() {
    if (logsLoading) {
      return (
        <div className={styles.loadingContainer}>
          <i className="fas fa-spinner fa-spin" />
          <span>加载练习记录中...</span>
        </div>
      );
    }

    if (practiceSessions.length === 0) {
      return (
        <div className={styles.emptyState}>
          <i className="fas fa-history" />
          <h3>暂无练习记录</h3>
          <p>开始练习后，这里将显示您的练习历史记录</p>
        </div>
      );
    }

    return (
      <div className={styles.logsContent}>
        <div className={styles.logsHeader}>
          <h3>练习记录</h3>
          <p>显示该学习计划下所有的练习会话记录</p>
        </div>

        <div className={styles.sessionsList}>
          {practiceSessions.map((session) => (
            <div key={session.sessionId} className={styles.sessionCard}>
              <div className={styles.sessionHeader}>
                <div className={styles.sessionInfo}>
                  <div className={styles.sessionDate}>
                    {new Date(session.scheduleDate).toLocaleDateString('zh-CN', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      weekday: 'short'
                    })}
                  </div>
                  <div className={styles.sessionTime}>
                    {new Date(session.startTime).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                    {session.endTime && (
                      <> - {new Date(session.endTime).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}</>
                    )}
                  </div>
                </div>
                <div className={`${styles.sessionStatus} ${session.completed ? styles.completed : styles.incomplete}`}>
                  {session.completed ? (
                    <>
                      <i className="fas fa-check-circle" />
                      <span>已完成</span>
                    </>
                  ) : (
                    <>
                      <i className="fas fa-clock" />
                      <span>未完成</span>
                    </>
                  )}
                </div>
              </div>

              <div className={styles.sessionStats}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>练习时长</span>
                  <span className={styles.statValue}>
                    {Math.floor(session.activeTime / 60000)}分{Math.floor((session.activeTime % 60000) / 1000)}秒
                  </span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>总时长</span>
                  <span className={styles.statValue}>
                    {Math.floor(session.totalTime / 60000)}分{Math.floor((session.totalTime % 60000) / 1000)}秒
                  </span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>暂停次数</span>
                  <span className={styles.statValue}>{session.pauseCount}次</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>会话ID</span>
                  <span className={styles.statValue}>{session.sessionId?.slice(0, 8) || 'N/A'}...</span>
                </div>
              </div>

              {!session.completed && (
                <div className={styles.sessionActions}>
                  <Button
                    onClick={() => {
                      if (onNavigate) {
                        onNavigate('word-practice', {
                          planId: session.planId,
                          scheduleId: session.scheduleId,
                          sessionId: session.sessionId
                        });
                      }
                    }}
                    size="sm"
                    variant="primary"
                  >
                    <i className="fas fa-play" />
                    继续练习
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
};

export default PlanDetailPage;