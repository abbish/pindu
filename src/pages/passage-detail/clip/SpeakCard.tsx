import React from 'react';
import type { SentenceStripProps } from './SentenceStrip';
import { PracticeCard, type PracticeControls } from './PracticeCard';

export interface SpeakCardProps {
  /** 第几句（从 0 开始）与一共几句 */
  index: number;
  total: number;
  strip: SentenceStripProps['items'];
  onPick: (index: number) => void;
  controls: PracticeControls;
  /** 放原声、准备开麦时的状态（录音、评分的状态在结果框里） */
  status?: string;
  /** 这一句（ClipSentences：和原文页签同样的显示） */
  sentence: React.ReactNode;
  /** 这句的跟读结果（逐词标色、三档、怎么读、听我的录音） */
  result: React.ReactNode;
  /** 评估模型没下载时的提示 */
  notice?: React.ReactNode;
}

/**
 * 逐句跟读：一次只练一句；「跟读」= 播原声 → 开麦录你说（停顿一下自动结束）→ 本机评分，
 * 结果留在下面；进度条按每句的结果着色，点哪段练哪句。「读完自动下一句」在控制条的练习设置里。
 */
export const SpeakCard: React.FC<SpeakCardProps> = (p) => (
  <PracticeCard
    position={`第 ${p.index + 1} / ${p.total} 句`}
    strip={p.strip}
    stripCurrent={p.index}
    onPick={p.onPick}
    status={p.status}
    controls={p.controls}
    prevLabel="上一句"
    nextLabel="下一句"
    onPrev={p.index > 0 ? () => p.onPick(p.index - 1) : undefined}
    onNext={p.index + 1 < p.total ? () => p.onPick(p.index + 1) : undefined}
  >
    {p.notice}
    {p.sentence}
    {p.result}
  </PracticeCard>
);
