import React from 'react';
import { 
  Header,
  Breadcrumb,
  CongratulationsBanner,
  StudyStatistics,
  ActionButtons,
  type StudyStatisticsData,
  type DifficultWord,
  type WordData
} from '../components';
import styles from './FinishStudyPlanPage.module.css';

export interface StudyResults {
  /** 学习计划ID */
  planId: number;
  /** 学习计划标题 */
  planTitle: string;
  /** 总单词数 */
  totalWords: number;
  /** 正确答案数 */
  correctAnswers: number;
  /** 总尝试次数 */
  totalAttempts: number;
  /** 准确率 */
  accuracy: number;
  /** 学习时长(分钟) */
  studyTime: number;
  /** 需要加强的单词 */
  difficultWords?: DifficultWord[];
  /** 已掌握的单词 */
  masteredWords?: WordData[];
}

export interface FinishStudyPlanPageProps {
  /** 学习结果数据 */
  results?: StudyResults;
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * 学习计划完成页面
 */
export const FinishStudyPlanPage: React.FC<FinishStudyPlanPageProps> = ({ 
  results,
  onNavigate 
}) => {
  // Mock data if no results provided
  const studyResults: StudyResults = results || {
    planId: 1,
    planTitle: '基础词汇 Level 1',
    totalWords: 20,
    correctAnswers: 18,
    totalAttempts: 22,
    accuracy: 90,
    studyTime: 12,
    difficultWords: [
      {
        id: '1',
        word: 'Elephant',
        meaning: '大象',
        phonetic: '/ˈɛlɪfənt/',
        imageUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/0c2b2c8493-a1e002e16be96a57a1d1.png',
        attempts: 2,
        totalAttempts: 3,
        errorType: '拼写错误'
      },
      {
        id: '2',
        word: 'Butterfly',
        meaning: '蝴蝶',
        phonetic: '/ˈbʌtərflaɪ/',
        imageUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/0c2b2c8493-a1e002e16be96a57a1d1.png',
        attempts: 1,
        totalAttempts: 3,
        errorType: '发音错误'
      }
    ],
    masteredWords: [
      { id: '3', word: 'Apple', meaning: '苹果', phonetic: '/ˈæpl/' },
      { id: '4', word: 'Cat', meaning: '猫', phonetic: '/kæt/' },
      { id: '5', word: 'Dog', meaning: '狗', phonetic: '/dɔɡ/' },
      { id: '6', word: 'Book', meaning: '书', phonetic: '/bʊk/' },
      { id: '7', word: 'Tree', meaning: '树', phonetic: '/tri/' },
      { id: '8', word: 'Car', meaning: '汽车', phonetic: '/kɑr/' },
      { id: '9', word: 'House', meaning: '房子', phonetic: '/haʊs/' },
      { id: '10', word: 'Fish', meaning: '鱼', phonetic: '/fɪʃ/' },
      { id: '11', word: 'Bird', meaning: '鸟', phonetic: '/bɜrd/' },
      { id: '12', word: 'Sun', meaning: '太阳', phonetic: '/sʌn/' },
      { id: '13', word: 'Moon', meaning: '月亮', phonetic: '/mun/' },
      { id: '14', word: 'Star', meaning: '星星', phonetic: '/stɑr/' },
      { id: '15', word: 'Water', meaning: '水', phonetic: '/ˈwɔtər/' },
      { id: '16', word: 'Fire', meaning: '火', phonetic: '/ˈfaɪər/' },
      { id: '17', word: 'Earth', meaning: '地球', phonetic: '/ɜrθ/' },
      { id: '18', word: 'Wind', meaning: '风', phonetic: '/wɪnd/' },
      { id: '19', word: 'Rain', meaning: '雨', phonetic: '/reɪn/' },
      { id: '20', word: 'Snow', meaning: '雪', phonetic: '/snoʊ/' }
    ]
  };

  const statistics: StudyStatisticsData = {
    totalWords: studyResults.totalWords,
    correctAnswers: studyResults.correctAnswers,
    accuracy: studyResults.accuracy,
    studyTime: studyResults.studyTime
  };

  const handleNavChange = (page: string) => {
    onNavigate?.(page);
  };

  const handleBreadcrumbClick = (key: string) => {
    onNavigate?.(key);
  };


  const handleNextPlan = () => {
    onNavigate?.('plans');
  };

  const handleRetry = () => {
    onNavigate?.('start-study-plan', { planId: studyResults.planId });
  };

  const handleDetailedReport = () => {
    onNavigate?.('report', { planId: studyResults.planId, results: studyResults });
  };

  return (
    <div className={styles.page}>
      {/* Global Header */}
      <Header 
        activeNav="plans"
        onNavChange={handleNavChange}
      />

      <main className={styles.main}>
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: '首页', key: 'home', icon: 'home' },
            { label: '学习计划', key: 'plans', icon: 'tasks' }
          ]}
          current={`${studyResults.planTitle} - 学习完成`}
          onNavigate={handleBreadcrumbClick}
        />

        {/* Congratulations Banner */}
        <section className={styles.bannerSection}>
          <CongratulationsBanner 
            planTitle={studyResults.planTitle}
            completedWords={studyResults.totalWords}
          />
        </section>

        {/* Content Layout */}
        <div className={styles.contentLayout}>
          {/* Left Column - Statistics & Analysis */}
          <div className={styles.leftColumn}>
            {/* Statistics Overview */}
            <section className={styles.statisticsSection}>
              <StudyStatistics statistics={statistics} />
            </section>
          </div>

          {/* Right Column - Actions */}
          <div className={styles.rightColumn}>
            <section className={styles.actionsSection}>
              <ActionButtons
                onNextPlan={handleNextPlan}
                onRetry={handleRetry}
                onDetailedReport={handleDetailedReport}
              />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};

export default FinishStudyPlanPage;