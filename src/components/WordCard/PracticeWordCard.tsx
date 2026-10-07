import React, { useEffect, useRef, useState } from 'react';
import type { WordExample } from '../../types';
import { FULL_REVEAL, maskLetters, writeReveal, type HintLevel, type RevealLevel } from '../../utils/practiceReveal';
import type { LetterMark } from '../../utils/spellingCheck';
import { hasNonLatin } from '../../utils/imeEnter';
import { useImeGuard } from '../../hooks/useImeGuard';
import { ArrowRight, Check, EyeOff, HelpCircle, Keyboard, Languages, Lock, MessageSquareText, Pencil, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface PracticeWordData {
  /** 单词ID */
  id: number;
  /** 英文单词 */
  word: string;
  /** 中文释义 */
  meaning: string;
  /** 详细描述 */
  description?: string;
  /** IPA音标 */
  ipa?: string;
  /** 音节分割 */
  syllables?: string;
  /** 自然拼读分割 */
  phonicsSegments?: string[];
  /** 图片URL */
  imageUrl?: string;
  /** 例句（按顺序，第一句最简单；练习页右栏展示） */
  examples?: WordExample[];
}

/**
 * 卡片所处环节：
 * - look：看·说（全部信息可见，发音时拼读块逐块亮起）
 * - write：盖·写（按提示等级收起信息）
 * - feedback：答对（全部揭晓）
 * - correction：查（标出错字母，照着正确拼写重打一遍）
 */
export type PracticeStage = 'look' | 'write' | 'feedback' | 'correction';

export interface PracticeWordCardProps {
  /** 单词数据 */
  word: PracticeWordData;
  /** 当前环节 */
  stage: PracticeStage;
  /** 「盖-写」时的提示等级 */
  hintLevel: HintLevel;
  /** 标题与说明 */
  stepTitle: string;
  stepDescription: string;
  /** 用户输入值 */
  userInput: string;
  /** 输入变化回调 */
  onInputChange: (value: string) => void;
  /** 提交（盖·写时为作答，纠正时为重打） */
  onSubmitAnswer: (userInput: string) => void;
  /** 看·说结束：盖住单词开始写 */
  onCover?: () => void;
  /** 播放发音回调 */
  onPlayPronunciation?: () => void;
  /** 答对后按 Enter：跳过等待，直接进入下一题 */
  onContinue?: () => void;
  /** 纠正时：正确单词逐字母的对错 */
  marks?: LetterMark[];
  /** 看·说时正在读到的拼读块下标 */
  activeChunk?: number | null;
  /** 禁用状态 */
  disabled?: boolean;
}

/** 顶部「看-说-盖-写-查」环节条 */
const ROUTINE: { key: string; label: string; stages: PracticeStage[] }[] = [
  { key: 'look', label: '看', stages: ['look'] },
  { key: 'say', label: '说', stages: ['look'] },
  { key: 'cover', label: '盖', stages: ['write'] },
  { key: 'write', label: '写', stages: ['write'] },
  { key: 'check', label: '查', stages: ['feedback', 'correction'] },
];
const STAGE_ORDER: PracticeStage[] = ['look', 'write', 'feedback'];

const PLACEHOLDER: Record<PracticeStage, string> = {
  look: '先看一看、读一读，记住后点「盖住，开始写」',
  write: '凭记忆拼出单词…',
  feedback: '',
  correction: '照着上面的正确拼写再打一遍…',
};

/** 被收起的信息：保留位置，说明“答完显示” */
const Locked: React.FC = () => (
  <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
    <Lock className="size-3.5" />
    这一步先藏起来，答完显示
  </span>
);

/** 字母格：每个字母一个格子，保留分隔符（用于单词提示） */
const LetterSlots: React.FC<{ text: string }> = ({ text }) => (
  <span className="flex flex-wrap items-end justify-center gap-1.5" aria-label={`${text.replace(/[^A-Za-z]/g, '').length} 个字母`}>
    {[...text].map((ch, i) =>
      /[A-Za-z]/.test(ch) ? (
        <span key={i} className="h-12 w-9 border-b-[3px] border-border" />
      ) : (
        <span key={i} className="px-0.5 text-2xl text-muted-foreground">{ch === ' ' ? '\u00a0' : ch}</span>
      )
    )}
  </span>
);

/** 自己会响应 Enter 的控件（焦点在这些上面时不走窗口级 Enter） */
const INTERACTIVE_SELECTOR =
  'button, a[href], input, textarea, select, [contenteditable="true"], [role="button"], [role="tab"], [role="menuitem"], [role="dialog"], [role="alertdialog"]';

/** 信息行：标签 + 值 */
const InfoRow: React.FC<{ label: string; wide?: boolean; children: React.ReactNode }> = ({ label, wide, children }) => (
  <div className={cn('flex min-w-0 items-baseline gap-3 rounded-lg bg-muted/40 px-3 py-2', wide && 'col-span-2')}>
    <span className="w-8 shrink-0 text-xs text-muted-foreground">{label}</span>
    <span className="min-w-0 flex-1 select-text">{children}</span>
  </div>
);

/**
 * 单词练习卡片：按「看-说-盖-写-查」组织；版面在各环节保持一致，只改变每项信息给多少。
 */
export const PracticeWordCard: React.FC<PracticeWordCardProps> = ({
  word,
  stage,
  hintLevel,
  stepTitle,
  stepDescription,
  userInput,
  onInputChange,
  onSubmitAnswer,
  onCover,
  onPlayPronunciation,
  onContinue,
  marks,
  activeChunk = null,
  disabled = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  /** 输入法选词时的回车不提交 */
  const { compositionHandlers, isImeEnter } = useImeGuard();
  /** 输入里混入了中文等字符：提示切换到英文输入法 */
  const [imeWarning, setImeWarning] = useState(false);
  const reveal = stage === 'write' ? writeReveal(hintLevel) : FULL_REVEAL;
  const segments = word.phonicsSegments ?? [];
  const letterCount = word.word.replace(/[^A-Za-z]/g, '').length;

  // 环节切换时把焦点放到该操作的位置：写 / 纠正 → 输入框；看·说不放焦点（Enter / 空格由窗口级快捷键处理，
  // 焦点停在「盖住」按钮上时空格会被按钮当成点击）
  useEffect(() => {
    if (stage === 'look') inputRef.current?.blur();
    else if (stage === 'write' || stage === 'correction') inputRef.current?.focus();
  }, [stage, word.id]);

  /** 提交前检查：混入非英文字符时不提交，提示切换输入法 */
  const submit = () => {
    const answer = userInput.trim();
    if (!answer || disabled) return;
    if (hasNonLatin(answer)) {
      setImeWarning(true);
      return;
    }
    onSubmitAnswer(answer);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (isImeEnter(e)) return;
    if (stage === 'feedback') {
      onContinue?.();
    } else if (stage === 'write' || stage === 'correction') {
      submit();
    }
  };

  const handleSubmit = submit;

  // 窗口级快捷键（不依赖焦点）：看·说 Enter 盖住、空格朗读；答对后 Enter 下一题。
  // 焦点在按钮、输入框、对话框等控件上时由控件自己处理按键，避免重复触发。
  const keyActionsRef = useRef<{ enter?: () => void; space?: () => void }>({});
  keyActionsRef.current =
    stage === 'look'
      ? { enter: onCover, space: onPlayPronunciation }
      : stage === 'feedback'
        ? { enter: onContinue }
        : {};
  const windowKeys = stage === 'look' || stage === 'feedback';
  useEffect(() => {
    if (!windowKeys || disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR)) return;
      const action = e.key === 'Enter' ? keyActionsRef.current.enter : e.key === ' ' ? keyActionsRef.current.space : undefined;
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [windowKeys, disabled]);

  // 换题 / 换环节时清除输入法提示
  useEffect(() => {
    setImeWarning(false);
  }, [stage, word.id]);

  const renderValue = (level: RevealLevel, full: React.ReactNode, hint: React.ReactNode) =>
    level === 'show' ? full : level === 'hint' ? hint : <Locked />;

  const currentOrder = STAGE_ORDER.indexOf(stage === 'correction' ? 'feedback' : stage);

  return (
    <Card className="gap-5 p-6">
      {/* 标题 + 「看-说-盖-写-查」环节条 */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">{stepTitle}</h3>
          <p className="text-sm text-muted-foreground">{stepDescription}</p>
        </div>
        <ol className="flex shrink-0 gap-1.5" aria-label="看-说-盖-写-查">
          {ROUTINE.map((item) => {
            const active = item.stages.includes(stage);
            const order = Math.min(...item.stages.map((st) => STAGE_ORDER.indexOf(st === 'correction' ? 'feedback' : st)));
            const done = !active && order < currentOrder;
            return (
              <li
                key={item.key}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex size-9 items-center justify-center rounded-lg text-sm font-semibold',
                  active ? 'bg-primary text-primary-foreground' : done ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                {item.label}
              </li>
            );
          })}
        </ol>
      </div>

      {/* 单词信息：各环节同一布局 */}
      <div className="flex flex-col items-center gap-4">
        <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center">
          {stage === 'correction' && marks ? (
            <>
              <h1 className="font-mono text-5xl font-bold tracking-wide" aria-label={word.word}>
                {marks.map((m, i) => (
                  <span
                    key={i}
                    className={cn(
                      m.status === 'wrong' && 'text-destructive',
                      m.status !== 'ok' && m.status !== 'wrong' && 'text-warning underline decoration-[3px] underline-offset-8'
                    )}
                  >
                    {m.char}
                  </span>
                ))}
              </h1>
              <span className="text-sm text-muted-foreground">
                <span className="font-medium text-destructive">红色</span>是写错的字母，<span className="font-medium text-warning underline">下划线</span>是漏掉的字母
              </span>
            </>
          ) : reveal.word === 'show' ? (
            <h1 className={cn('text-5xl font-bold tracking-wide select-text', stage === 'feedback' && 'text-success')}>{word.word}</h1>
          ) : reveal.word === 'hint' ? (
            <>
              <LetterSlots text={word.word} />
              <span className="text-sm text-muted-foreground">单词盖住了：共 {letterCount} 个字母</span>
            </>
          ) : (
            <>
              <span className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <HelpCircle className="size-8" />
              </span>
              <span className="text-sm text-muted-foreground">听发音、看中文，把整个单词拼出来</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="lg" onClick={onPlayPronunciation} title="播放发音（空格）" aria-keyshortcuts="Space">
            <Volume2 />
            播放发音
          </Button>
          {stage === 'look' && segments.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <MessageSquareText className="size-4" /> 跟着读：{segments.join(' - ')}
            </span>
          )}
        </div>

        <div className="grid w-full grid-cols-2 gap-2 text-sm">
          <InfoRow label="音标">{renderValue(reveal.ipa, <span>{word.ipa || '—'}</span>, null)}</InfoRow>
          <InfoRow label="音节">
            {renderValue(
              reveal.syllables,
              <span className="font-mono">{word.syllables || '—'}</span>,
              <span className="font-mono tracking-widest text-muted-foreground">{maskLetters(word.syllables || word.word)}</span>
            )}
          </InfoRow>
          <InfoRow label="释义" wide>
            <span className="text-base font-medium">{word.meaning}</span>
          </InfoRow>
          {word.description && (
            <InfoRow label="详解" wide>
              <span className="text-muted-foreground">{word.description}</span>
            </InfoRow>
          )}
          <InfoRow label="拼读" wide>
            {segments.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              renderValue(
                reveal.phonics,
                <span className="flex flex-wrap gap-1.5">
                  {segments.map((segment, index) => (
                    <span
                      key={index}
                      className={cn(
                        'rounded-md px-2 py-0.5 font-mono text-base font-semibold transition-colors',
                        activeChunk === index ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground'
                      )}
                    >
                      {segment}
                    </span>
                  ))}
                </span>,
                <span className="flex flex-wrap gap-1.5">
                  {segments.map((segment, index) => (
                    <span key={index} className="rounded-md bg-muted px-2 py-0.5 font-mono text-base tracking-widest text-muted-foreground">
                      {maskLetters(segment)}
                    </span>
                  ))}
                </span>
              )
            )}
          </InfoRow>
        </div>
      </div>

      {/* 输入区域：输入框与操作按钮同一行 */}
      <div className="space-y-2 border-t pt-5">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Keyboard className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={userInput}
              onChange={(e) => {
                if (disabled) return;
                onInputChange(e.target.value);
                if (imeWarning && !hasNonLatin(e.target.value)) setImeWarning(false);
              }}
              onKeyDown={handleKeyDown}
              {...compositionHandlers}
              lang="en"
              inputMode="text"
              autoCapitalize="off"
              placeholder={PLACEHOLDER[stage]}
              aria-label="拼写单词"
              className={cn(
                'h-14 w-full rounded-xl border-2 bg-background pr-4 pl-11 font-mono text-2xl font-semibold tracking-wider outline-none transition-colors select-text placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60',
                stage === 'feedback' && 'border-success text-success',
                stage === 'correction' && 'border-warning'
              )}
              disabled={disabled || stage === 'look'}
              readOnly={stage === 'feedback'}
              autoComplete="off"
              spellCheck="false"
            />
          </div>

          {stage === 'look' ? (
            <Button
              size="lg"
              className="h-14 px-6"
              onClick={onCover}
              // 按住 Enter 的连发不算盖住（防止从上一题带过来）
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.repeat) e.preventDefault();
              }}
            >
              <EyeOff />
              盖住，开始写
            </Button>
          ) : stage === 'feedback' ? (
            <Button size="lg" className="h-14 px-6" onClick={onContinue}>
              下一题
              <ArrowRight />
            </Button>
          ) : (
            <Button size="lg" className="h-14 px-6" onClick={handleSubmit} disabled={!userInput.trim() || disabled}>
              {stage === 'correction' ? <Pencil /> : <Check />}
              {stage === 'correction' ? '改正' : '确认'}
            </Button>
          )}
        </div>
        {imeWarning && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-warning" role="alert">
            <Languages className="size-3.5" /> 输入里有中文，请切换到英文输入法再拼写
          </span>
        )}
      </div>
    </Card>
  );
};
