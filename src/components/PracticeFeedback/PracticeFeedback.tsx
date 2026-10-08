import React from 'react';
import { CircleCheckBig, PenLine } from 'lucide-react';
import { Kbd } from '@/components/Kbd/Kbd';
import { cn } from '@/lib/utils';

/** 一次作答的反馈 */
export interface PracticeFeedbackData {
  /** 每次作答唯一，用于重新播放入场动画 */
  id: number;
  /** 答对 / 答错（进入纠正）/ 纠正完成 */
  type: 'correct' | 'incorrect' | 'fixed';
  /** 正确拼写 */
  answer: string;
  /** 出错的拼读块（答错时） */
  wrongChunks?: string[];
  /** 这个词稍后再考一次（答错时） */
  willRetry?: boolean;
}

export interface PracticeFeedbackProps {
  /** 当前反馈；null 时不显示 */
  feedback: PracticeFeedbackData | null;
}

const PRAISES = ['答对了！', '太棒了！', '真厉害！', '完全正确！'];

/**
 * 练习作答反馈：浮在练习卡片输入区上方的轻提示，不占布局。
 * 答对一闪而过；答错时说明错在哪一块，直到改正为止。
 */
export const PracticeFeedback: React.FC<PracticeFeedbackProps> = ({ feedback }) => {
  if (!feedback) return null;
  const { type } = feedback;
  const wrong = type === 'incorrect';
  const title = type === 'correct' ? PRAISES[feedback.id % PRAISES.length] : type === 'fixed' ? '改对了！' : '拼错了，查一查';
  const chunks = feedback.wrongChunks ?? [];
  const Icon = wrong ? PenLine : CircleCheckBig;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center px-6" role="status" aria-live="polite">
      <div
        key={feedback.id}
        className={cn(
          'flex max-w-xl items-center gap-3 rounded-xl border px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-2',
          wrong ? 'border-warning/40 bg-warning-soft text-warning' : 'border-success/40 bg-success-soft text-success'
        )}
      >
        <Icon className="size-5 shrink-0" />
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{title}</span>
          {wrong && (
            <span className="text-sm opacity-90">
              {chunks.length > 0 ? (
                <>
                  注意{' '}
                  {chunks.map((c, i) => (
                    <strong key={i} className="mx-0.5 rounded bg-background/60 px-1 font-mono">{c}</strong>
                  ))}{' '}
                  这{chunks.length > 1 ? '几' : '一'}处，照着正确拼写再打一遍
                </>
              ) : (
                <>
                  照着正确拼写 <strong className="font-mono">{feedback.answer}</strong> 再打一遍
                </>
              )}
              {feedback.willRetry && <span className="ml-1">· 稍后还会再考一次</span>}
            </span>
          )}
        </div>
        {!wrong && (
          <span className="ml-2 inline-flex shrink-0 items-center gap-1 text-xs">
            <Kbd>Enter</Kbd> 继续
          </span>
        )}
      </div>
    </div>
  );
};
