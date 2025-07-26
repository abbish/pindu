import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Header,
  Modal,
  PracticeWordCard,
  type PracticeWordData,
  useToast
} from '../components';
import {
  WordPracticeStep,
  type PracticeSession
} from '../types/study';
import { practiceService } from '../services/practiceService';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
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
  const audioPlayer = useAudioPlayer();

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

  // 自动播放相关状态
  const [autoPlayCount, setAutoPlayCount] = useState(0);

  // 调试日志：监听自动播放计数变化
  useEffect(() => {
    if (autoPlayCount > 0) {
      console.log(`自动播放计数: ${autoPlayCount}/3`);
    }
  }, [autoPlayCount]);
  const autoPlayTimerRef = useRef<number | null>(null);

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

  // 退出确认对话框状态
  const [showExitConfirm, setShowExitConfirm] = useState(false);

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

  // 获取当前步骤配置，添加安全检查
  const getCurrentStepConfig = () => {
    return stepConfigs[currentStep] || {
      title: "练习步骤",
      description: "请按照提示完成练习"
    };
  };

  // 清理自动播放定时器
  const clearAutoPlay = useCallback(() => {
    if (autoPlayTimerRef.current) {
      clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    setAutoPlayCount(0);
  }, []);

  // 自动播放功能：进入步骤后1秒开始，播放3次，每次在上一次播放完成后1秒播放
  const startAutoPlay = useCallback(() => {
    console.log('startAutoPlay 被调用', {
      hasWord: !!currentWord?.word,
      isPaused,
      showResult,
      isCorrect
    });

    // 如果没有单词或者暂停了，直接返回
    if (!currentWord?.word || isPaused) {
      console.log('startAutoPlay 提前返回 - 没有单词或已暂停');
      return;
    }

    // 如果显示结果且答案正确，不需要朗读
    if (showResult && isCorrect) {
      console.log('startAutoPlay 提前返回 - 答案正确');
      return;
    }

    // 清除之前的定时器
    clearAutoPlay();

    setAutoPlayCount(0);
    console.log('开始自动播放序列');

    // 1秒后开始第一次播放
    autoPlayTimerRef.current = setTimeout(() => {
      console.log('1秒延迟后检查状态', { isPaused, showResult, isCorrect });
      // 只有暂停或者答案正确时才停止
      if (isPaused || (showResult && isCorrect)) return;

      const playSequence = async (count: number) => {
        console.log('playSequence 被调用', { count, isPaused, showResult, isCorrect });

        // 检查是否应该停止播放：播放3次完成、暂停、或者答案正确
        if (count >= 3 || isPaused || (showResult && isCorrect)) {
          console.log('播放序列结束', { count, isPaused, showResult, isCorrect });
          setAutoPlayCount(0);
          return;
        }

        // 播放当前单词（允许在显示错误结果时播放）
        if (currentWord?.word && !isPaused && !(showResult && isCorrect)) {
          console.log(`播放第 ${count + 1} 次:`, currentWord.word);
          setAutoPlayCount(count + 1);

          try {
            // 等待音频播放完成
            await audioPlayer.playWord(currentWord.word);
            console.log(`第 ${count + 1} 次播放完成`);

            // 如果还没播放完3次，1秒后播放下一次（允许在显示错误结果时继续）
            if (count + 1 < 3 && !isPaused && !(showResult && isCorrect)) {
              console.log('1秒后播放下一次');
              autoPlayTimerRef.current = setTimeout(() => {
                playSequence(count + 1);
              }, 1000);
            } else {
              // 播放完3次后清理状态
              console.log('播放完成，清理状态');
              setAutoPlayCount(0);
            }
          } catch (error) {
            console.error('播放失败:', error);
            setAutoPlayCount(0);
          }
        }
      };

      // 立即开始第一次播放
      playSequence(0);
    }, 1000);
  }, [currentWord?.word, audioPlayer]);

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

  // 自动播放效果：当步骤或单词变化时触发
  useEffect(() => {
    // 只在新步骤或新单词时自动开始播放，不在显示结果时开始
    if (!isPaused && currentWord?.word && !showResult) {
      console.log('触发自动播放:', { currentStep, currentWordIndex, showResult });
      startAutoPlay();
    } else if (isPaused) {
      // 暂停时清理播放
      clearAutoPlay();
    } else if (showResult) {
      // 显示结果时清理播放，避免重复播放
      clearAutoPlay();
    }

    // 清理函数
    return () => {
      clearAutoPlay();
    };
  }, [currentStep, currentWordIndex, isPaused, currentWord?.word, showResult]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      clearAutoPlay();
    };
  }, [clearAutoPlay]);

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

    // 立即停止自动播放
    clearAutoPlay();

    const correct = userAnswer.toLowerCase() === currentWord.word.toLowerCase();
    setIsCorrect(correct);
    setShowResult(true);

    // 计算步骤用时
    const now = Date.now();
    const timeSpent = stepStartTime > 0 ? now - stepStartTime : 0;

    try {
      // 调试信息
      console.log('提交步骤结果 - 调试信息:', {
        currentStep,
        currentStepType: typeof currentStep,
        currentStepValue: currentStep,
        WordPracticeStep: WordPracticeStep,
        STEP_1: WordPracticeStep.STEP_1,
        STEP_2: WordPracticeStep.STEP_2,
        STEP_3: WordPracticeStep.STEP_3
      });

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

    // 根据答案正确性设置不同的延迟时间
    const delayTime = correct ? 1500 : 2000; // 正确1.5秒，错误2秒
    console.log(`答案${correct ? '正确' : '错误'}，${delayTime/1000}秒后自动进入下一步`);

    // 设置自动进入下一步的定时器
    autoPlayTimerRef.current = setTimeout(() => {
      handleNextStep();
    }, delayTime);
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

    // 清理当前的自动播放
    clearAutoPlay();

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

        // 自动播放将由useEffect自动处理
      }
    } else {
      // 进入下一步，确保不超出范围
      if (currentStep === WordPracticeStep.STEP_1) {
        console.log('进入步骤2');
        setShowResult(false);
        setCurrentStep(WordPracticeStep.STEP_2);
        setUserInput('');
        setStepStartTime(Date.now());
        setCurrentAttempts(1);
      } else if (currentStep === WordPracticeStep.STEP_2) {
        console.log('进入步骤3');
        setShowResult(false);
        setCurrentStep(WordPracticeStep.STEP_3);
        setUserInput('');
        setStepStartTime(Date.now());
        setCurrentAttempts(1);
      } else {
        console.error('当前已是最后一步，无法进入下一步:', currentStep);
      }
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
  const handlePlayPronunciation = useCallback(() => {
    if (currentWord?.word) {
      audioPlayer.playWord(currentWord.word);
    }
  }, [currentWord?.word, audioPlayer]);



  // 防止重复完成的标志
  const [isCompleting, setIsCompleting] = useState(false);

  // 处理练习完成
  const handleCompletePractice = async () => {
    if (!session || isCompleting) return;

    setIsCompleting(true);
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
        setIsCompleting(false); // 失败时重置标志，允许重试
      }
    } catch (error) {
      console.error('完成练习失败:', error);
      toast.showError('完成失败', '完成练习时发生错误');
      setIsCompleting(false); // 错误时重置标志，允许重试
    }
  };

  // 处理退出练习
  const handleExit = () => {
    setShowExitConfirm(true);
  };

  // 确认退出练习
  const handleConfirmExit = () => {
    setShowExitConfirm(false);
    onNavigate?.('plan-detail', { planId });
  };

  // 取消退出练习
  const handleCancelExit = () => {
    setShowExitConfirm(false);
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
              stepTitle={getCurrentStepConfig().title}
              stepDescription={getCurrentStepConfig().description}
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

      {/* 退出确认对话框 */}
      {showExitConfirm && (
        <Modal
          isOpen={showExitConfirm}
          onClose={handleCancelExit}
          title="退出练习"
          size="small"
        >
          <div className={styles.exitConfirmContent}>
            <div className={styles.exitConfirmMessage}>
              <i className={`fas fa-exclamation-triangle ${styles.exitConfirmIcon}`} />
              <h3 className={styles.exitConfirmTitle}>确定要退出练习吗？</h3>
              <p className={styles.exitConfirmDescription}>
                退出后您的练习进度将会保存，可以稍后继续练习。
              </p>
            </div>

            <div className={styles.exitConfirmActions}>
              <button
                type="button"
                onClick={handleCancelExit}
                className={`${styles.exitConfirmBtn} ${styles.exitConfirmBtnCancel}`}
              >
                继续练习
              </button>
              <button
                type="button"
                onClick={handleConfirmExit}
                className={`${styles.exitConfirmBtn} ${styles.exitConfirmBtnConfirm}`}
              >
                确认退出
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default WordPracticePage;
