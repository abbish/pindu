import React from 'react';
import { JobPanel } from '@/components/Jobs';
import type { Job } from '@/types/job';

export interface PlanningProgressProps {
  /** AI 排序任务（job-updated 推送；刚提交时可能还没有） */
  job: Job | undefined;
  /** 停止排序（页面同时回到可编辑状态） */
  onCancel: () => void;
}

/** AI 排学习顺序的进度：统一的任务进度面板；离开页面会停止（结果只给这个页面用），所以没有「在后台继续」 */
export const PlanningProgress: React.FC<PlanningProgressProps> = ({ job, onCancel }) => (
  <JobPanel job={job} title="AI 正在排学习顺序" actions={{ stop: onCancel }} />
);
