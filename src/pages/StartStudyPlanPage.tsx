import React, { useState, useEffect } from 'react';
import { 
  Header,
  Breadcrumb,
  StudyProgress,
  WordCard,
  WordDetail,
  type WordData,
  type ExampleSentence
} from '../components';
import styles from './StartStudyPlanPage.module.css';

export interface StartStudyPlanPageProps {
  /** 学习计划ID */
  planId?: number;
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * 学习计划学习页面
 */
export const StartStudyPlanPage: React.FC<StartStudyPlanPageProps> = ({ 
  planId,
  onNavigate 
}) => {
  // Mock study plan data
  const [studyPlan] = useState({
    id: planId || 1,
    title: '基础词汇 Level 1',
    description: '日常生活常用单词',
    totalWords: 20,
    words: [
      {
        id: '1',
        word: 'Apple',
        meaning: '苹果',
        description: '一种红色或绿色的水果',
        phonetic: '/ˈæpl/',
        ipa: '/ˈæpl/',
        syllables: 'Ap-ple',
        imageUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/0c2b2c8493-a1e002e16be96a57a1d1.png',
        phonicsSegments: ['Ap', 'ple']
      },
      {
        id: '2',
        word: 'Cat',
        meaning: '猫',
        description: '一种小型哺乳动物宠物',
        phonetic: '/kæt/',
        ipa: '/kæt/',
        syllables: 'Cat',
        phonicsSegments: ['C', 'at']
      },
      {
        id: '3',
        word: 'AI',
        meaning: '人工智能',
        description: '人工智能技术',
        phonetic: '/ˌeɪˈaɪ/',
        ipa: '/ˌeɪˈaɪ/',
        syllables: 'A-I',
        phonicsSegments: ['A', 'I']
      },
      // ... more words would be loaded from API
    ] as WordData[]
  });

  // Study session state
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showWordDetailModal, setShowWordDetailModal] = useState(false);
  const [spellingResult, setSpellingResult] = useState<{
    show: boolean;
    isCorrect: boolean;
  }>({ show: false, isCorrect: false });
  const [studyTime, setStudyTime] = useState(0); // in seconds
  const [userInput, setUserInput] = useState('');

  const currentWord = studyPlan.words[currentWordIndex];
  const isLastWord = currentWordIndex === studyPlan.words.length - 1;

  // Timer effect
  useEffect(() => {
    if (!isPaused) {
      const timer = setInterval(() => {
        setStudyTime(prev => prev + 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isPaused]);

  // Format time for display
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };


  const handleNavChange = (page: string) => {
    onNavigate?.(page);
  };

  const handleBreadcrumbClick = (key: string) => {
    onNavigate?.(key);
  };

  const handlePause = () => {
    setIsPaused(!isPaused);
  };

  const handleSettings = () => {
    // TODO: Show settings modal
    console.log('Settings clicked');
  };

  const handlePlayPronunciation = (word: WordData) => {
    console.log('Playing pronunciation for:', word.word);
    // TODO: Implement text-to-speech
  };

  const handleShowWordDetails = (_word: WordData) => {
    setShowWordDetailModal(true);
  };

  const handlePlayExample = (example: ExampleSentence) => {
    console.log('Playing example:', example.english);
    // TODO: Implement text-to-speech for example
  };

  const handleInputChange = (value: string) => {
    setUserInput(value);
  };

  const handleCheckSpelling = (_word: WordData, _userInput: string, isCorrect: boolean) => {
    setTotalAttempts(prev => prev + 1);
    
    if (isCorrect) {
      setCorrectAnswers(prev => prev + 1);
      setSpellingResult({ show: true, isCorrect });
      // Auto advance to next word after 1.5 seconds
      setTimeout(() => {
        handleNextWord();
      }, 1500);
    } else {
      setSpellingResult({ show: true, isCorrect });
      // Clear result after 2 seconds to allow retry
      setTimeout(() => {
        setSpellingResult({ show: false, isCorrect: false });
        setUserInput(''); // Clear input for retry
      }, 2000);
    }
  };

  const handleNextWord = () => {
    if (isLastWord) {
      // All words completed, navigate to completion page
      const studyResults = {
        planId: studyPlan.id,
        planTitle: studyPlan.title,
        totalWords: studyPlan.totalWords,
        correctAnswers,
        totalAttempts,
        accuracy: Math.round((correctAnswers / Math.max(totalAttempts, 1)) * 100),
        studyTime: Math.round(studyTime / 60) // Convert seconds to minutes
      };
      
      onNavigate?.('finish-study-plan', studyResults);
    } else {
      setCurrentWordIndex(prev => prev + 1);
      setSpellingResult({ show: false, isCorrect: false });
      setUserInput(''); // Clear input for next word
    }
  };

  const completedWords = currentWordIndex + (spellingResult.show && spellingResult.isCorrect ? 1 : 0);

  return (
    <div className={styles.page}>
      {/* Global Header */}
      <Header 
        activeNav="plans"
        onNavChange={handleNavChange}
      />

      {/* Main Content */}
      <main className={styles.main}>
        {/* Breadcrumb */}
        <div className={styles.breadcrumbSection}>
          <Breadcrumb
            items={[
              { label: '首页', key: 'home', icon: 'home' },
              { label: '学习计划', key: 'plans', icon: 'tasks' }
            ]}
            current={`${studyPlan.title} - 学习中`}
            onNavigate={handleBreadcrumbClick}
          />
        </div>

        {/* Study Header */}
        <div className={styles.studyHeaderSection}>
          <div className={styles.studyHeaderContent}>
            <div className={styles.planInfo}>
              <div className={styles.planIcon}>
                <i className="fas fa-book" />
              </div>
              <div className={styles.planDetails}>
                <h1 className={styles.planTitle}>{studyPlan.title}</h1>
                <p className={styles.planDescription}>{studyPlan.description}</p>
              </div>
            </div>
            <div className={styles.studyControls}>
              <div className={styles.progressItem}>
                <span className={styles.progressLabel}>进度</span>
                <span className={styles.progressValue}>{completedWords}/{studyPlan.totalWords}</span>
              </div>
              <div className={styles.progressItem}>
                <span className={styles.progressLabel}>正确率</span>
                <span className={styles.progressValue}>{Math.round((correctAnswers / Math.max(totalAttempts, 1)) * 100)}%</span>
              </div>
              <div className={styles.progressBarContainer}>
                <StudyProgress
                  current={completedWords}
                  total={studyPlan.totalWords}
                  color="primary"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Content Layout */}
        <div className={styles.contentLayout}>
        {/* Left Panel - Learning Content */}
        <div className={styles.leftPanel}>
          {currentWord && (
            <div className={styles.wordSection}>
              {/* Word Card with integrated spelling */}
              <div className={styles.wordCardContainer}>
                <WordCard
                  word={currentWord}
                  onPlayPronunciation={handlePlayPronunciation}
                  onCheckSpelling={handleCheckSpelling}
                  onShowDetails={handleShowWordDetails}
                  showResult={spellingResult.show}
                  isCorrect={spellingResult.isCorrect}
                  userInput={userInput}
                  onInputChange={handleInputChange}
                  disabled={isPaused}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Study Information */}
        <div className={styles.rightPanel}>

          {/* Timer Card */}
          <div className={styles.timerSection}>
            <div className={styles.timerDisplay}>{formatTime(studyTime)}</div>
            <div className={styles.timerLabel}>学习时间</div>
            <div className={styles.studyControls}>
              <button 
                className={styles.studyControlBtn}
                onClick={handlePause}
                title={isPaused ? "继续" : "暂停"}
              >
                <i className={`fas fa-${isPaused ? 'play' : 'pause'}`} />
              </button>
              <button 
                className={styles.studyControlBtn}
                onClick={handleSettings}
                title="设置"
              >
                <i className="fas fa-cog" />
              </button>
            </div>
          </div>
        </div>
        </div>
      </main>

      {/* Word Detail Modal */}
      {showWordDetailModal && (
        <div className={styles.modalOverlay} onClick={() => setShowWordDetailModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>单词详解</h3>
              <button 
                className={styles.modalCloseBtn}
                onClick={() => setShowWordDetailModal(false)}
              >
                <i className="fas fa-times" />
              </button>
            </div>
            <div className={styles.modalBody}>
              <WordDetail
                word={currentWord}
                onPlayExample={handlePlayExample}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StartStudyPlanPage;