import React, { useMemo } from 'react';
import { PassageReader, type TranslationMode } from '@/components/PassageReader';
import type { TargetForms } from '@/utils/passage';
import type { PassageSentence } from '@/types/passage';
import type { WordSpan } from '@/types/video';

export interface ClipSentencesProps {
  sentences: PassageSentence[];
  /** 要显示的句子（句子序号） */
  indices: number[];
  /** 当前句（句子序号）：放大、逐词高亮；不在 indices 里或为 null 时都正常显示 */
  current: number | null;
  /** 当前句每个词的时间（逐词高亮）；不给时不高亮 */
  words: WordSpan[] | null;
  /** 实时播放位置（毫秒，相对短片；没在播返回 null） */
  timeNowMs: () => number | null;
  translation: TranslationMode;
  /** 聚焦：当前句之外的句子按距离模糊变淡 */
  focusBlur: boolean;
  targets: string[];
  forms: TargetForms;
  renderTarget: (text: string, target: string, active: boolean) => React.ReactNode;
  /** 句子下面的内容（句子序号） */
  below?: (index: number) => React.ReactNode;
  onAnalyze?: (index: number) => void;
  analyzing?: number | null;
}

/**
 * 跟读卡片里的台词：直接用原文页签的 PassageReader（当前句放大、逐词高亮、聚焦模糊、词汇标记与单词卡片都和原文一致），
 * 只显示要练的几句，序号在这里换算。
 */
export const ClipSentences: React.FC<ClipSentencesProps> = ({ sentences, indices, current, words, timeNowMs, translation, focusBlur, targets, forms, renderTarget, below, onAnalyze, analyzing }) => {
  const shown = useMemo(() => indices.map((i) => sentences[i]).filter(Boolean), [indices, sentences]);
  const local = current === null ? -1 : indices.indexOf(current);
  return (
    <PassageReader
      sentences={shown}
      current={local >= 0 ? local : null}
      words={local >= 0 ? words : null}
      timeNowMs={timeNowMs}
      translation={translation}
      focusBlur={focusBlur}
      highlight={targets}
      highlightForms={forms}
      renderTarget={renderTarget}
      below={below && ((k) => below(indices[k]))}
      onAnalyzeSentence={onAnalyze && ((k) => onAnalyze(indices[k]))}
      analyzing={analyzing == null ? null : indices.indexOf(analyzing)}
    />
  );
};
