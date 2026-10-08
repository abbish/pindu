/** 后台任务（对应 src-tauri/src/jobs.rs 的 Job，camelCase） */

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 「打开」结果时跳转的页面（navigation.ts 的页面键与参数） */
export interface JobLink {
  page: string;
  params: unknown;
}

export interface Job {
  id: string;
  /** 任务类型，如 word_analysis、plan_ordering */
  kind: string;
  title: string;
  status: JobStatus;
  /** 当前阶段的说明 */
  stage: string | null;
  current: number;
  /** 0 表示进度不确定 */
  total: number;
  /** 离开发起页面后继续（结果由后端写库）；false 的任务结果只给发起页面用 */
  detached: boolean;
  link: JobLink | null;
  /** 运行中的细节（形状由任务类型决定） */
  detail: unknown;
  /** 任务产出（形状由任务类型决定） */
  result: unknown;
  /** 失败原因，形状同 IPC 错误 */
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const isJobActive = (job: Pick<Job, 'status'>) => job.status === 'queued' || job.status === 'running';
