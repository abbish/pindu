import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BookOpen, Clock, Flag, Loader2, Pause, PauseCircle, Play, RotateCw, TriangleAlert, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { PracticeWordCard, type PracticeStage, type PracticeWordData } from '../components/WordCard';
import { useToast } from '../components/Toast/ToastContainer';
import { type PracticeSession } from '../types/study';
import { practiceService } from '../services/practiceService';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import type { NavigateFn, PassagePracticeReturn } from '../navigation';
import { parsePhonicsSegments } from '../utils/phonics';
import { abortError, runRepeatedPlayback } from '../utils/repeatPlayback';
import { buildQueue, completedTaskCount, groupCountOf, queueWordFromState, scheduleRetry, type PracticeTask } from '../utils/practiceQueue';
import { activeTime as clockActive, pauseClock, resumeClock, startClock, totalTime as clockTotal, type PracticeClock } from '../utils/practiceClock';
import { checkSpelling, type LetterMark } from '../utils/spellingCheck';
import type { HintLevel } from '../utils/practiceReveal';
import { type ExampleDisplayMode, type ExampleGenerateMode } from '../components/ExamplePanel';
import { wordBookService } from '../services/wordbookService';
import type { WordExample } from '../types';
import { WordSidePanel, type WordSideTab } from '../components/WordSidePanel';
import { PracticeFeedback, type PracticeFeedbackData } from '../components/PracticeFeedback';

/** 一次答对后的停留时间（按 Enter 可立即继续）；纠正改对后不自动继续 */
const FEEDBACK_MS = { correct: 700 };

/**
 * 进入「看·说」后这段时间内不响应「盖住」：答对后 0.7 秒自动换题，
 * 用户为跳过等待按的 Enter / 点的「下一题」（同一位置的按钮）会落到新出现的「盖住」上，把看·说直接跳过。
 */
const LOOK_GUARD_MS = 800;

/** 自动朗读节奏：进入后 0.6 秒读单词一遍，读完停顿 1 秒再读例句一遍（没有例句只读单词） */
const AUTO_PLAY = { initialDelayMs: 600, gapMs: 1000 };

export interface WordPracticePageProps {
  /** 学习计划ID */
  planId?: number;
  /** 日程ID */
  scheduleId?: number;
  /** 会话ID - 用于恢复未完成的练习 */
  sessionId?: string;
  /** 退出练习回到哪里（默认计划详情） */
  returnTo?: PassagePracticeReturn;
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

/** 各任务的标题与说明（说明只在有看不见的后果时才写） */
function taskCopy(task: PracticeTask, stage: PracticeStage, isReview: boolean): { title: string; description: string } {
  if (stage === 'correction') {
    return { title: '查一查：改正拼写', description: '' };
  }
  const retry = task.kind === 'retry' ? '再试一次 · ' : '';
  if (isReview) {
    return { title: `${retry}复习：听写`, description: '答对推迟下次复习，答错明天再练' };
  }
  if (task.kind === 'review') {
    return { title: '当轮小测：听写', description: '' };
  }
  if (task.step === 1) {
    return stage === 'look'
      ? { title: `${retry}第一步：看 · 说`, description: '' }
      : { title: `${retry}第一步：盖 · 写`, description: '' };
  }
  if (task.step === 2) {
    return { title: `${retry}第二步：再盖再写`, description: '' };
  }
  return { title: `${retry}第三步：听写`, description: '' };
}

/** 任务对应的提示等级：第一步 1 级、第二步 2 级、第三步与小测 3 级 */
const hintLevelOf = (task: PracticeTask): HintLevel => (task.kind === 'review' ? 3 : task.step);

/**
 * 单词练习页面：按「看-说-盖-写-查」组织，组内按步骤交错，答错纠正后稍后重考，最后当轮小测。
 */
export const WordPracticePage: React.FC<WordPracticePageProps> = ({
  planId,
  scheduleId,
  sessionId,
  returnTo,
  onNavigate
}) => {
  const toast = useToast();
  const audioPlayer = useAudioPlayer();

  // 练习状态
  const [session, setSession] = useState<PracticeSession | null>(null);
  /** 任务队列与当前位置 */
  const [queue, setQueue] = useState<PracticeTask[]>([]);
  const [position, setPosition] = useState(0);
  /** 当前环节 */
  const [stage, setStage] = useState<PracticeStage>('look');
  /** 纠正时的逐字母标记 */
  const [marks, setMarks] = useState<LetterMark[] | undefined>(undefined);
  /** 每个（单词, 步骤）已重考的次数 */
  const retriesRef = useRef<Record<string, number>>({});
  const [userInput, setUserInput] = useState('');
  /** 作答反馈浮层 */
  const [feedback, setFeedback] = useState<PracticeFeedbackData | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 自动朗读：当前这一轮朗读的中止控制器；答题后自动进入下一题的定时器
  const autoPlayAbortRef = useRef<AbortController | null>(null);
  const nextStepTimerRef = useRef<number | null>(null);
  const { playWord, playSentence, prefetch } = audioPlayer;
  /** 正在朗读单词（看·说时据此高亮拼读块） */
  const [speakingWord, setSpeakingWord] = useState(false);

  // 计时：按时间戳计算（不依赖定时器按时触发），恢复会话时从已落库的时长继续累计
  const clockRef = useRef<PracticeClock | null>(null);
  const [, setTick] = useState(0);
  const nowActive = () => (clockRef.current ? clockActive(clockRef.current, Date.now()) : 0);
  const nowTotal = () => (clockRef.current ? clockTotal(clockRef.current, Date.now()) : 0);
  /** 当前题开始时的有效时长：单步用时 = 有效时长差（不含暂停） */
  const stepActiveStartRef = useRef(0);
  const markStepStart = () => {
    stepActiveStartRef.current = nowActive();
  };
  /** 还在途的作答提交：完成练习前要等它们写入 */
  const pendingSubmitsRef = useRef(new Set<Promise<unknown>>());
  /** 暂停 / 恢复请求进行中（防连点） */
  const [pauseBusy, setPauseBusy] = useState(false);

  // 防止重复初始化
  const initializeRef = useRef(false);
  /** 恢复会话时已经完成的题数（进度接着上次显示） */
  const baseDoneRef = useRef(0);


  // 退出确认对话框状态
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const words = session?.wordStates || [];
  const task: PracticeTask | undefined = queue[position];
  const currentWordState = task ? words[task.wordIndex] : undefined;

  // 当前单词（后端 PracticeWordInfo 以 camelCase 输出）
  const currentWord: PracticeWordData | null = useMemo(() => {
    const wordInfo = currentWordState?.wordInfo;
    if (!wordInfo) return null;
    return {
      id: wordInfo.wordId,
      word: wordInfo.word,
      meaning: wordInfo.meaning,
      description: wordInfo.description,
      ipa: wordInfo.ipa,
      syllables: wordInfo.syllables,
      phonicsSegments: parsePhonicsSegments(wordInfo.phonicsSegments),
      examples: wordInfo.examples ?? []
    };
  }, [currentWordState]);

  const hintLevel: HintLevel = task ? hintLevelOf(task) : 1;
  const copy = task ? taskCopy(task, stage, !!currentWordState?.isReview) : { title: '', description: '' };

  /** 新任务的起始环节：第一步的首次学习从「看·说」开始，其余直接「盖·写」 */
  const startStageOf = (t: PracticeTask | undefined): PracticeStage =>
    t && t.step === 1 && t.kind === 'learn' ? 'look' : 'write';

  // 停止当前这一轮自动朗读（正在播放的音频也会停止）
  const clearAutoPlay = useCallback(() => {
    autoPlayAbortRef.current?.abort();
    autoPlayAbortRef.current = null;
  }, []);

  const clearNextStepTimer = useCallback(() => {
    if (nextStepTimerRef.current) {
      clearTimeout(nextStepTimerRef.current);
      nextStepTimerRef.current = null;
    }
  }, []);

  // 每秒刷新一次显示的计时（数值本身按时间戳计算）
  const clockReady = session !== null;
  useEffect(() => {
    if (isPaused || !clockReady) return;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [isPaused, clockReady]);

  /** 把当前时长存到后端（恢复练习时从这里继续），失败静默 */
  const saveProgress = useCallback(() => {
    const clock = clockRef.current;
    if (!session || !clock) return Promise.resolve();
    const now = Date.now();
    return practiceService.savePracticeProgress(session.sessionId, clockTotal(clock, now), clockActive(clock, now));
  }, [session]);

  // 离开页面时保存进度
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  const completedRef = useRef(false);
  /** 离开页面时是否处于暂停（离开后不应继续算作暂停） */
  const leaveRef = useRef({ paused: false, sessionId: '' });
  leaveRef.current = { paused: isPaused, sessionId: session?.sessionId ?? '' };
  useEffect(() => () => {
    if (completedRef.current) return;
    saveProgressRef.current();
    const { paused, sessionId: leavingId } = leaveRef.current;
    if (paused && leavingId) practiceService.resumePracticeSession({ sessionId: leavingId });
  }, []);

  // 右栏例句：正在朗读的序号（自动朗读第一句时也会高亮）
  const [playingExample, setPlayingExample] = useState<number | null>(null);
  /** 右栏页签（换词时保持） */
  const [sideTab, setSideTab] = useState<WordSideTab>('examples');
  /** AI 补充 / 重新生成后的例句（按单词覆盖会话里的例句） */
  const [exampleOverrides, setExampleOverrides] = useState<Record<number, WordExample[]>>({});
  /** 正在生成例句的单词与方式 */
  const [examplesJob, setExamplesJob] = useState<{ wordId: number; mode: ExampleGenerateMode } | null>(null);
  const examples = (currentWord && exampleOverrides[currentWord.id]) ?? currentWord?.examples ?? [];
  const writing = stage === 'write';

  // 进入不能看讲解的环节（盖·写）时，右栏切回默认的「例句」页签
  useEffect(() => {
    if (writing) setSideTab(tab => (tab === 'explanation' ? 'examples' : tab));
  }, [writing, task?.id]);
  const exampleMode: ExampleDisplayMode = !writing ? 'full' : hintLevel === 3 ? 'translation' : 'masked';

  // 自动朗读：进入新任务时读单词 + 第一条例句；第一步「盖住」后只再读一遍单词。
  // 只由“任务 / 环节 / 暂停”驱动：播放函数经 ref 读取，页面重渲染（计时器、toast 等）不会重启本轮。
  const autoPlayWord = currentWord?.word;
  const nextTask = queue[position + 1];
  const nextWordText = nextTask ? words[nextTask.wordIndex]?.wordInfo?.word : undefined;
  const exampleText = examples[0]?.sentence.trim();
  const exampleTextRef = useRef(exampleText);
  exampleTextRef.current = exampleText;
  const audioFnsRef = useRef({ playWord, playSentence, prefetch });
  audioFnsRef.current = { playWord, playSentence, prefetch };
  /** 只在进入「看」或「写」时朗读；答对 / 纠正不触发 */
  const autoPlayKey = task && (stage === 'look' || stage === 'write') ? `${task.id}:${stage}` : null;
  const coveredAfterLook = useRef(false);

  /** 进入当前这次「看·说」的时刻（防误触，见 LOOK_GUARD_MS） */
  const lookStartedAtRef = useRef(0);
  const lookKey = task && stage === 'look' ? task.id : null;
  useEffect(() => {
    if (lookKey) lookStartedAtRef.current = performance.now();
  }, [lookKey]);

  useEffect(() => {
    if (isPaused || !autoPlayKey || !autoPlayWord) {
      clearAutoPlay();
      return;
    }

    const { playWord: speakWord, playSentence: speakSentence, prefetch: preload } = audioFnsRef.current;
    // 第一步看完盖住：只读单词（刚听过例句）
    const withExample = !coveredAfterLook.current;
    coveredAfterLook.current = false;
    const sentence = withExample ? exampleTextRef.current : undefined;
    preload(autoPlayWord);
    if (sentence) preload(sentence, 'sentence');

    const controller = new AbortController();
    autoPlayAbortRef.current?.abort();
    autoPlayAbortRef.current = controller;

    const items: Array<(signal: AbortSignal) => Promise<boolean>> = [
      async signal => {
        setSpeakingWord(true);
        try {
          return await speakWord(autoPlayWord, undefined, { signal });
        } finally {
          setSpeakingWord(false);
        }
      },
    ];
    if (sentence) {
      items.push(async signal => {
        setPlayingExample(0);
        try {
          return await speakSentence(sentence, undefined, { signal });
        } finally {
          setPlayingExample(current => (current === 0 ? null : current));
        }
      });
    }

    runRepeatedPlayback({
      times: items.length,
      ...AUTO_PLAY,
      signal: controller.signal,
      play: async (signal, index) => {
        const completed = await items[index](signal);
        // 被手动播放等打断：结束本轮，不再继续自动朗读
        if (!completed) throw abortError();
      },
    })
      .then(() => {
        // 本轮读完后预取下一题的单词
        if (!controller.signal.aborted && nextWordText) preload(nextWordText);
      })
      .catch(() => {
        // 生成/播放失败已由 useAudioPlayer 提示
      });

    return () => controller.abort();
  }, [autoPlayKey, isPaused, autoPlayWord, nextWordText, clearAutoPlay]);

  // 看·说：发音时按进度点亮拼读块（按字母数分配时长）
  const segments = currentWord?.phonicsSegments;
  const activeChunk = useMemo(() => {
    const { isPlaying, currentTime, duration } = audioPlayer.state;
    if (stage !== 'look' || !speakingWord || !isPlaying || !segments?.length || !duration) return null;
    const total = segments.reduce((n, seg) => n + seg.length, 0);
    const reached = (currentTime / duration) * total;
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      acc += segments[i].length;
      if (reached < acc) return i;
    }
    return segments.length - 1;
  }, [audioPlayer.state, stage, speakingWord, segments]);

  // 暂停时取消“自动进入下一题”；卸载时清理
  useEffect(() => {
    if (isPaused) clearNextStepTimer();
  }, [isPaused, clearNextStepTimer]);

  useEffect(() => {
    return () => {
      clearAutoPlay();
      clearNextStepTimer();
    };
  }, [clearAutoPlay, clearNextStepTimer]);

  // 初始化练习：创建 / 恢复会话后按每个词的进度生成任务队列。
  // 有计划和日程时一律走 start（后端会复用该日程未完成的会话，并校验计划状态）；
  // 只带 sessionId 时才直接读会话。
  const initialize = useCallback(async () => {
    if (!sessionId && (!planId || !scheduleId)) {
      setError('没有指定要练习的计划日程，请从学习计划进入练习');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = planId && scheduleId
        ? await practiceService.startPracticeSession({ planId, scheduleId })
        : await practiceService.getPracticeSessionDetail(sessionId!);

      if (!result.success) {
        // 页面级错误：只在主区显示（带返回），不再重复弹提示
        setError(result.error);
        return;
      }
      const data = result.data;
      if (data.completed) {
        setError('这次练习已经完成了，可以在学习计划里查看结果或开始新的练习。');
        return;
      }

      const queueWords = data.wordStates.map(queueWordFromState);
      const tasks = buildQueue(queueWords);
      const done = completedTaskCount(queueWords);
      const resumed = done > 0 || (data.activeTime || 0) > 0;
      // 恢复：已重考的次数接着算
      retriesRef.current = {};
      data.wordStates.forEach((w, i) =>
        (w.retryCounts ?? []).forEach((n, step) => {
          if (n > 0) retriesRef.current[`${i}-${step + 1}`] = n;
        })
      );
      clockRef.current = startClock(Date.now(), data.totalTime || 0, data.activeTime || 0);
      baseDoneRef.current = done;
      setSession(data);
      setQueue(tasks);
      setPosition(0);
      setStage(startStageOf(tasks[0]));
      markStepStart();

      if (resumed) {
        // 上次可能是暂停状态离开的：结束遗留的暂停，免得离开期间都算成暂停
        practiceService.resumePracticeSession({ sessionId: data.sessionId });
        if (sessionId && sessionId !== data.sessionId) {
          toast.showInfo('接着这个日程没练完的那次继续', '你打开的那次练习已经结束了');
        } else {
          toast.showInfo('接着上次的进度继续', `已完成 ${done} / ${done + tasks.length} 题`);
        }
      } else if (sessionId && sessionId !== data.sessionId) {
        toast.showInfo('开始了一次新的练习', '你打开的那次练习已经结束了');
      }

      // 上次最后一题已经答完、但没来得及提交“完成”：直接完成
      if (tasks.length === 0) {
        toast.showInfo('上次已经全部答完', '正在生成练习结果');
        completeSession(data);
      }
    } catch (error) {
      console.error('初始化练习失败:', error);
      setError('练习没能打开，请返回后再试');
    } finally {
      setLoading(false);
    }
    // completeSession 只用到 ref 与稳定的 setter
  }, [planId, scheduleId, sessionId, toast]);

  useEffect(() => {
    if (initializeRef.current) return;
    initializeRef.current = true;
    initialize();
  }, [initialize]);

  // 格式化时间显示
  const formatTime = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // 防止重复完成的标志（ref 防同一轮内重复调用，state 用于界面）
  const [isCompleting, setIsCompleting] = useState(false);
  const completingRef = useRef(false);

  // 处理练习完成
  const handleCompletePractice = () => {
    if (session) completeSession(session);
  };

  /** 完成会话（也用于恢复时发现已经全部答完的会话） */
  async function completeSession(target: PracticeSession) {
    if (completingRef.current) return;
    completingRef.current = true;
    setIsCompleting(true);
    try {
      // 先等在途的作答记录写完，否则最后一题可能晚于“完成”落库而丢失
      await Promise.allSettled([...pendingSubmitsRef.current]);
      const result = await practiceService.completePracticeSession({
        sessionId: target.sessionId,
        totalTime: nowTotal(),
        activeTime: nowActive()
      });

      if (result.success) {
        completedRef.current = true;
        // 直接进入结果页，结果页本身就是完成反馈，不再弹提示
        onNavigate?.('practice-result', result.data);
      } else {
        toast.showError('无法保存练习结果', `${result.error}。作答已保存，可以再点一次「完成」`);
        completingRef.current = false;
        setIsCompleting(false);
      }
    } catch (error) {
      console.error('完成练习失败:', error);
      toast.showError('无法保存练习结果', '作答已保存，可以再点一次「完成」');
      completingRef.current = false;
      setIsCompleting(false);
    }
  }

  /** 进入下一题（队列结束则完成练习） */
  const advance = () => {
    clearAutoPlay();
    clearNextStepTimer();
    setFeedback(null);
    setMarks(undefined);
    setUserInput('');
    const next = position + 1;
    if (next >= queue.length) {
      handleCompletePractice();
      return;
    }
    setPosition(next);
    setStage(startStageOf(queue[next]));
    markStepStart();
  };

  /** 看·说结束：盖住单词开始写（再读一遍单词） */
  const handleCover = () => {
    if (performance.now() - lookStartedAtRef.current < LOOK_GUARD_MS) return;
    clearAutoPlay();
    coveredAfterLook.current = true;
    setStage('write');
    markStepStart();
  };

  // 作答（盖·写）与改正（查）
  const handleSubmitAnswer = (userAnswer: string) => {
    if (!task || !currentWord || !currentWordState || !session) return;
    clearAutoPlay();

    // 查：照着正确拼写重打，对了才继续
    if (stage === 'correction') {
      if (checkSpelling(userAnswer, currentWord.word).correct) {
        // 改对后不自动跳走：留时间看讲解、问 AI 老师，按 Enter 或「下一题」继续
        setStage('feedback');
        setMarks(undefined);
        setFeedback({ id: Date.now(), type: 'fixed', answer: currentWord.word });
        clearNextStepTimer();
      } else {
        setUserInput('');
        setFeedback(prev => (prev ? { ...prev, id: Date.now() } : prev));
      }
      return;
    }
    if (stage !== 'write') return;

    const check = checkSpelling(userAnswer, currentWord.word, currentWord.phonicsSegments ?? []);
    const retryKey = `${task.wordIndex}-${task.step}`;
    const retriesSoFar = retriesRef.current[retryKey] ?? 0;
    const timeSpent = Math.max(0, nowActive() - stepActiveStartRef.current);

    // 记录在后台提交（成绩只取每步第一次作答；重考与小测追加记录）；完成练习前会等它写完
    const submission = practiceService
      .submitStepResult({
        sessionId: session.sessionId,
        wordId: currentWordState.wordId,
        planWordId: currentWordState.planWordId,
        step: task.step,
        userInput: userAnswer,
        isCorrect: check.correct,
        timeSpent,
        attempts: task.kind === 'retry' ? retriesSoFar + 1 : 1,
        kind: task.kind
      })
      .then(result => {
        // 连续几题都失败时只保留一条提示
        if (!result.success) toast.showToast({ type: 'error', id: 'practice-step-save', title: '无法保存这一题的作答', message: result.error });
      })
      .finally(() => {
        pendingSubmitsRef.current.delete(submission);
      });
    pendingSubmitsRef.current.add(submission);
    saveProgress();

    if (check.correct) {
      setStage('feedback');
      setFeedback({ id: Date.now(), type: 'correct', answer: currentWord.word });
      clearNextStepTimer();
      nextStepTimerRef.current = setTimeout(() => {
        nextStepTimerRef.current = null;
        advance();
      }, FEEDBACK_MS.correct);
      return;
    }

    // 查：标出错字母，照着重打；稍后重考
    const updated = scheduleRetry(queue, position, retriesSoFar);
    const willRetry = updated !== queue;
    if (willRetry) {
      retriesRef.current[retryKey] = retriesSoFar + 1;
      setQueue(updated);
    }
    setMarks(check.marks);
    setStage('correction');
    setUserInput('');
    setFeedback({
      id: Date.now(),
      type: 'incorrect',
      answer: currentWord.word,
      wrongChunks: check.wrongChunks,
      willRetry
    });
  };

  // 答对后按 Enter：跳过剩余等待
  const handleContinue = () => {
    if (stage !== 'feedback' || isPaused) return;
    advance();
  };

  // 处理暂停/恢复
  const handlePauseResume = async () => {
    if (!session || pauseBusy) return;

    setPauseBusy(true);
    try {
      if (isPaused) {
        const result = await practiceService.resumePracticeSession({ sessionId: session.sessionId });
        if (result.success) {
          if (clockRef.current) clockRef.current = resumeClock(clockRef.current, Date.now());
          setIsPaused(false);
          // 暂停发生在一次答对的短暂停留期间：恢复后直接进入下一题（改对后的停留不自动跳走）
          if (stage === 'feedback' && feedback?.type === 'correct') advance();
        } else {
          toast.showError('无法继续练习', result.error);
        }
      } else {
        const result = await practiceService.pausePracticeSession({ sessionId: session.sessionId });
        if (result.success) {
          if (clockRef.current) clockRef.current = pauseClock(clockRef.current, Date.now());
          setIsPaused(true);
          saveProgress();
        } else {
          toast.showError('无法暂停', result.error);
        }
      }
    } catch (error) {
      console.error('暂停/恢复练习失败:', error);
      toast.showError(isPaused ? '无法继续练习' : '无法暂停', '请再试一次');
    } finally {
      setPauseBusy(false);
    }
  };

  // 手动点喇叭：结束本轮自动朗读，只读一遍单词
  const handlePlayPronunciation = useCallback(() => {
    if (!currentWord?.word) return;
    clearAutoPlay();
    setSpeakingWord(true);
    playWord(currentWord.word)
      .catch(() => {
        // 失败已由 useAudioPlayer 提示
      })
      .finally(() => setSpeakingWord(false));
  }, [currentWord?.word, playWord, clearAutoPlay]);

  // 点击右栏例句：结束本轮自动朗读，朗读该句
  const handlePlayExample = useCallback((index: number) => {
    const sentence = examples[index]?.sentence;
    if (!sentence) return;
    clearAutoPlay();
    setPlayingExample(index);
    playSentence(sentence)
      .catch(() => {
        // 失败已由 useAudioPlayer 提示
      })
      .finally(() => setPlayingExample(current => (current === index ? null : current)));
  }, [examples, playSentence, clearAutoPlay]);

  // AI 补充 / 重新生成当前单词的例句
  const handleGenerateExamples = useCallback(async (mode: ExampleGenerateMode) => {
    if (!currentWord || examplesJob) return;
    const wordId = currentWord.id;
    setExamplesJob({ wordId, mode });
    const result = await wordBookService.generateWordExamples(wordId, mode);
    setExamplesJob(null);
    if (result.success) {
      const before = (exampleOverrides[wordId] ?? currentWord.examples ?? []).length;
      setExampleOverrides(prev => ({ ...prev, [wordId]: result.data }));
      toast.showSuccess(
        mode === 'append' ? `已新增 ${Math.max(0, result.data.length - before)} 条例句` : `已重新生成 ${result.data.length} 条例句`
      );
    } else {
      toast.showError('无法生成例句', result.error);
    }
  }, [currentWord, examplesJob, exampleOverrides, toast]);

  // 换题时清除例句高亮
  useEffect(() => {
    setPlayingExample(null);
  }, [task?.id]);

  // 进度：已完成题数 / 总题数（含恢复前已做的；重考会让总数增加）；当前所在组或小测
  const groupCount = groupCountOf(words.length);
  const doneCount = baseDoneRef.current + position;
  const totalCount = baseDoneRef.current + queue.length;
  const progressLabel = !task
    ? ''
    : task.kind === 'review'
      ? '当轮小测'
      : currentWordState?.isReview
        ? `第 ${task.group + 1} / ${groupCount} 组 · 复习`
        : `第 ${task.group + 1} / ${groupCount} 组 · 第${['一', '二', '三'][task.step - 1]}步`;
  const progressPercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // 处理退出练习
  const handleExit = () => {
    setShowExitConfirm(true);
  };

  // 确认退出练习
  const handleConfirmExit = async () => {
    setShowExitConfirm(false);
    await saveProgress();
    leave();
  };

  /** 回到进入练习前的页面（首页 / 日历 / 计划详情） */
  const leave = () => {
    if (returnTo === 'home') onNavigate?.('home');
    else if (returnTo === 'calendar') onNavigate?.('calendar');
    else if (planId) onNavigate?.('plan-detail', { planId });
    else onNavigate?.('plans');
  };

  // 取消退出练习
  const handleCancelExit = () => {
    setShowExitConfirm(false);
  };

  /** 专注模式的整窗框架：顶栏（退出 / 进度 / 计时 / 暂停）+ 内容区 */
  const frame = (content: React.ReactNode, withStatus = false) => (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4 select-none">
        <Button variant="ghost" size="icon" aria-label="退出练习" title="退出练习" onClick={withStatus ? handleExit : leave}>
          <X />
        </Button>
        {withStatus ? (
          <>
            <span className="text-sm font-medium">{progressLabel}</span>
            <div className="mx-auto flex max-w-lg flex-1 items-center gap-3" title="答错重考会增加题数">
              <Progress value={progressPercent} className="h-2 flex-1 [&>[data-slot=progress-indicator]]:bg-brand" />
              <span className="text-sm tabular-nums">{doneCount} / {totalCount}</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums" title="不含暂停">
              <Clock className="size-4" />
              {formatTime(nowActive())}
            </span>
            <Button variant="outline" onClick={handlePauseResume} disabled={pauseBusy}>
              {isPaused ? <Play /> : <Pause />}
              {isPaused ? '继续' : '暂停'}
            </Button>
          </>
        ) : (
          <span className="text-sm font-medium">单词练习</span>
        )}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{content}</main>
    </div>
  );

  const centered = (icon: React.ReactNode, title: string, text: React.ReactNode, action?: React.ReactNode) =>
    frame(
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-6">{icon}</div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {text && <div className="max-w-md text-sm text-muted-foreground">{text}</div>}
        {action}
      </div>
    );

  // 加载状态
  if (loading) {
    return centered(<Loader2 className="animate-spin" />, '正在准备练习…', null);
  }

  // 错误状态
  if (error) {
    return centered(
      <TriangleAlert />,
      '无法开始练习',
      error,
      <Button onClick={() => initialize()}>
        <RotateCw />
        重试
      </Button>
    );
  }

  // 恢复时发现已经全部答完：正在完成
  if (session && words.length > 0 && queue.length === 0) {
    return centered(
      <Flag />,
      '这次练习已经全部做完',
      isCompleting ? '正在生成练习结果…' : null,
      !isCompleting && <Button onClick={handleCompletePractice}>查看练习结果</Button>
    );
  }

  // 没有单词数据
  if (!session || words.length === 0 || !currentWord) {
    return centered(
      <BookOpen />,
      '这个日程没有单词练习',
      null,
      <Button variant="outline" onClick={() => onNavigate?.('home')}>
        返回首页
      </Button>
    );
  }

  return (
    <>
      {frame(
        isPaused ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <PauseCircle className="size-12 text-muted-foreground" />
            <h2 className="text-lg font-semibold">练习已暂停</h2>
            <Button onClick={handlePauseResume}>
              <Play />
              继续练习
            </Button>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-[1400px] grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-5 px-6 py-6">
            <div className="relative flex flex-col gap-3">
              <PracticeFeedback feedback={feedback} />
              <PracticeWordCard
                word={currentWord!}
                stage={stage}
                hintLevel={hintLevel}
                stepTitle={copy.title}
                stepDescription={copy.description}
                userInput={userInput}
                onInputChange={setUserInput}
                onSubmitAnswer={handleSubmitAnswer}
                onCover={handleCover}
                onPlayPronunciation={handlePlayPronunciation}
                onContinue={handleContinue}
                marks={marks}
                activeChunk={activeChunk}
              />
            </div>
            <WordSidePanel
              tab={sideTab}
              onTabChange={setSideTab}
              wordId={currentWord!.id}
              word={currentWord!.word}
              examples={examples}
              exampleMode={exampleMode}
              playingIndex={playingExample}
              loadingIndex={audioPlayer.state.isLoading ? playingExample : null}
              onSelectExample={handlePlayExample}
              generatingExamples={examplesJob?.wordId === currentWord!.id ? examplesJob.mode : null}
              onGenerateExamples={handleGenerateExamples}
              explanationLocked={writing}
              explanationSuggested={stage === 'correction' || feedback?.type === 'fixed'}
              explanationAutoGenerate={
                stage === 'look' || stage === 'correction' || (stage === 'feedback' && feedback?.type === 'fixed')
              }
            />
          </div>
        ),
        true
      )}

      {/* 退出确认 */}
      <AlertDialog open={showExitConfirm} onOpenChange={(open) => !open && handleCancelExit()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>退出练习？</AlertDialogTitle>
            <AlertDialogDescription>进度会保存，下次可以接着练。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续练习</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmExit}>退出</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
