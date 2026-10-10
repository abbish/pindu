import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScanText, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { activeWordIndex, targetSpans, tokenize, type TargetSpan } from '@/utils/passage';
import type { WordTiming } from '@/services/ttsService';
import type { PassageSentence } from '@/types/passage';

/** 翻译显示：off 不显示 / current 只显示正在读的句子 / all 全部 */
export type TranslationMode = 'off' | 'current' | 'all';

export interface PassageReaderProps {
  sentences: PassageSentence[];
  /** 翻译显示方式（默认不显示） */
  translation?: TranslationMode;
  /** 目标词：加粗标出、可点击（renderTarget）、读到时提示 */
  highlight?: string[];
  /** 正在朗读的句子（放大、逐词高亮） */
  current?: number | null;
  /** 「当前句翻译」显示哪一句（暂停后仍显示刚读的那句；默认同 current） */
  focus?: number | null;
  /** 当前句的逐词时间（有则逐词高亮） */
  words?: WordTiming[] | null;
  /** 实时播放位置（毫秒；没在播放返回 null） */
  timeNowMs?: () => number | null;
  /** 点击句子朗读这一句；不传则句子不可点 */
  onPlaySentence?: (index: number) => void;
  /** 自定义一句英文的渲染（如选词填空的空位、听后回忆的空位）；返回 undefined 时按默认渲染 */
  renderSentence?: (index: number) => React.ReactNode | undefined;
  /** 包装目标词（如点击弹出单词卡片）；`active` 为正在读到这个词 */
  renderTarget?: (text: string, target: string, active: boolean) => React.ReactNode;
  /** 盲听：只显示句子位置，不显示文字 */
  hidden?: boolean;
  /** 渲染在某句下方的内容（如听后回忆） */
  below?: (index: number) => React.ReactNode;
  /** 聚焦朗读：朗读时当前句最清晰，上下文按距离逐渐模糊变淡（悬停的句子恢复清晰） */
  focusBlur?: boolean;
  /** 句子分析：每句右侧的分析按钮；不传则不显示 */
  onAnalyzeSentence?: (index: number) => void;
  /** 正在看分析的句子（标出来） */
  analyzing?: number | null;
  /** 跟随当前句时只滚动这个容器（如视频旁的台词框），不带动整页；默认滚动页面 */
  scrollContainer?: React.RefObject<HTMLElement | null>;
}

/** 聚焦朗读：与当前句相隔 1 / 2 / 3+ 句的模糊与透明度 */
const FOCUS_LEVELS = ['', 'opacity-60 blur-[1px]', 'opacity-35 blur-[2px]', 'opacity-20 blur-[3px]'];

/**
 * 当前句：按播放位置逐词高亮（每帧读实时位置，只有换词时才重新渲染）；读到目标词时放大提示。
 */
const LiveSentence: React.FC<{
  text: string;
  targets: string[];
  words?: WordTiming[] | null;
  timeNowMs?: () => number | null;
  renderTarget?: PassageReaderProps['renderTarget'];
}> = ({ text, targets, words, timeNowMs, renderTarget }) => {
  const tokens = useMemo(() => tokenize(text), [text]);
  const wordCount = tokens.filter((t) => t.kind === 'word').length;
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (!words?.length || !timeNowMs) return setActive(null);
    let frame = 0;
    const tick = () => {
      const t = timeNowMs();
      setActive((prev) => {
        const next = t == null ? prev : activeWordIndex(words, t, wordCount);
        return next === prev ? prev : next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [words, timeNowMs, wordCount]);

  return <>{renderTokens(tokens, targets, active, renderTarget)}</>;
};

function renderTokens(tokens: ReturnType<typeof tokenize>, targets: string[], active: number | null, renderTarget?: PassageReaderProps['renderTarget']) {
  // 目标词片段（词组覆盖多个单词，整体标出、整体可点）
  const spans = targets.length ? targetSpans(tokens, targets) : new Map<number, TargetSpan>();
  const out: React.ReactNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'other') {
      out.push(<React.Fragment key={i}>{t.text}</React.Fragment>);
      continue;
    }
    const span = spans.get(t.index);
    // 词组：把从这个词到片段最后一个词之间的所有片段（含空格、插入的宾语）合成一个
    let text = t.text;
    let last = i;
    if (span && span.end - span.start > 1) {
      while (last + 1 < tokens.length) {
        const next = tokens[last + 1];
        if (next.kind === 'word' && next.index >= span.end) break;
        last += 1;
        text += next.text;
      }
      // 结尾多吞进来的空格 / 标点还给后面
      const trailing = text.match(/[^A-Za-z]+$/)?.[0] ?? '';
      if (trailing) text = text.slice(0, text.length - trailing.length);
      const isActive = active !== null && active >= span.start && active < span.end;
      out.push(<React.Fragment key={i}>{renderTarget ? renderTarget(text, span.target, isActive) : <TargetText text={text} active={isActive} />}</React.Fragment>);
      if (trailing) out.push(<React.Fragment key={`${i}-t`}>{trailing}</React.Fragment>);
      i = last;
      continue;
    }
    const target = span?.target ?? null;
    const isActive = active === t.index;
    const word = (
      <span
        key={i}
        className={cn(
          'inline-block rounded-sm transition-[transform,background-color,color] duration-150',
          target && 'font-semibold text-warning underline decoration-overdue decoration-wavy decoration-2 underline-offset-[5px]',
          isActive && 'relative z-10 inline-block -mx-0.5 scale-[1.15] rounded-md bg-primary px-0.5 text-primary-foreground no-underline shadow-sm',
          isActive && target && 'ring-2 ring-warning ring-offset-1 ring-offset-background'
        )}
      >
        {t.text}
      </span>
    );
    out.push(target && renderTarget ? <React.Fragment key={i}>{renderTarget(t.text, target, isActive)}</React.Fragment> : word);
  }
  return out;
}

/** 没有 renderTarget 时词组的标出样式 */
const TargetText: React.FC<{ text: string; active: boolean }> = ({ text, active }) => (
  <span className={cn('rounded-sm font-semibold text-warning underline decoration-overdue decoration-wavy decoration-2 underline-offset-[5px]', active && 'bg-primary/15')}>{text}</span>
);

/**
 * 短文正文：逐句排版；正在读的句子放大并逐词高亮，读到目标词时放大提示；目标词可点击（renderTarget）。
 * 支持翻译显示方式、盲听（隐藏文字）、聚焦朗读（上下文渐隐模糊）和句下插槽（听后回忆）。正文可选中复制。
 */
export const PassageReader: React.FC<PassageReaderProps> = ({
  sentences,
  translation = 'off',
  highlight = [],
  current,
  focus,
  words,
  timeNowMs,
  onPlaySentence,
  renderSentence,
  renderTarget,
  hidden,
  below,
  focusBlur = false,
  scrollContainer,
  onAnalyzeSentence,
  analyzing,
}) => {
  const rows = useRef<(HTMLDivElement | null)[]>([]);

  // 朗读到的句子滚到视野中间（只在换句时滚动）
  useEffect(() => {
    if (current == null) return;
    const row = rows.current[current];
    const box = scrollContainer?.current;
    if (!row) return;
    if (box) {
      const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      box.scrollTo({ top: top - box.clientHeight / 2 + row.clientHeight / 2, behavior: 'smooth' });
    } else {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [current, scrollContainer]);

  return (
    <div className="flex flex-col gap-1 text-[17px] leading-relaxed select-text">
      {sentences.map((s, i) => {
        const active = current === i;
        // 盲听时不叠加模糊；只在正在朗读（current 有值）时生效
        const focusLevel = focusBlur && !hidden && current != null ? Math.min(Math.abs(i - current), FOCUS_LEVELS.length - 1) : 0;
        const showZh = !hidden && (translation === 'all' || (translation === 'current' && (focus ?? current) === i));
        let body: React.ReactNode;
        const custom = hidden ? undefined : renderSentence?.(i);
        if (hidden) {
          body = (
            <span
              className={cn('my-2 block h-2.5 rounded-full bg-muted', active && 'bg-primary/40')}
              style={{ width: `${Math.min(100, 20 + s.en.length * 1.1)}%` }}
              aria-label={`第 ${i + 1} 句`}
            />
          );
        } else if (custom !== undefined) {
          body = custom;
        } else if (active) {
          body = <LiveSentence text={s.en} targets={highlight} words={words} timeNowMs={timeNowMs} renderTarget={renderTarget} />;
        } else {
          body = renderTokens(tokenize(s.en), highlight, null, renderTarget);
        }
        return (
          <div
            key={i}
            ref={(el) => {
              rows.current[i] = el;
            }}
            className={cn('group flex items-start gap-2 rounded-md px-2 py-1 transition-colors', s.paragraph && i > 0 && 'mt-3', active && 'bg-accent py-2', onPlaySentence && !active && 'hover:bg-muted/60', analyzing === i && 'ring-2 ring-primary/40')}
            aria-current={active ? 'true' : undefined}
          >
            {onPlaySentence && (
              <button
                type="button"
                onClick={() => onPlaySentence(i)}
                aria-label={`朗读第 ${i + 1} 句`}
                className={cn(
                  'mt-1.5 shrink-0 rounded-sm text-muted-foreground opacity-0 outline-none transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active && 'mt-2 text-primary opacity-100'
                )}
              >
                <Volume2 className={cn('size-4', active && 'size-5')} />
              </button>
            )}
            <div
              className={cn(
                'min-w-0 flex-1',
                focusBlur && 'transition-[filter,opacity] duration-300 motion-reduce:transition-none',
                focusLevel > 0 && cn(FOCUS_LEVELS[focusLevel], 'group-hover:opacity-100 group-hover:blur-none')
              )}
            >
              {/* 正在朗读的句子放大加粗，便于跟读 */}
              <div className={cn('transition-[font-size] duration-200', active && !hidden && 'text-[22px] leading-snug font-medium text-accent-foreground')}>{body}</div>
              {showZh && <p className={cn('text-sm leading-relaxed text-muted-foreground', active && 'mt-1 text-[15px]')}>{s.zh}</p>}
              {below?.(i)}
            </div>
            {onAnalyzeSentence && !hidden && (
              <button
                type="button"
                onClick={() => onAnalyzeSentence(i)}
                aria-label={`分析第 ${i + 1} 句`}
                title="句子分析"
                className={cn(
                  'mt-1.5 shrink-0 rounded-sm text-muted-foreground opacity-0 outline-none transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  analyzing === i && 'text-primary opacity-100'
                )}
              >
                <ScanText className="size-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
