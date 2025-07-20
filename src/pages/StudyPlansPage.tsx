import React, { useState, useMemo } from 'react';
import styles from './StudyPlansPage.module.css';
import { 
  Header, 
  Breadcrumb,
  FilterSelect, 
  StatsOverview, 
  StudyPlanSection, 
  Button 
} from '../components';
import { StudyService } from '../services/studyService';
import type { FilterOption, StatsCard } from '../components';
import { useAsyncData } from '../hooks/useAsyncData';
import { showErrorMessage } from '../utils/errorHandler';

export interface StudyPlansPageProps {
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * Study Plans page component displaying all study plans organized by status
 */
export const StudyPlansPage: React.FC<StudyPlansPageProps> = ({ onNavigate }) => {
  const studyService = new StudyService();
  const { data: studyPlans, loading, error, refresh } = useAsyncData(async () => {
    const result = await studyService.getAllStudyPlans();
    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error || '获取学习计划失败');
    }
  });
  const [statusFilter, setStatusFilter] = useState('all');

  // 统一状态过滤选项
  const statusFilterOptions: FilterOption[] = [
    { value: 'all', label: '全部状态' },
    { value: 'Draft', label: '草稿' },
    { value: 'Pending', label: '待开始' },
    { value: 'Active', label: '进行中' },
    { value: 'Paused', label: '已暂停' },
    { value: 'Completed', label: '已完成' },
    { value: 'Terminated', label: '已终止' },
    { value: 'Deleted', label: '已删除' }
  ];

  // Filter plans by unified status
  const filteredPlans = useMemo(() => {
    if (!studyPlans || !Array.isArray(studyPlans)) return [];

    return studyPlans.filter(plan => {
      // 使用统一状态过滤
      if (statusFilter !== 'all' && plan.unified_status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [studyPlans, statusFilter]);

  // Group plans by unified status
  const groupedPlans = useMemo(() => {
    if (!studyPlans || !Array.isArray(studyPlans)) {
      return { draft: [], pending: [], active: [], paused: [], completed: [], terminated: [] };
    }

    // 按统一状态分组（排除已删除的）
    const visiblePlans = studyPlans.filter(plan => plan.unified_status !== 'Deleted');

    const groups = {
      draft: visiblePlans.filter(plan => plan.unified_status === 'Draft'),
      pending: visiblePlans.filter(plan => plan.unified_status === 'Pending'),
      active: visiblePlans.filter(plan => plan.unified_status === 'Active'),
      paused: visiblePlans.filter(plan => plan.unified_status === 'Paused'),
      completed: visiblePlans.filter(plan => plan.unified_status === 'Completed'),
      terminated: visiblePlans.filter(plan => plan.unified_status === 'Terminated')
    };

    return groups;
  }, [studyPlans]);

  // Helper functions for filtered section display
  const getFilteredSectionTitle = () => {
    if (statusFilter !== 'all') {
      return statusFilterOptions.find(opt => opt.value === statusFilter)?.label || '学习计划';
    }
    return '学习计划';
  };

  const getFilteredSectionColor = () => {
    if (statusFilter === 'Active') return 'green';
    if (statusFilter === 'Pending') return 'blue';
    if (statusFilter === 'Paused') return 'orange';
    if (statusFilter === 'Completed') return 'gray';
    if (statusFilter === 'Terminated') return 'red';
    if (statusFilter === 'Draft') return 'gray';
    if (statusFilter === 'draft') return 'orange';
    if (statusFilter === 'deleted') return 'red';
    return 'blue';
  };

  // Generate statistics
  const statsData: StatsCard[] = useMemo(() => {
    const totalPlans = studyPlans?.filter(plan => plan.status !== 'deleted').length || 0;
    const activePlans = groupedPlans.active.length;
    const completedPlans = groupedPlans.completed.length;
    const terminatedPlans = groupedPlans.terminated.length;
    const draftPlans = groupedPlans.draft.length;
    const totalStudyTime = 45; // Mock data

    return [
      {
        id: 'total',
        title: '总计划数',
        value: totalPlans,
        icon: 'tasks',
        color: 'primary',
        change: '+12%',
        changeType: 'positive'
      },
      {
        id: 'active',
        title: '进行中',
        value: activePlans,
        icon: 'play',
        color: 'green',
        change: '+5',
        changeType: 'positive'
      },
      {
        id: 'completed',
        title: '已完成',
        value: completedPlans,
        icon: 'check-circle',
        color: 'orange',
        change: '68%',
        changeType: 'neutral'
      },
      {
        id: 'draft',
        title: '草稿',
        value: draftPlans,
        icon: 'edit',
        color: 'blue',
        change: `${draftPlans}`,
        changeType: 'neutral'
      }
    ];
  }, [studyPlans, groupedPlans]);

  const handlePlanClick = (planId: number) => {
    onNavigate?.('plan-detail', { planId });
  };

  const handleStudyStart = (planId: number) => {
    onNavigate?.('start-study-plan', { planId });
  };

  const handleMenuAction = (planId: number, action: string) => {
    console.log('Menu action:', action, 'for plan:', planId);
    // TODO: Handle menu actions (edit, delete, etc.)
  };

  const handleCreatePlan = () => {
    onNavigate?.('create-plan');
  };

  const handleNavChange = (nav: string) => {
    onNavigate?.(nav);
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <Header activeNav="plans" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.loading}>
            <div className={styles.loadingSpinner}>
              <i className="fas fa-spinner fa-spin"></i>
            </div>
            <p>正在加载学习计划...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header activeNav="plans" onNavChange={handleNavChange} />
      
      <main className={styles.main}>
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: '首页', key: 'home', icon: 'home' }
          ]}
          current="学习计划"
          onNavigate={handleNavChange}
        />

        {/* Error Banner */}
        {error && (
          <section className={styles.errorSection}>
            <div className={styles.errorBanner}>
              <div className={styles.errorIcon}>
                <i className="fas fa-exclamation-triangle" />
              </div>
              <div className={styles.errorContent}>
                <h4>数据加载失败</h4>
                <p>{showErrorMessage(error)}</p>
                <button onClick={refresh} className={styles.retryBtn}>
                  <i className="fas fa-redo" />
                  重试
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Page Header */}
        <section className={styles.pageHeader}>
          <div className={styles.headerContent}>
            <div className={styles.headerInfo}>
              <h2 className={styles.pageTitle}>学习计划</h2>
              <p className={styles.pageSubtitle}>管理和跟踪你的学习进度</p>
            </div>
            <div className={styles.headerActions}>
              <FilterSelect
                options={statusFilterOptions}
                value={statusFilter}
                onChange={setStatusFilter}
              />
              <Button onClick={handleCreatePlan}>
                <i className="fas fa-plus" style={{ marginRight: '8px' }} />
                创建计划
              </Button>
            </div>
          </div>
        </section>

        {/* Statistics Overview */}
        <section className={styles.statsSection}>
          <StatsOverview stats={statsData} loading={loading} />
        </section>

        {/* Study Plans Grid */}
        <section className={styles.plansSection}>
          {statusFilter === 'all' ? (
            <>
              <StudyPlanSection
                title="草稿"
                statusColor="gray"
                count={groupedPlans.draft.length}
                plans={groupedPlans.draft}
                onPlanClick={handlePlanClick}
                onStudyStart={handleStudyStart}
                onMenuAction={handleMenuAction}
                loading={false}
              />

              <StudyPlanSection
                title="待开始"
                statusColor="blue"
                count={groupedPlans.pending.length}
                plans={groupedPlans.pending}
                onPlanClick={handlePlanClick}
                onStudyStart={handleStudyStart}
                onMenuAction={handleMenuAction}
                loading={false}
              />

              <StudyPlanSection
                title="进行中"
                statusColor="green"
                count={groupedPlans.active.length}
                plans={groupedPlans.active}
                onPlanClick={handlePlanClick}
                onStudyStart={handleStudyStart}
                onMenuAction={handleMenuAction}
                loading={false}
              />

              <StudyPlanSection
                title="已暂停"
                statusColor="orange"
                count={groupedPlans.paused.length}
                plans={groupedPlans.paused}
                onPlanClick={handlePlanClick}
                onStudyStart={handleStudyStart}
                onMenuAction={handleMenuAction}
                loading={false}
              />

              <StudyPlanSection
                title="已完成"
                statusColor="gray"
                count={groupedPlans.completed.length}
                plans={groupedPlans.completed}
                onPlanClick={handlePlanClick}
                onStudyStart={handleStudyStart}
                onMenuAction={handleMenuAction}
                loading={false}
              />

              <StudyPlanSection
                title="已终止"
                statusColor="red"
                count={groupedPlans.terminated.length}
                plans={groupedPlans.terminated}
                onPlanClick={handlePlanClick}
                onStudyStart={handleStudyStart}
                onMenuAction={handleMenuAction}
                loading={false}
              />
            </>
          ) : (
            <StudyPlanSection
              title={getFilteredSectionTitle()}
              statusColor={getFilteredSectionColor()}
              count={filteredPlans.length}
              plans={filteredPlans}
              onPlanClick={handlePlanClick}
              onStudyStart={handleStudyStart}
              onMenuAction={handleMenuAction}
              loading={loading}
            />
          )}
        </section>
      </main>
    </div>
  );
};

export default StudyPlansPage;