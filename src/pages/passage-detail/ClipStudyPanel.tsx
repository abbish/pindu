import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Ear, EyeOff, Mic, PenLine } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Card } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SelectionAction } from '@/components/SelectionAction';
import { useClipTiming, waitForClipTimes } from '@/hooks/useClipTimes';
import { seekMedia } from '@/utils/mediaSeek';
import { trackPlayback } from '@/utils/playbackTail';
import { canAddTarget, formsOf } from '@/utils/passage';
import { TargetWord } from '@/components/PassageReader/WordCard';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useTargetWordInfo } from './useTargetWordInfo';
import { ClipSentences } from './clip/ClipSentences';
import { cn } from '@/lib/utils';
import { SentenceAnalysisPanel } from '@/components/SentenceAnalysis';
import type { Passage, PassageSentence } from '@/types/passage';
import type { PassageVideo } from '@/types/video';
import type { PronunciationContext } from '@/types/pronunciation';
import { useSentenceSay } from '@/components/SayText';
import { type CoverMode, ModelNotice, PrefsPopover, endOf, loadPrefs, PREFS_KEY, startOf, type ClipPrefs, type SpeakMode, type Subtitles } from './clip/ClipControls';
import { useShadowing } from './clip/useShadowing';
import { ShadowLine } from './clip/ShadowLine';
import { pickBlanks } from '@/utils/dictation';
import { DictationPanel, type DictationResult } from './clip/DictationPanel';
import { ClipGuide } from './clip/ClipGuide';
import { AiTeacherPanel } from '@/components/AiTeacher';
import { passageChatId } from '@/services/wordExplanationService';
import { SpeakCard } from './clip/SpeakCard';
import { ShadowCard } from './clip/ShadowCard';
import { PlayerBar } from './clip/PlayerBar';

/** 练习模式（页签） */
type Mode = 'understand' | 'blind' | 'speak' | 'dictate';
const MODES: { key: Mode; label: string; icon: React.ElementType }[] = [
  { key: 'understand', label: '理解', icon: BookOpen },
  { key: 'blind', label: '盲听', icon: Ear },
  { key: 'speak', label: '跟读', icon: Mic },
  { key: 'dictate', label: '精听', icon: PenLine },
];
const SLOW_RATE = 0.75;
/** 影子跟读一次练多长（毫秒）：太长练完才看得到结果，停下又白录 */
const SHADOW_UNIT_MS = 30_000;

/** 单句播放提前一点停：暂停生效要一小会儿，不提前会漏出下一句的开头 */
const STOP_LEAD_MS = 40;

/** 跟读里两步之间稍停一下（看清结果、换气） */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ClipStudyPanelProps {
  video: PassageVideo;
  sentences: PassageSentence[];
  /** 短文（片段）：词汇（挖空、选词加入）与讲解用 */
  passage: Pick<Passage, 'id' | 'title' | 'targetWords'>;
  /** 台词里选中一个词，加成目标词 */
  onAddTarget?: (word: string, stay?: boolean, form?: string) => void;
  /** 打开这个词汇的完整单词卡 */
  onOpenWord?: (word: string) => void;
  /** 句子分析里改译文；失败时返回原因 */
  onEditTranslation?: (index: number, zh: string) => Promise<string | null>;
  /** 学习计划里跟读时带上：发音结果保存进计划的统计 */
  pronunciationContext?: PronunciationContext;
}

/**
 * 场景片段的练习，四个模式（页签），切换时都不自动播放：
 * - 理解：视频占满宽度（字幕按设置），下面是 AI 的内容精讲（逐段讲清内容，背景、句式、词汇穿插在讲到的地方）；
 * - 盲听：不看字幕听，可以遮住画面只听声音（画面里本身有字的视频，默认遮住）；
 * - 跟读：逐句跟读——一次练一句（SpeakCard）：播这一句原声（可播几遍）→ 开麦 → 本机评分，可以「读完自动下一句」；
 *   影子跟读——台词列表，看着台词和原声同时说一段（约 30 秒，要戴耳机），放完逐句看每个词说没说出来、比原声慢多少（见 useShadowing）；
 * - 精听：逐句听，只填挖掉的几个词（见 DictationPanel），画面默认遮住（常印着台词）；
 * 视频下面是标准的控制条（PlayerBar）：播放、上一句 / 重听这句 / 下一句、进度、速度、字幕、音量、全屏，带快捷键。
 */
export const ClipStudyPanel: React.FC<ClipStudyPanelProps> = ({ video, sentences: rawSentences, passage, onAddTarget, onOpenWord, onEditTranslation, pronunciationContext }) => {
  // 句子起止按声音校准（字幕交界常常紧挨着下一句开口，单句播放会带出下一句的开头），波形读不到时用字幕时间
  const { sentences, ready: timesReady, words: wordSpans } = useClipTiming(video, rawSentences, passage.id);
  const wordsRef = useRef(wordSpans);
  wordsRef.current = wordSpans;
  // 单句播放与跟读流程读最新的时间：对齐结果在流程开始后才到时，后面的句子也按它播
  const sentencesRef = useRef(sentences);
  sentencesRef.current = sentences;
  const timesReadyRef = useRef(timesReady);
  timesReadyRef.current = timesReady;
  /** 单句播放在等片段时间就绪（台词对齐还没做完） */
  const [preparing, setPreparing] = useState(false);
  const targetWords = useMemo(() => passage.targetWords.map((w) => w.word), [passage.targetWords]);
  /** 词汇（词组）在台词里的写法 */
  const forms = useMemo(() => formsOf(passage.targetWords), [passage.targetWords]);
  const wordInfo = useTargetWordInfo(passage);
  const wordAudio = useAudioPlayer();
  // 台词每句后面的跟读：开始前暂停视频
  const texts = useMemo(() => rawSentences.map((s) => s.en), [rawSentences]);
  const sentenceSay = useSentenceSay(texts, pronunciationContext, () => videoRef.current?.pause());
  const say = sentenceSay.say;
  /** 正在看分析的台词 */
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  /** 围绕这个片段的 AI 老师对话（和句子分析占同一个位置，开一个关另一个） */
  const [teacherOpen, setTeacherOpen] = useState(false);
  /** 讲解标题栏的 AI 老师开关（稳定的函数：讲解组件不随播放进度每帧重画） */
  const toggleGuideTeacher = useCallback((on: boolean) => {
    setTeacherOpen(on);
    if (on) setAnalyzing(null);
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [prefs, setPrefs] = useState<ClipPrefs>(loadPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [mode, setMode] = useState<Mode>('understand');
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const [current, setCurrent] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  /** 全屏：视频与控制条铺满窗口，窗口进入系统全屏 */
  const [fullscreen, setFullscreen] = useState(false);
  /** 精听：能挖空的句子与每句的结果（只在这次打开期间保留） */
  const clozeOrder = useMemo(() => rawSentences.flatMap((s, i) => (pickBlanks(s.en, targetWords, prefs.blankLevel).length > 0 ? [i] : [])), [rawSentences, targetWords, prefs.blankLevel]);
  const [dictation, setDictation] = useState<Map<number, DictationResult>>(new Map());

  /** 跟读：正在自动一句一句跟读；flowToken 每次开始 / 停下加 1，旧流程据此退出 */
  const [flowing, setFlowing] = useState(false);
  const flowToken = useRef(0);
  /** 单句原声播完（true）或被打断（false）时通知等着的跟读流程 */
  const originalDone = useRef<((finished: boolean) => void) | null>(null);
  /** 播到这里自动停（单句播放 / 每句后暂停） */
  const stopAt = useRef<number | null>(null);
  /** 这次播放是单句原声（跟读、精听用） */
  const sentencePlay = useRef(false);
  /** 单句播放是不是慢速（精听的「播放」「慢速」按钮据此显示哪个在播） */
  const [sentenceSlow, setSentenceSlow] = useState(false);
  /** 每句后暂停：正在播的那句（播过它的结尾就停）；播放中改开关也立刻生效 */
  const pauseEachRef = useRef(false);
  pauseEachRef.current = mode === 'understand' && prefs.pauseEach;
  const playingSentence = useRef<number | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  const updatePrefs = (patch: Partial<ClipPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // 本机存不了就只在这次生效
      }
      return next;
    });

  const active = sentences.findIndex((s) => startOf(s) <= now && now < endOf(s));
  const line = active >= 0 ? sentences[active] : null;
  // 盲听不显示字幕；精听只显示做完的句子；理解、跟读按设置
  const shown: Subtitles = mode === 'blind' ? 'none' : mode === 'dictate' ? (active >= 0 && dictation.has(active) ? 'both' : 'none') : prefs.subtitles;

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  // 播放头（requestAnimationFrame 比 timeupdate 准，单句播放要停得准）
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime * 1000;
        if (stopAt.current !== null && t >= stopAt.current) {
          const end = stopAt.current;
          stopAt.current = null;
          v.pause();
          v.currentTime = end / 1000;
          v.playbackRate = rate;
          if (sentencePlay.current) {
            const done = originalDone.current;
            originalDone.current = null;
            done?.(true);
          }
          sentencePlay.current = false;
        } else if (pauseEachRef.current && !sentencePlay.current) {
          const done = playingSentence.current;
          if (done !== null && sentences[done] && t >= endOf(sentences[done])) {
            // 播完这一句：停在句尾，下次播放从下一句开始
            playingSentence.current = null;
            v.pause();
            v.currentTime = endOf(sentences[done]) / 1000;
          } else {
            const i = sentences.findIndex((x) => startOf(x) <= t && t < endOf(x));
            if (i >= 0) playingSentence.current = i;
          }
        }
        setNow(v.currentTime * 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, mode, current, sentences, rate]);

  const seek = (ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    playingSentence.current = null;
    setNow(ms);
  };

  /** 连着播第 from 到第 to 句（跟读原声、精听、影子跟读）；slow 时用慢速；真正开始放时调用 onStart。播完返回 true，被打断返回 false */
  const playRange = useCallback(
    (from: number, to: number, slow = false, onStart?: () => void) =>
      new Promise<boolean>((resolve) => {
        const v = videoRef.current;
        if (!sentencesRef.current[from] || !sentencesRef.current[to] || !v) return resolve(false);
        const index = from;
        originalDone.current?.(false);
        originalDone.current = resolve;
        const isCurrent = () => originalDone.current === resolve;
        setCurrent(index);
        v.pause();
        v.playbackRate = slow ? SLOW_RATE : rateRef.current;
        setSentenceSlow(slow);
        stopAt.current = null;
        sentencePlay.current = true;
        void (async () => {
          // 台词对齐还没做完时先等（字幕时间常常早停半秒，切掉最后一个词）
          if (!timesReadyRef.current) {
            setPreparing(true);
            await waitForClipTimes(() => timesReadyRef.current, isCurrent);
            // 被后一次播放打断时，「准备中」交给后一次去收
            if (isCurrent()) setPreparing(false);
          }
          const s = sentencesRef.current[index];
          if (!isCurrent() || !s) return;
          // 跳好了再播（跳转中就播，句首会卡一下）；等跳转期间被打断（originalDone 已换）就不播了
          await seekMedia(v, startOf(s) / 1000);
          if (!isCurrent()) return;
          const latest = sentencesRef.current[index] ?? s;
          const last = sentencesRef.current[to] ?? latest;
          stopAt.current = Math.max(startOf(latest), endOf(last) - STOP_LEAD_MS);
          try {
            await v.play();
          } catch {
            // 播放还没开始就被暂停打断：这一句算没播完
            if (isCurrent()) {
              originalDone.current = null;
              resolve(false);
            }
            return;
          }
          if (isCurrent()) onStart?.();
        })();
      }),
    []
  );
  const playSentence = useCallback((index: number, slow = false) => playRange(index, index, slow), [playRange]);

  const shadow = useShadowing({
    texts,
    resetKey: passage.id,
    timesRef: sentencesRef,
    wordsRef,
    rateRef,
    playRange: (from, to, onStart) => playRange(from, to, false, onStart),
  });
  const speakMode: SpeakMode = prefs.speakMode;

  /** 停下（慢速播到一半被打断时，倍速回到控制条上选的） */
  const pause = () => {
    const v = videoRef.current;
    v?.pause();
    if (v) v.playbackRate = rateRef.current;
    stopAt.current = null;
    sentencePlay.current = false;
    const done = originalDone.current;
    originalDone.current = null;
    done?.(false);
  };

  /** 停下跟读流程（逐句跟读录到一半的照常收尾、评分；影子跟读录到的丢掉） */
  const stopFlow = () => {
    flowToken.current += 1;
    setFlowing(false);
    sentenceSay.stop();
    shadow.stop();
    pause();
  };

  /** 影子跟读的分段：从第一句起，连着的几句合起来不超过约 30 秒（每段至少一句），固定不变 */
  const shadowUnits = useMemo(() => {
    const units: number[][] = [];
    for (let i = 0; i < sentences.length; ) {
      const unit = [i];
      while (i + unit.length < sentences.length && endOf(sentences[i + unit.length]) - startOf(sentences[i]) <= SHADOW_UNIT_MS) unit.push(i + unit.length);
      units.push(unit);
      i += unit.length;
    }
    return units;
  }, [sentences]);
  /** 当前句所在的那段 */
  const unitIndex = Math.max(0, shadowUnits.findIndex((u) => u.includes(current)));

  /** 影子跟读第 k 段：连着放、整段录，放完评估 */
  const runShadow = async (k: number) => {
    const unit = shadowUnits[k];
    if (!unit) return;
    const token = ++flowToken.current;
    const alive = () => token === flowToken.current;
    sentenceSay.stop();
    setFlowing(true);
    setCurrent(unit[0]);
    await shadow.runUnit(unit, alive);
    if (alive()) setFlowing(false);
  };

  /** 逐句跟读：从第 from 句开始，播原声（设定的遍数）→ 跟读 → 评分；开着「读完自动下一句」时一句接一句；麦克风打不开时停下，原因写在那句下面 */
  const runFlow = async (from: number) => {
    const token = ++flowToken.current;
    // 遍数、读完自动下一句按最新的设置（跟读中途改了也生效）
    const alive = () => token === flowToken.current;
    sentenceSay.stop();
    setFlowing(true);
    for (let i = from; i < sentencesRef.current.length; i++) {
      setCurrent(i);
      for (let r = 0; r < prefsRef.current.shadowRepeat; r++) {
        if (r > 0) await sleep(400);
        if (!alive() || !(await playSentence(i)) || !alive()) return;
      }
      const outcome = await sentenceSay.run(i);
      if (!alive()) return;
      if (outcome === 'mic' || !prefsRef.current.autoNext || i + 1 >= sentencesRef.current.length) break;
      await sleep(outcome === 'scored' ? 1200 : 500);
      if (!alive()) return;
    }
    sentenceSay.release();
    setFlowing(false);
  };

  // 离开页面：跟读流程不再往下走
  useEffect(() => () => void (flowToken.current += 1), []);

  /** 连续播放（理解、盲听） */
  const playOn = () => {
    const v = videoRef.current;
    if (!v) return;
    // 句子后面的跟读还在录：先停（不然原声会被录进去）
    sentenceSay.stop();
    stopAt.current = null;
    playingSentence.current = null;
    sentencePlay.current = false;
    // 播完了再点：从头看
    if (v.duration && v.currentTime >= v.duration - 0.2) v.currentTime = 0;
    v.playbackRate = rateRef.current;
    void v.play().catch(() => {});
  };

  /** 从第 i 句开始连续播放（台词列表里点一句） */
  const playFrom = (i: number) => {
    sentenceSay.stop();
    seek(startOf(sentences[i]));
    stopAt.current = null;
    playingSentence.current = i;
    sentencePlay.current = false;
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rateRef.current;
    void v.play().catch(() => {});
  };

  /** 精听的当前句 */
  const clozeIndex = clozeOrder.includes(current) ? current : (clozeOrder[0] ?? 0);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (flowing) return stopFlow();
    if (!v.paused) return pause();
    if (mode === 'dictate') return void playSentence(clozeIndex);
    playOn();
  };

  /** 连续播放时「这一句」：正在播的那句，在两句之间时是刚播过的那句 */
  const sentenceAtNow = () => {
    if (active >= 0) return active;
    let i = 0;
    sentences.forEach((s, k) => {
      if (startOf(s) <= now) i = k;
    });
    return i;
  };

  /** 上一句 / 下一句（step = -1 / 1）：跟读、精听换当前句（影子跟读换段）；其余跳到那句开头接着播 */
  const stepSentence = (step: number) => {
    if (mode === 'dictate') {
      const k = clozeOrder.indexOf(clozeIndex) + step;
      if (k < 0 || k >= clozeOrder.length) return;
      setCurrent(clozeOrder[k]);
      seek(startOf(sentences[clozeOrder[k]]));
      return void playSentence(clozeOrder[k]);
    }
    if (mode === 'speak' && speakMode === 'shadow') {
      const unit = shadowUnits[unitIndex + step];
      return unit && pickSpeak(unit[0]);
    }
    if (mode === 'speak') return pickSpeak(Math.min(sentences.length - 1, Math.max(0, current + step)));
    const i = Math.min(sentences.length - 1, Math.max(0, sentenceAtNow() + step));
    playFrom(i);
  };

  /** 跟读换到第 i 句（不自动播放：「跟读」本身会先播原声） */
  const pickSpeak = (i: number) => {
    if (flowing) stopFlow();
    setCurrent(i);
    seek(startOf(sentences[i]));
  };

  /** 重听这句：只播这一句，播完停下 */
  const replaySentence = () => {
    if (mode === 'speak' && flowing) stopFlow();
    void playSentence(mode === 'dictate' ? clozeIndex : mode === 'speak' ? current : sentenceAtNow());
  };

  /** 进入全屏前窗口是不是已经是系统全屏（退出时恢复成原来的样子，不把用户自己开的全屏也关掉）；null 为没进过 */
  const windowWasFull = useRef<boolean | null>(null);
  const toggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    const win = getCurrentWindow();
    if (next) {
      void win
        .isFullscreen()
        .then((was) => {
          windowWasFull.current = was;
          if (!was) return win.setFullscreen(true);
        })
        .catch(() => {
          // 系统全屏不可用时只铺满窗口
        });
    } else {
      if (windowWasFull.current === false) void win.setFullscreen(false).catch(() => {});
      windowWasFull.current = null;
    }
  };
  // 用系统的方式退出全屏（绿色按钮）时跟着退出；离开页面时，自己打开的全屏退出
  useEffect(() => {
    if (!fullscreen) return;
    const onResize = () =>
      void getCurrentWindow()
        .isFullscreen()
        .then((on) => {
          // 进全屏的动画过程中也会触发：只在确实是我们开的、现在又不是全屏时跟着退出
          if (!on && windowWasFull.current === false) {
            windowWasFull.current = null;
            setFullscreen(false);
          }
        })
        .catch(() => {});
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fullscreen]);
  useEffect(
    () => () => {
      if (windowWasFull.current === false) void getCurrentWindow().setFullscreen(false).catch(() => {});
    },
    []
  );

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  // 快捷键：空格播放 / 暂停，← → 上一句 / 下一句，R 重听这句，M 静音，F 全屏，Esc 退出全屏（在输入框里不响应）
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  /** 面板根节点：快捷键只在焦点在页面空白处或面板里时响应（浮动面板、弹出列表都挂在 body 下，不在里面） */
  const rootRef = useRef<HTMLDivElement>(null);
  /** 这次按下的空格当成了播放 / 暂停：松开时拦下按钮的「点击」 */
  const spaceHandled = useRef(false);
  keys.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    if (t && t !== document.body && !rootRef.current?.contains(t)) return;
    if (t && (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]') || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    // 方向键在页签组、滑块、菜单里时是它们自己的操作
    if (k.startsWith('arrow') && t?.closest('[role="radio"], [role="tab"], [role="slider"], [role="menuitem"]')) return;
    // Esc 只在全屏时用来退出（不然句子分析等面板收不到 Esc）
    if (k === 'escape' && !fullscreen) return;
    const run = { ' ': togglePlay, arrowleft: () => stepSentence(-1), arrowright: () => stepSentence(1), r: replaySentence, m: () => setMuted((m) => !m), f: () => !sidePanel && toggleFullscreen(), escape: toggleFullscreen }[k];
    if (!run) return;
    e.preventDefault();
    if (k === ' ') spaceHandled.current = true;
    run();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !spaceHandled.current) return;
      spaceHandled.current = false;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  /** 换模式：停下正在播的、正在跟读的，不自动播放 */
  const changeMode = (next: Mode) => {
    if (next === mode) return;
    if (flowing) stopFlow();
    sentenceSay.stop();
    shadow.stopReplay();
    pause();
    setAnalyzing(null);
    setTeacherOpen(false);
    setMode(next);
    if (next === 'blind') {
      setCurrent(0);
      seek(0);
    } else if (next === 'dictate') {
      setCurrent(clozeIndex);
      seek(startOf(sentences[clozeIndex]));
    } else if (next === 'speak') {
      const i = Math.max(0, active);
      setCurrent(i);
      seek(startOf(sentences[i]));
    }
  };

  const sidePanel = mode === 'speak' || mode === 'dictate';
  /** 能遮住画面的模式（盲听、精听）与现在遮没遮 */
  const coverMode: CoverMode | null = mode === 'blind' || mode === 'dictate' ? mode : null;
  const covered = coverMode !== null && prefs.cover[coverMode];

  /** 实时播放位置（逐词高亮用；没在播时为 null） */
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const timeNowMs = useCallback(() => (playingRef.current && videoRef.current ? videoRef.current.currentTime * 1000 : null), []);

  /** 跟读卡片里的台词：和原文页签同一个组件（当前句放大、逐词高亮、聚焦、词汇与单词卡片） */
  const sentencesView = (indices: number[], focusBlur: boolean, withBelow: boolean) => (
    <ClipSentences
      sentences={sentences}
      indices={indices}
      current={playing && active >= 0 ? active : indices.length === 1 ? indices[0] : null}
      words={prefs.wordFocus && playing && active >= 0 ? (wordSpans[active] ?? null) : null}
      timeNowMs={timeNowMs}
      translation={prefs.translation === 'off' ? 'off' : 'all'}
      focusBlur={focusBlur}
      targets={targetWords}
      forms={forms}
      renderTarget={(text, target, on) => (
        <TargetWord
          text={text}
          target={target}
          active={on}
          word={wordInfo.get(target.toLowerCase())}
          speak={(w, slow) => wordAudio.speak(w, { slow, before: () => videoRef.current?.pause() })}
          onOpenCard={onOpenWord ? () => onOpenWord(target) : undefined}
        />
      )}
      below={withBelow ? below : undefined}
      onAnalyze={(i) => {
        setTeacherOpen(false);
        setAnalyzing(i);
      }}
      analyzing={analyzing}
    />
  );

  /** 影子跟读每句下面的结果 */
  const below = (i: number) => {
    const r = shadow.results.get(i);
    return r ? <ShadowLine text={sentences[i]?.en ?? ''} result={r} replaying={shadow.replaying === i} onReplay={() => shadow.replay(i)} /> : null;
  };

  const playLabel = flowing ? '停止跟读' : playing ? '暂停' : mode === 'dictate' ? '播放这一句' : '播放';

  const player = (
    <div className={cn('overflow-hidden rounded-xl bg-black', fullscreen && 'fixed inset-0 z-50 flex flex-col rounded-none')}>
      {/* 宽度不变，高度最多半屏多（画面在里面等比缩放、两边留黑），下面的内容第一眼看得到 */}
      <div className={cn('relative', fullscreen ? 'min-h-0 flex-1' : 'h-[min(56vh,56.25cqw)]')}>
        <video
          ref={videoRef}
          src={video.clipUrl}
          poster={video.posterUrl ?? undefined}
          className="size-full object-contain"
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            // 单句播放被别处暂停（如朗读目标词）：这一句算没播完，等着的跟读流程不会卡住
            if (stopAt.current !== null && sentencePlay.current) {
              if (videoRef.current) videoRef.current.playbackRate = rateRef.current;
              stopAt.current = null;
              sentencePlay.current = false;
              const done = originalDone.current;
              originalDone.current = null;
              done?.(false);
            }
          }}
          onSeeked={() => videoRef.current && setNow(videoRef.current.currentTime * 1000)}
          onLoadedMetadata={(e) => {
            trackPlayback(e.currentTarget);
            setDurationMs(e.currentTarget.duration * 1000);
          }}
          onClick={togglePlay}
          preload="auto"
        />
        {line && shown !== 'none' && !covered && (
          <div className="pointer-events-none absolute inset-x-6 bottom-5 text-center">
            <span className="inline-block rounded bg-black/70 px-3 py-1 text-lg leading-snug text-white">
              {shown !== 'zh' && line.en}
              {shown !== 'en' && line.zh && <span className={cn('block', shown === 'both' && 'text-sm text-white/80')}>{line.zh}</span>}
            </span>
          </div>
        )}
        {covered && (
          <button type="button" onClick={togglePlay} className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black text-white/60">
            <EyeOff className="size-8" />
            <span className="text-sm">画面已遮住，只听声音</span>
          </button>
        )}
      </div>
      <PlayerBar
        playing={flowing || playing}
        playLabel={playLabel}
        onToggle={togglePlay}
        onPrev={() => stepSentence(-1)}
        onReplay={replaySentence}
        onNext={() => stepSentence(1)}
        durationMs={durationMs || endOf(sentences[sentences.length - 1])}
        nowMs={now}
        sentences={sentences}
        active={active}
        onSeek={(ms) => {
          if (flowing) stopFlow();
          // 精听、跟读里是单句播放：拖进度条先停下，不然停句点被清掉后会一直往下播
          if (mode === 'dictate' || mode === 'speak') pause();
          seek(ms);
          if (mode === 'dictate' || mode === 'speak') {
            const i = sentences.findIndex((x) => startOf(x) <= ms && ms < endOf(x));
            if (i >= 0) setCurrent(i);
          }
        }}
        rate={rate}
        onRate={setRate}
        volume={volume}
        muted={muted}
        onVolume={setVolume}
        onMute={setMuted}
        subtitles={mode === 'understand' || mode === 'speak' ? prefs.subtitles : undefined}
        onSubtitles={(subtitles) => updatePrefs({ subtitles })}
        pauseEach={mode === 'understand' ? prefs.pauseEach : undefined}
        onPauseEach={(pauseEach) => updatePrefs({ pauseEach })}
        cover={coverMode ? prefs.cover[coverMode] : undefined}
        onCover={(on) => coverMode && updatePrefs({ cover: { ...prefs.cover, [coverMode]: on } })}
        fullscreen={fullscreen}
        onFullscreen={sidePanel ? undefined : toggleFullscreen}
      />
    </div>
  );

  /** 跟读：逐句（一次一句的卡片）/ 影子（台词列表，一段一段练） */
  const speakPanel =
    speakMode === 'repeat' ? (
      <SpeakCard
        sentence={sentencesView([current], false, false)}
        index={current}
        total={sentences.length}
        strip={sentences.map((_, i) => {
          const b = sentenceSay.band(i);
          return { index: i, status: b === 'recorded' ? 'done' : b, label: b ? { good: '读得很好', close: '还差一点', retry: '再试试', recorded: '已录' }[b] : undefined };
        })}
        onPick={pickSpeak}
        controls={{
          playing: playing && !flowing ? (sentenceSlow ? 'slow' : 'normal') : null,
          onPlay: (slow) => void playSentence(current, slow),
          onStopPlay: pause,
          flowing,
          assessing: Boolean(say.assessing),
          // 录音时「停止」就是读完了：结束录音去评分（开着读完自动下一句时接着下一句）
          onStop: () => (sentenceSay.listening ? sentenceSay.stop() : stopFlow()),
          onSay: () => void runFlow(current),
          sayTip: '先放原声，再录你读的并评分',
          showZh: prefs.translation !== 'off',
          onShowZh: (on) => updatePrefs({ translation: on ? 'all' : 'off' }),
          settings: <PrefsPopover prefs={prefs} onChange={updatePrefs} />,
        }}
        status={!flowing || sentenceSay.listening || say.assessing ? undefined : preparing || sentenceSay.recording ? '准备…' : '正在播原声'}
        result={sentenceSay.below(current, { stopButton: false })}
        notice={say.enabled && say.ready === false ? <ModelNotice downloading={Boolean(say.downloading)} onDownload={() => void say.download()} /> : undefined}
      />
    ) : (
      <ShadowCard
        sentences={sentencesView(shadowUnits[unitIndex] ?? [], prefs.sentenceFocus, true)}
        unitStart={shadowUnits[unitIndex]?.[0] ?? 0}
        unitIndex={unitIndex}
        unitCount={shadowUnits.length}
        strip={sentences.map((_, i) => {
          const r = shadow.results.get(i);
          if (!r) return { index: i, status: null };
          if (r.words.length === 0) return { index: i, status: 'done', label: '已录' };
          const said = r.words.filter((w) => w.said).length / r.words.length;
          return { index: i, status: said >= 0.9 ? 'good' : said >= 0.6 ? 'close' : 'retry', label: `跟上 ${Math.round(said * 100)}% 的词` };
        })}
        onPick={pickSpeak}
        onUnit={(k) => pickSpeak(shadowUnits[k][0])}
        controls={{
          playing: playing && !flowing ? (sentenceSlow ? 'slow' : 'normal') : null,
          onPlay: (slow) => {
            const unit = shadowUnits[unitIndex];
            if (unit) void playRange(unit[0], unit[unit.length - 1], slow);
          },
          onStopPlay: pause,
          flowing,
          assessing: shadow.phase === 'assessing',
          onStop: stopFlow,
          onSay: () => void runShadow(unitIndex),
          sayTip: '原声连着放，你同时跟着说',
          showZh: prefs.translation !== 'off',
          onShowZh: (on) => updatePrefs({ translation: on ? 'all' : 'off' }),
          settings: <PrefsPopover prefs={prefs} onChange={updatePrefs} />,
        }}
        status={!flowing ? undefined : shadow.phase === 'assessing' ? '正在评估…' : preparing || shadow.phase === 'arming' ? '准备…' : '跟着原声说'}
        notice={shadow.unscored ? <ModelNotice downloading={Boolean(say.downloading)} onDownload={() => void say.download()} /> : undefined}
        error={shadow.error}
      />
    );

  const tabs = (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup type="single" value={mode} onValueChange={(v) => v && changeMode(v as Mode)} variant="outline">
        {MODES.map(({ key, label, icon: Icon }) => (
          <ToggleGroupItem key={key} value={key} className="px-3">
            <Icon />
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );

  return (
    <div ref={rootRef} className="space-y-6">
      <div className={cn('grid items-stretch gap-6', sidePanel && 'grid-cols-[minmax(0,1fr)_380px]')}>
        <div className="@container flex flex-col gap-3">
          {player}
          {tabs}
        </div>

        {/* 右侧与左侧（视频 + 控制条 + 页签）同高，内容多时在里面滚动 */}
        {sidePanel && (
          <div className="relative min-h-[420px]">
            <Card className="absolute inset-0 flex flex-col gap-0 overflow-hidden p-0">
              {mode === 'speak' && (
                <div className="border-b px-3 py-2">
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={speakMode}
                    onValueChange={(v) => {
                      if (!v) return;
                      if (flowing) stopFlow();
                      updatePrefs({ speakMode: v as SpeakMode });
                    }}
                  >
                    <ToggleGroupItem value="repeat" className="px-2.5">
                      逐句跟读
                    </ToggleGroupItem>
                    <ToggleGroupItem value="shadow" className="px-2.5">
                      影子跟读
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}
              {/* 里面各自滚动：底部的换句导航固定 */}
              <div className="flex min-h-0 flex-1 flex-col">
                {mode === 'dictate' ? (
                  <DictationPanel
                    sentences={sentences}
                    order={clozeOrder}
                    index={clozeIndex}
                    onIndexChange={(i, play) => {
                      pause();
                      setCurrent(i);
                      seek(startOf(sentences[i]));
                      if (play) void playSentence(i);
                    }}
                    onPlay={(i, slow) => void playSentence(i, slow)}
                    onStop={pause}
                    playing={playing ? (sentenceSlow ? 'slow' : 'normal') : null}
                    vocab={targetWords}
                    level={prefs.blankLevel}
                    onLevel={(blankLevel) => {
                      updatePrefs({ blankLevel });
                      setDictation(new Map());
                    }}
                    results={dictation}
                    onResult={(i, r) => setDictation((m) => new Map(m).set(i, r))}
                    onReset={(indices) =>
                      setDictation((m) => {
                        const next = new Map(m);
                        indices.forEach((i) => next.delete(i));
                        return next;
                      })
                    }
                    onAddWord={onAddTarget && ((w) => onAddTarget(w, true))}
                    canAddWord={(w) => canAddTarget(w, targetWords)}
                  />
                ) : (
                  // 选中台词里的词可以加入词汇
                  <SelectionAction label="加入词汇" accept={(text) => Boolean(onAddTarget) && canAddTarget(text, targetWords)} onAction={(text) => onAddTarget?.(text)} className="flex min-h-0 flex-1 flex-col">
                    {speakPanel}
                  </SelectionAction>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
      {teacherOpen && <AiTeacherPanel word={passage.title} wordId={passageChatId(passage.id)} passage onClose={() => setTeacherOpen(false)} />}
      {analyzing !== null && (
        <SentenceAnalysisPanel passageId={passage.id} sentences={sentences} index={analyzing} onIndexChange={setAnalyzing} targets={targetWords} onAddTarget={onAddTarget && ((w, form) => onAddTarget(w, true, form))} onEditTranslation={onEditTranslation} onClose={() => setAnalyzing(null)} />
      )}
      {/* 讲解一直挂着（切到别的模式时隐藏），生成中切走也不中断 */}
      <div className={cn(mode !== 'understand' && 'hidden')}>
        <ClipGuide
          passageId={passage.id}
          teacherOpen={teacherOpen}
          onTeacher={toggleGuideTeacher}
        />
      </div>
    </div>
  );
};
