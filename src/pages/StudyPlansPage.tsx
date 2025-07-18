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

  // Filter options
  const filterOptions: FilterOption[] = [
    { value: 'all', label: '全部状态' },
    { value: 'active', label: '进行中' },
    { value: 'completed', label: '已完成' },
    { value: 'paused', label: '已暂停' }
  ];

  // Filter plans by status
  const filteredPlans = useMemo(() => {
    if (!studyPlans || !Array.isArray(studyPlans) || statusFilter === 'all') return studyPlans || [];
    return studyPlans.filter(plan => plan.status === statusFilter);
  }, [studyPlans, statusFilter]);

  // Group plans by status
  const groupedPlans = useMemo(() => {
    if (!studyPlans || !Array.isArray(studyPlans)) {
      return { active: [], paused: [], completed: [] };
    }

    const groups = {
      active: studyPlans.filter(plan => plan.status === 'active'),
      paused: studyPlans.filter(plan => plan.status === 'paused'),
      completed: studyPlans.filter(plan => plan.status === 'completed')
    };

    // If filtering, only show the filtered group
    if (statusFilter !== 'all') {
      return {
        active: statusFilter === 'active' ? groups.active : [],
        paused: statusFilter === 'paused' ? groups.paused : [],
        completed: statusFilter === 'completed' ? groups.completed : []
      };
    }

    return groups;
  }, [studyPlans, statusFilter]);

  // Generate statistics
  const statsData: StatsCard[] = useMemo(() => {
    const totalPlans = studyPlans?.length || 0;
    const activePlans = groupedPlans.active.length;
    const completedPlans = groupedPlans.completed.length;
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
        id: 'time',
        title: '分钟学习',
        value: totalStudyTime,
        icon: 'clock',
        color: 'blue',
        change: '今日',
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
                options={filterOptions}
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
                statusColor="yellow"
                count={groupedPlans.paused.length}
                plans={groupedPlans.paused}
                onPlanClick={handlePlanClick}
                onStudyStart={handleStudyStart}
                onMenuAction={handleMenuAction}
                loading={false}
              />
              
              <StudyPlanSection
                title="已完成"
                statusColor="blue"
                count={groupedPlans.completed.length}
                plans={groupedPlans.completed}
                onPlanClick={handlePlanClick}
                onStudyStart={handleStudyStart}
                onMenuAction={handleMenuAction}
                loading={false}
              />
            </>
          ) : (
            <StudyPlanSection
              title={filterOptions.find(opt => opt.value === statusFilter)?.label || '学习计划'}
              statusColor={
                statusFilter === 'active' ? 'green' :
                statusFilter === 'paused' ? 'yellow' : 'blue'
              }
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