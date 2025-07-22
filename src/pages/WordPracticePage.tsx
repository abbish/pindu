import React, { useState, useEffect, useRef } from 'react';
import {
  Header,

  PracticeWordCard,
  type PracticeWordData,
  useToast
} from '../components';
import {
  WordPracticeStep,
  type PracticeSession
} from '../types/study';
import { practiceService } from '../services/practiceService';
import styles from './WordPracticePage.module.css';

export interface WordPracticePageProps {
  /** 学习计划ID */
  planId?: number;
  /** 日程ID */
  scheduleId?: number;
  /** 会话ID - 用于恢复未完成的练习 */
  sessionId?: string;
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * 单词练习页面 - 三步骤渐进式练习
 */
export const WordPracticePage: React.FC<WordPracticePageProps> = ({
  planId,
  scheduleId,
  sessionId,
  onNavigate
}) => {
  const toast = useToast();

  // 练习状态
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentStep, setCurrentStep] = useState<WordPracticeStep>(WordPracticeStep.STEP_1);
  const [userInput, setUserInput] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 步骤计时状态
  const [stepStartTime, setStepStartTime] = useState<number>(0);
  const [currentAttempts, setCurrentAttempts] = useState(1);

  // 防止重复初始化
  const initializeRef = useRef(false);

  // 计时器状态
  const [startTime, setStartTime] = useState<number>(0);
  const [totalTime, setTotalTime] = useState(0);
  const [activeTime, setActiveTime] = useState(0);
  const [, setPauseStartTime] = useState<number>(0);

  // 从session中获取单词数据
  console.log('Session数据检查:', session);
  console.log('Session.wordStates:', session?.wordStates);
  console.log('Session.word_states:', (session as any)?.word_states);

  const words = session?.wordStates || (session as any)?.word_states || [];
  console.log('Words数组:', words, '长度:', words.length);

  const currentWordState = words[currentWordIndex];
  console.log('CurrentWordState:', currentWordState);
  console.log('CurrentWordState.wordInfo:', currentWordState?.wordInfo);
  console.log('CurrentWordState.word_info:', (currentWordState as any)?.word_info);

  const totalWords = words.length;
  const isLastWord = currentWordIndex === totalWords - 1;
  const isLastStep = currentStep === WordPracticeStep.STEP_3;

  // 步骤配置
  const stepConfigs = {
    [WordPracticeStep.STEP_1]: {
      title: "第一步：看单词拼写",
      description: "观察单词的完整信息（包含音节），然后输入拼写"
    },
    [WordPracticeStep.STEP_2]: {
      title: "第二步：根据提示拼写",
      description: "根据音标、中文、音节和拼读提示输入单词"
    },
    [WordPracticeStep.STEP_3]: {
      title: "第三步：听音拼写",
      description: "根据发音、中文、音节和拼读提示输入单词"
    }
  };

  // 计时器效果
  useEffect(() => {
    if (!isPaused && startTime > 0) {
      const timer = setInterval(() => {
        const now = Date.now();
        setTotalTime(now - startTime);
        setActiveTime(prev => prev + 1000);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isPaused, startTime]);

  // 初始化练习
  useEffect(() => {
    // 防止重复初始化
    if (initializeRef.current) return;
    initializeRef.current = true;

    const initializePractice = async () => {
      console.log('=== WordPracticePage 初始化开始 ===');
      console.log('参数检查:', { planId, scheduleId, sessionId });

      // 检查参数：如果有sessionId则用于恢复会话，否则需要planId和scheduleId创建新会话
      if (!sessionId && (!planId || !scheduleId)) {
        console.error('参数验证失败:', { planId, scheduleId, sessionId });
        setError('缺少必要的参数');
        setLoading(false);
        return;
      }

      console.log('参数验证通过，开始初始化练习');

      try {
        setLoading(true);

        let result;

        if (sessionId) {
          // 恢复现有会话
          console.log('恢复现有会话，sessionId:', sessionId);
          result = await practiceService.getPracticeSessionDetail(sessionId);
          console.log('恢复会话结果:', result);
          if (result.success) {
            console.log('恢复会话成功，会话数据:', result.data);
            toast.showSuccess('恢复练习', '已恢复之前的练习进度');
          } else {
            console.error('恢复会话失败:', result.error);
          }
        } else {
          // 创建新的练习会话
          console.log('创建新会话，参数:', { planId, scheduleId });
          result = await practiceService.startPracticeSession({
            planId: planId!,
            scheduleId: scheduleId!
          });
          console.log('创建会话结果:', result);
          if (result.success) {
            console.log('创建会话成功，会话数据:', result.data);
            toast.showSuccess('开始练习', '练习会话已创建');
          } else {
            console.error('创建会话失败:', result.error);
          }
        }

        if (result.success) {
          console.log('设置会话数据:', result.data);
          setSession(result.data);
          setStartTime(Date.now());
          setStepStartTime(Date.now()); // 记录第一个步骤的开始时间
          console.log('练习初始化成功');
        } else {
          console.error('练习初始化失败:', result.error);
          setError(result.error || (sessionId ? '恢复练习会话失败' : '创建练习会话失败'));
          toast.showError(sessionId ? '恢复失败' : '创建失败', result.error || (sessionId ? '恢复练习会话失败' : '创建练习会话失败'));
        }
      } catch (error) {
        console.error('初始化练习失败:', error);
        setError('初始化练习时发生错误');
        toast.showError('初始化失败', '初始化练习时发生错误');
      } finally {
        setLoading(false);
      }
    };

    initializePractice();
  }, [planId, scheduleId, sessionId]);

  // 格式化时间显示
  const formatTime = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // 处理输入变化
  const handleInputChange = (value: string) => {
    setUserInput(value);
  };

  // 处理答案提交
  const handleSubmitAnswer = async (userAnswer: string) => {
    if (!currentWord || !currentWordState || !session) return;

    const correct = userAnswer.toLowerCase() === currentWord.word.toLowerCase();
    setIsCorrect(correct);
    setShowResult(true);

    // 计算步骤用时
    const now = Date.now();
    const timeSpent = stepStartTime > 0 ? now - stepStartTime : 0;

    try {
      // 调用API提交步骤结果
      const result = await practiceService.submitStepResult({
        sessionId: (session as any).session_id || session.sessionId,
        wordId: (currentWordState as any).word_id || currentWordState.wordId,
        planWordId: (currentWordState as any).plan_word_id || currentWordState.planWordId,
        step: currentStep,
        userInput: userAnswer,
        isCorrect: correct,
        timeSpent: timeSpent,
        attempts: currentAttempts
      });

      if (!result.success) {
        console.error('提交步骤结果失败:', result.error);
        toast.showError('提交失败', result.error || '提交步骤结果失败');
      }
    } catch (error) {
      console.error('提交步骤结果失败:', error);
      toast.showError('提交失败', '提交步骤结果时发生错误');
    }

    // 自动进入下一步或下一个单词
    setTimeout(() => {
      if (correct) {
        handleNextStep();
      } else {
        // 错误时增加尝试次数，重置输入，允许重试
        setCurrentAttempts(prev => prev + 1);
        setShowResult(false);
        setUserInput('');
      }
    }, correct ? 1500 : 2000);
  };

  // 处理下一步
  const handleNextStep = () => {
    console.log('=== handleNextStep 被调用 ===');
    console.log('当前状态:', {
      currentWordIndex,
      totalWords,
      currentStep,
      isLastWord,
      isLastStep
    });

    if (isLastStep) {
      // 当前单词的三个步骤完成，进入下一个单词
      if (isLastWord) {
        // 所有单词完成，结束练习
        console.log('所有单词完成，调用 handleCompletePractice');
        handleCompletePractice();
      } else {
        // 进入下一个单词
        console.log('进入下一个单词');
        setCurrentWordIndex(prev => prev + 1);
        setCurrentStep(WordPracticeStep.STEP_1);
        setUserInput('');
        setShowResult(false);
        // 重置步骤计时和尝试次数
        setStepStartTime(Date.now());
        setCurrentAttempts(1);
      }
    } else {
      // 进入下一步
      setCurrentStep(prev => prev + 1);
      setUserInput('');
      setShowResult(false);
      // 重置步骤计时和尝试次数
      setStepStartTime(Date.now());
      setCurrentAttempts(1);
    }
  };

  // 处理暂停/恢复
  const handlePauseResume = async () => {
    if (!session) return;

    try {
      if (isPaused) {
        // 恢复练习
        const result = await practiceService.resumePracticeSession({
          sessionId: (session as any).session_id || session.sessionId
        });

        if (result.success) {
          setIsPaused(false);
          toast.showSuccess('已恢复', '练习已恢复');
        } else {
          toast.showError('恢复失败', result.error || '恢复练习失败');
        }
      } else {
        // 暂停练习
        const result = await practiceService.pausePracticeSession({
          sessionId: (session as any).session_id || session.sessionId
        });

        if (result.success) {
          setIsPaused(true);
          setPauseStartTime(Date.now());
          toast.showSuccess('已暂停', '练习已暂停');
        } else {
          toast.showError('暂停失败', result.error || '暂停练习失败');
        }
      }
    } catch (error) {
      console.error('暂停/恢复练习失败:', error);
      toast.showError('操作失败', '暂停/恢复练习时发生错误');
    }
  };

  // 处理发音播放
  const handlePlayPronunciation = () => {
    // TODO: 实现发音播放
    console.log('播放发音:', currentWord?.word);
  };

  // 处理练习完成
  const handleCompletePractice = async () => {
    if (!session) return;

    try {
      // 调用API完成练习会话
      const result = await practiceService.completePracticeSession({
        sessionId: (session as any).session_id || session.sessionId,
        totalTime,
        activeTime
      });

      if (result.success) {
        toast.showSuccess('练习完成', '恭喜完成练习！');
        onNavigate?.('practice-result', result.data);
      } else {
        toast.showError('完成失败', result.error || '完成练习会话失败');
      }
    } catch (error) {
      console.error('完成练习失败:', error);
      toast.showError('完成失败', '完成练习时发生错误');
    }
  };

  // 处理退出练习
  const handleExit = () => {
    if (window.confirm('确定要退出练习吗？当前进度将会保存。')) {
      onNavigate?.('plan-detail', { planId });
    }
  };



  // 加载状态
  if (loading) {
    return (
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <div className={styles.loadingState}>
            <i className="fas fa-spinner fa-spin" />
            <p>正在初始化练习...</p>
          </div>
        </main>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <div className={styles.errorState}>
            <i className="fas fa-exclamation-triangle" />
            <h3>练习初始化失败</h3>
            <p>{error}</p>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => window.location.reload()}
            >
              重试
            </button>
          </div>
        </main>
      </div>
    );
  }

  // 从session中获取当前单词数据
  const currentWord: PracticeWordData | null = currentWordState ? (() => {
    // 支持两种字段命名：camelCase 和 snake_case
    const wordInfo = currentWordState.wordInfo || (currentWordState as any).word_info;
    if (!wordInfo) return null;

    return {
      id: wordInfo.wordId || wordInfo.word_id,
      word: wordInfo.word,
      meaning: wordInfo.meaning,
      description: wordInfo.description,
      ipa: wordInfo.ipa,
      syllables: wordInfo.syllables,
      phonicsSegments: (wordInfo.phonicsSegments || wordInfo.phonics_segments) ?
        (wordInfo.phonicsSegments || wordInfo.phonics_segments).split(',').map((s: string) => s.trim()) :
        undefined
    };
  })() : null;

  // 没有单词数据
  if (!session || words.length === 0 || !currentWord) {
    return (
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <div className={styles.emptyState}>
            <i className="fas fa-book-open" />
            <h3>没有找到练习内容</h3>
            <p>该日程没有安排单词练习</p>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => onNavigate?.('home')}
            >
              返回首页
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <Header />

      <main className={styles.main}>
        {/* 练习状态栏 */}
        <div className={styles.statusBar}>
          <div className={styles.progressInfo}>
            <span className={styles.wordProgress}>
              单词 {currentWordIndex + 1}/{totalWords}
            </span>
          </div>
          
          <div className={styles.timeInfo}>
            <span className={styles.timer}>
              <i className="fas fa-clock" />
              {formatTime(totalTime)}
            </span>
          </div>

          <div className={styles.controls}>
            <button
              type="button"
              className={styles.controlBtn}
              onClick={handlePauseResume}
              title={isPaused ? "继续练习" : "暂停练习"}
            >
              <i className={`fas fa-${isPaused ? 'play' : 'pause'}`} />
            </button>
            <button
              type="button"
              className={styles.controlBtn}
              onClick={handleExit}
              title="退出练习"
            >
              <i className="fas fa-times" />
            </button>
          </div>
        </div>

        {/* 练习卡片 */}
        <div className={styles.practiceArea}>
          {isPaused ? (
            <div className={styles.pauseOverlay}>
              <div className={styles.pauseContent}>
                <i className="fas fa-pause-circle" />
                <h3>练习已暂停</h3>
                <p>点击继续按钮恢复练习</p>
                <button
                  type="button"
                  className={styles.resumeBtn}
                  onClick={handlePauseResume}
                >
                  <i className="fas fa-play" />
                  继续练习
                </button>
              </div>
            </div>
          ) : (
            <PracticeWordCard
              word={currentWord!}
              currentStep={currentStep}
              stepTitle={stepConfigs[currentStep].title}
              stepDescription={stepConfigs[currentStep].description}
              userInput={userInput}
              onInputChange={handleInputChange}
              onSubmitAnswer={handleSubmitAnswer}
              onPlayPronunciation={handlePlayPronunciation}
              showResult={showResult}
              isCorrect={isCorrect}
              disabled={false}
              autoFocus={true}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default WordPracticePage;
