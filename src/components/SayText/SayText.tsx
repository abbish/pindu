import React from 'react';
import { cn } from '@/lib/utils';
import type { Assessment } from '@/types/pronunciation';
import { BAND_LABEL, BAND_STYLE, bandOf, sentencePieces, sentenceTips, type Band, type Strictness } from '@/utils/pronunciation';

/** 逐词标色：读得好的不标，还差一点的下划线，再试试的底色 */
const WORD_MARK: Record<Band, string> = {
  good: '',
  close: 'underline decoration-warning decoration-2 underline-offset-4',
  retry: 'rounded bg-warning-soft text-warning',
};

/** 跟读一句后，按评估结果逐词标色的句子（没有结果时原样显示） */
export const SayText: React.FC<{ text: string; result: Assessment | null; strictness: Strictness; className?: string }> = ({ text, result, strictness, className }) => {
  if (!result) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {sentencePieces(text, result.words, strictness).map((p, i) => (
        <span key={i} className={p.band ? WORD_MARK[p.band] : undefined}>
          {p.text}
        </span>
      ))}
    </span>
  );
};

/** 跟读一句的结果：三档（可带分数）+ 最该练的一两个词怎么读 */
export const SayVerdict: React.FC<{ result: Assessment; strictness: Strictness; showScore: boolean; className?: string }> = ({ result, strictness, showScore, className }) => {
  if (result.score === null) return null;
  const band = bandOf(result.score, strictness);
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground', className)}>
      <span className={cn('rounded-full px-2.5 py-0.5 font-semibold', BAND_STYLE[band])}>
        {BAND_LABEL[band]}
        {showScore ? ` · ${result.score}` : ''}
      </span>
      {sentenceTips(result.words, strictness).map((t) => (
        <span key={t.word}>
          <span className="font-medium text-foreground">{t.word}</span>：{t.tip}
        </span>
      ))}
    </div>
  );
};
