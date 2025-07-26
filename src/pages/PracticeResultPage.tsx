import React from 'react';
import {
  Header,
  Breadcrumb
} from '../components';
import { type PracticeResult } from '../types/study';
import styles from './PracticeResultPage.module.css';

export interface PracticeResultPageProps {
  /** 练习结果数据 */
  result?: PracticeResult;
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * 单词练习结果页面
 */
export const PracticeResultPage: React.FC<PracticeResultPageProps> = ({
  result,
  onNavigate
}) => {
  // 调试信息
  console.log('PracticeResultPage received result:', result);
  console.log('passedWordsList:', result?.passedWordsList);
  console.log('difficultWords:', result?.difficultWords);
  console.log('passedWordsList length:', result?.passedWordsList?.length);
  console.log('difficultWords length:', result?.difficultWords?.length);

  // 后端现在返回 camelCase 格式，直接使用
  const practiceResult: PracticeResult = result || {
    // 默认数据（用于开发测试）
    sessionId: 'unknown',
    planId: 0,
    scheduleId: 0,
    scheduleDate: '',
    totalWords: 0,
    passedWords: 0,
    totalSteps: 0,
    correctSteps: 0,
    stepAccuracy: 0,
    wordAccuracy: 0,
    totalTime: 0,
    activeTime: 0,
    pauseCount: 0,
    averageTimePerWord: 0,
    difficultWords: [],
    passedWordsList: [],
    completedAt: new Date().toISOString()
  };

  // 转换为StudyStatistics格式
  // const statisticsData: StudyStatisticsData = {
  //   totalWords: practiceResult.totalWords,
  //   passedWords: practiceResult.passedWords,
  //   accuracy: practiceResult.wordAccuracy,
  //   studyTime: Math.round(practiceResult.activeTime / 60000), // 转换为分钟
  //   averageTimePerWord: Math.round(practiceResult.averageTimePerWord / 1000), // 转换为秒
  //   stepAccuracy: practiceResult.stepAccuracy,
  //   pauseCount: practiceResult.pauseCount,
  //   difficultWordsCount: practiceResult.difficultWords.length
  // };

  // 格式化时间显示
  const formatTime = (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}分${seconds}秒`;
  };

  // 获取成绩等级
  const getGradeLevel = (accuracy: number) => {
    if (accuracy >= 95) return { level: 'A+', color: '#10B981', description: '优秀' };
    if (accuracy >= 90) return { level: 'A', color: '#059669', description: '良好' };
    if (accuracy >= 80) return { level: 'B', color: '#D97706', description: '中等' };
    if (accuracy >= 70) return { level: 'C', color: '#DC2626', description: '及格' };
    return { level: 'D', color: '#991B1B', description: '需要加强' };
  };

  const grade = getGradeLevel(practiceResult.wordAccuracy);

  // 面包屑导航
  const handleBreadcrumbClick = (key: string) => {
    if (key === 'home') {
      onNavigate?.('home');
    } else if (key === 'plans') {
      onNavigate?.('plans');
    }
  };

  // 处理操作按钮
  const handleContinueStudy = () => {
    // 继续下一个练习或返回计划详情
    onNavigate?.('plan-detail', { planId: practiceResult.planId });
  };



  const handleBackToHome = () => {
    onNavigate?.('home');
  };

  return (
    <div className={styles.page}>
      {/* Header */}
      <Header />

      <main className={styles.main}>
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: '首页', key: 'home', icon: 'home' },
            { label: '学习计划', key: 'plans', icon: 'tasks' }
          ]}
          current="练习结果"
          onNavigate={handleBreadcrumbClick}
        />

        {/* 祝贺横幅 */}
        <section className={styles.bannerSection}>
          <div className={styles.resultBanner}>
            <div className={styles.gradeDisplay}>
              <div 
                className={styles.gradeBadge}
                style={{ backgroundColor: grade.color }}
              >
                {grade.level}
              </div>
              <div className={styles.gradeInfo}>
                <h2 className={styles.gradeTitle}>练习完成！</h2>
                <p className={styles.gradeDescription}>{grade.description}</p>
              </div>
            </div>
            
            <div className={styles.quickStats}>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{practiceResult.passedWords}</span>
                <span className={styles.statLabel}>通过单词</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{practiceResult.wordAccuracy.toFixed(1)}%</span>
                <span className={styles.statLabel}>正确率</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{formatTime(practiceResult.activeTime)}</span>
                <span className={styles.statLabel}>练习时间</span>
              </div>
            </div>
          </div>
        </section>

        {/* 详细统计 */}
        <section className={styles.statisticsSection}>
          <h3 className={styles.sectionTitle}>详细统计</h3>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-book" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statNumber}>{practiceResult.totalWords}</div>
                <div className={styles.statText}>总单词数</div>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-check-circle" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statNumber}>{practiceResult.passedWords}</div>
                <div className={styles.statText}>完全掌握</div>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-target" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statNumber}>{practiceResult.stepAccuracy.toFixed(1)}%</div>
                <div className={styles.statText}>步骤正确率</div>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-clock" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statNumber}>{Math.round(practiceResult.averageTimePerWord / 1000)}s</div>
                <div className={styles.statText}>平均用时</div>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-pause" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statNumber}>{practiceResult.pauseCount}</div>
                <div className={styles.statText}>暂停次数</div>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-exclamation-triangle" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statNumber}>{practiceResult.difficultWords.length}</div>
                <div className={styles.statText}>需要复习</div>
              </div>
            </div>
          </div>
        </section>

        {/* 单词列表 */}
        <section className={styles.wordsSection}>
          <h3 className={styles.sectionTitle}>练习详情</h3>

          {/* 完全掌握的单词 */}
          {practiceResult.passedWordsList && practiceResult.passedWordsList.length > 0 && (
            <div className={styles.wordListContainer}>
              <h4 className={styles.wordListTitle}>
                <i className="fas fa-check-circle" style={{ color: 'var(--color-success)' }} />
                完全掌握 ({practiceResult.passedWordsList.length} 个)
              </h4>
              <div className={styles.wordGrid}>
                {practiceResult.passedWordsList
                  .filter(wordState => wordState && wordState.wordInfo && wordState.wordInfo.word)
                  .map((wordState) => (
                  <div key={wordState.wordId || Math.random()} className={styles.wordCard}>
                    <div className={styles.wordHeader}>
                      <span className={styles.wordText}>{wordState.wordInfo.word}</span>
                      <div className={styles.wordBadge}>
                        <i className="fas fa-check" />
                      </div>
                    </div>
                    <div className={styles.wordMeaning}>{wordState.wordInfo.meaning || '暂无释义'}</div>
                    {wordState.wordInfo.ipa && (
                      <div className={styles.wordIpa}>{wordState.wordInfo.ipa}</div>
                    )}
                    <div className={styles.stepResults}>
                      {(wordState.stepResults || []).map((result, index) => (
                        <span
                          key={index}
                          className={`${styles.stepBadge} ${result ? styles.correct : styles.incorrect}`}
                        >
                          步骤{index + 1}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 需要复习的单词 */}
          {practiceResult.difficultWords && practiceResult.difficultWords.length > 0 && (
            <div className={styles.wordListContainer}>
              <h4 className={styles.wordListTitle}>
                <i className="fas fa-exclamation-triangle" style={{ color: 'var(--color-warning)' }} />
                需要复习 ({practiceResult.difficultWords.length} 个)
              </h4>
              <div className={styles.wordGrid}>
                {practiceResult.difficultWords
                  .filter(wordState => wordState && wordState.wordInfo && wordState.wordInfo.word)
                  .map((wordState) => (
                  <div key={wordState.wordId || Math.random()} className={styles.wordCard}>
                    <div className={styles.wordHeader}>
                      <span className={styles.wordText}>{wordState.wordInfo.word}</span>
                      <div className={styles.wordBadge}>
                        <i className="fas fa-times" />
                      </div>
                    </div>
                    <div className={styles.wordMeaning}>{wordState.wordInfo.meaning || '暂无释义'}</div>
                    {wordState.wordInfo.ipa && (
                      <div className={styles.wordIpa}>{wordState.wordInfo.ipa}</div>
                    )}
                    <div className={styles.stepResults}>
                      {(wordState.stepResults || []).map((result, index) => (
                        <span
                          key={index}
                          className={`${styles.stepBadge} ${result ? styles.correct : styles.incorrect}`}
                        >
                          步骤{index + 1}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 操作按钮 */}
        <section className={styles.actionsSection}>
          <div className={styles.actionButtons}>
            <button 
              className={styles.primaryBtn}
              onClick={handleContinueStudy}
            >
              <i className="fas fa-arrow-right" />
              继续学习
            </button>

            <button
              className={styles.outlineBtn}
              onClick={handleBackToHome}
            >
              <i className="fas fa-home" />
              返回首页
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};

export default PracticeResultPage;
