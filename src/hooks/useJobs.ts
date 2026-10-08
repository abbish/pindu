import { useEffect, useRef, useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { jobService } from '../services/jobService';
import { isJobActive, type Job } from '../types/job';

/**
 * 后台任务的全局状态（模块级单例，同 useUpdater 的写法）：启动时取一次列表，之后只听后端的 `job-updated` 事件。
 * - useJobs：全部任务（顶栏按钮、任务面板）
 * - useJob(id)：发起页面订阅自己的任务；订阅期间这个任务算「有人在看」，完成时不再弹全局提示
 * - waitForJob(id)：等任务结束（结果只给页面用的前台任务）
 * - useOnJobFinished(cb)：任务结束时回调（如单词本详情页在分析任务结束后刷新列表）
 */

let jobs: Job[] = [];
let sheetOpen = false;
const listeners = new Set<() => void>();
const watched = new Map<string, number>();
const waiters = new Map<string, ((job: Job) => void)[]>();
const finishListeners = new Set<(job: Job) => void>();
let started = false;

function notify() {
  listeners.forEach((l) => l());
}

function upsert(job: Job) {
  const index = jobs.findIndex((j) => j.id === job.id);
  const wasActive = index === -1 || isJobActive(jobs[index]);
  jobs = index === -1 ? [job, ...jobs] : jobs.map((j, i) => (i === index ? job : j));
  notify();
  if (!isJobActive(job)) {
    if (wasActive) finishListeners.forEach((l) => l(job));
    waiters.get(job.id)?.forEach((resolve) => resolve(job));
    waiters.delete(job.id);
  }
}

/** 开始同步（App 启动时调用一次） */
export async function startJobSync() {
  if (started) return;
  started = true;
  await listen<Job>('job-updated', (event) => upsert(event.payload));
  const result = await jobService.list();
  if (!result.success) return;
  // 列表与事件可能交错：以事件为准，只补上本地没有的
  const known = new Set(jobs.map((j) => j.id));
  jobs = [...jobs, ...result.data.filter((j) => !known.has(j.id))];
  notify();
}

/** 等任务结束（成功 / 失败 / 取消） */
export function waitForJob(id: string): Promise<Job> {
  const current = jobs.find((j) => j.id === id);
  if (current && !isJobActive(current)) return Promise.resolve(current);
  return new Promise((resolve) => waiters.set(id, [...(waiters.get(id) ?? []), resolve]));
}

/** 是否有页面正在看这个任务（有就不弹完成提示） */
export function isJobWatched(id: string) {
  return (watched.get(id) ?? 0) > 0;
}

/** 从列表移除（只改本地；后端由调用方同步） */
export function forgetJobs(ids: string[]) {
  jobs = jobs.filter((j) => !ids.includes(j.id));
  notify();
}

export function setJobsSheetOpen(open: boolean) {
  sheetOpen = open;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useJobs(): Job[] {
  return useSyncExternalStore(subscribe, () => jobs);
}

export function useJobsSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, () => sheetOpen);
}

/** 订阅一个任务；id 为空时返回 undefined */
export function useJob(id: string | null | undefined): Job | undefined {
  useEffect(() => {
    if (!id) return;
    watched.set(id, (watched.get(id) ?? 0) + 1);
    return () => {
      const n = (watched.get(id) ?? 1) - 1;
      if (n <= 0) watched.delete(id);
      else watched.set(id, n);
    };
  }, [id]);
  return useSyncExternalStore(subscribe, () => (id ? jobs.find((j) => j.id === id) : undefined));
}

/** 任务结束（成功 / 失败 / 取消）时回调；回调可以随渲染变化，不需要稳定引用 */
export function useOnJobFinished(callback: (job: Job) => void) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    const listener = (job: Job) => ref.current(job);
    finishListeners.add(listener);
    return () => {
      finishListeners.delete(listener);
    };
  }, []);
}
