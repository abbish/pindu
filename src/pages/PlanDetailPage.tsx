import React, { useState, useEffect } from 'react';
import styles from './PlanDetailPage.module.css';
import { 
  Header, 
  Breadcrumb,
  Button, 
  StatCard,
  VocabProgress,
  WordList,
  StudyCalendar,
  StudyRecordsSidebar
} from '../components';
import type { 
  VocabProgressItem, 
  StudyRecord, 
  Word
} from '../components';
import { getStatusDisplay, type StudyPlanWithProgress } from '../utils/database';

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
  const [planData, setPlanData] = useState<StudyPlanWithProgress | null>(null);
  const [vocabProgress, setVocabProgress] = useState<VocabProgressItem[]>([]);
  const [studyRecords, setStudyRecords] = useState<StudyRecord[]>([]);
  const [words, setWords] = useState<Word[]>([]);
  const [studyDates, setStudyDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPlanDetail();
  }, [planId]);

  const loadPlanDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Mock data - should be replaced with actual API calls
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Mock plan data
      const mockPlan: StudyPlanWithProgress = {
        id: planId,
        name: '我的动物世界计划',
        description: '通过学习动物相关的英语单词，让孩子认识更多可爱的动物朋友',
        status: 'active',
        total_words: 280,
        learned_words: 190,
        accuracy_rate: 85,
        progress_percentage: 68,
        mastery_level: 4,
        created_at: '2024-01-15',
        updated_at: '2024-01-27'
      };

      // Mock vocabulary progress
      const mockVocabProgress: VocabProgressItem[] = [
        {
          id: 1,
          name: '动物世界',
          totalWords: 120,
          learnedWords: 85,
          progressPercentage: 71,
          status: 'active',
          color: 'primary'
        },
        {
          id: 2,
          name: '基础生活词汇',
          totalWords: 120,
          learnedWords: 95,
          progressPercentage: 79,
          status: 'active',
          color: 'orange'
        },
        {
          id: 3,
          name: '家庭成员',
          totalWords: 40,
          learnedWords: 10,
          progressPercentage: 25,
          status: 'pending',
          color: 'yellow'
        }
      ];

      // Mock study records
      const mockRecords: StudyRecord[] = [
        {
          id: 1,
          sessionName: '第3次完整学习周期',
          description: '涵盖动物世界、基础生活词汇',
          date: '2024-01-27',
          time: '14:30',
          wordsStudied: 45,
          accuracy: 92,
          duration: 35,
          status: 'completed'
        },
        {
          id: 2,
          sessionName: '第2次完整学习周期',
          description: '主要复习动物世界词汇',
          date: '2024-01-25',
          time: '16:15',
          wordsStudied: 38,
          accuracy: 88,
          duration: 28,
          status: 'completed'
        },
        {
          id: 3,
          sessionName: '第1次完整学习周期',
          description: '初次学习，建立基础',
          date: '2024-01-23',
          time: '10:45',
          wordsStudied: 32,
          accuracy: 75,
          duration: 42,
          status: 'completed'
        }
      ];

      // Mock words data
      const mockWords: Word[] = [
        { id: 1, word: 'elephant', partOfSpeech: 'n.', meaning: '大象', phonetic: '/ˈelɪfənt/' },
        { id: 2, word: 'lion', partOfSpeech: 'n.', meaning: '狮子', phonetic: '/ˈlaɪən/' },
        { id: 3, word: 'tiger', partOfSpeech: 'n.', meaning: '老虎', phonetic: '/ˈtaɪgə/' },
        { id: 4, word: 'monkey', partOfSpeech: 'n.', meaning: '猴子', phonetic: '/ˈmʌŋki/' },
        { id: 5, word: 'rabbit', partOfSpeech: 'n.', meaning: '兔子', phonetic: '/ˈræbɪt/' },
        { id: 6, word: 'bear', partOfSpeech: 'n.', meaning: '熊', phonetic: '/beə/' }
      ];

      // Mock study dates
      const mockStudyDates = [
        '2024-01-23', '2024-01-24', '2024-01-25', 
        '2024-01-26', '2024-01-27', '2024-01-28', '2024-01-29'
      ];

      setPlanData(mockPlan);
      setVocabProgress(mockVocabProgress);
      setStudyRecords(mockRecords);
      setWords(mockWords);
      setStudyDates(mockStudyDates);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载计划详情失败');
    } finally {
      setLoading(false);
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
    // TODO: Navigate to edit plan page
    console.log('Edit plan:', planId);
  };

  const handleWordAction = (wordId: number) => {
    // TODO: 实现单词详解功能
    const word = words.find(w => w.id === wordId);
    if (word) {
      alert(`单词详解功能开发中...\n单词: ${word.word}\n含义: ${word.meaning}\n音标: ${word.phonetic}`);
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

  const statusDisplay = getStatusDisplay(planData.status);

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
                <h2 className={styles.planTitle}>{planData.name}</h2>
                <span 
                  className={`${styles.statusBadge} ${styles[planData.status]}`}
                  style={{ 
                    color: statusDisplay.color,
                    backgroundColor: statusDisplay.bgColor
                  }}
                >
                  {statusDisplay.text}
                </span>
              </div>
              <p className={styles.planDescription}>{planData.description}</p>
              <div className={styles.planMeta}>
                <div className={styles.metaItem}>
                  <i className={`fas fa-calendar ${styles.metaIcon}`} />
                  <span className={styles.metaText}>2024-01-15 至 2024-02-15</span>
                </div>
                <div className={styles.metaItem}>
                  <i className={`fas fa-clock ${styles.metaIcon}`} />
                  <span className={styles.metaText}>已学习 12 天</span>
                </div>
              </div>
            </div>
            <div className={styles.headerActions}>
              <button 
                className={`${styles.actionBtn} ${styles.primaryBtn}`}
                onClick={handleContinueStudy}
              >
                <i className="fas fa-play" />
                <span>继续学习</span>
              </button>
              <button 
                className={`${styles.actionBtn} ${styles.secondaryBtn}`}
                onClick={handleEditPlan}
              >
                <i className="fas fa-edit" />
                <span>编辑计划</span>
              </button>
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
            value={12}
            unit="天"
          />
          <StatCard
            icon="star"
            iconColor="yellow"
            label="平均正确率"
            value={`${planData.accuracy_rate}%`}
            unit="正确率"
          />
        </section>

        {/* Main Content */}
        <div className={styles.contentLayout}>
          {/* Left Column */}
          <div className={styles.leftColumn}>
            <VocabProgress progressData={vocabProgress} />
            <WordList 
              words={words} 
              onWordAction={handleWordAction}
              itemsPerPage={10}
            />
          </div>

          {/* Right Column */}
          <div className={styles.rightColumn}>
            <StudyCalendar 
              studyDates={studyDates}
              streakDays={7}
            />
            <StudyRecordsSidebar records={studyRecords.slice(0, 3)} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default PlanDetailPage;