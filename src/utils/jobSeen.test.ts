import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultJobsTab, isJobUnseen, JOBS_PAGE } from './jobSeen.ts';
import type { Job } from '../types/job.ts';

const at = (sec: number) => new Date(Date.UTC(2026, 9, 11, 12, 0, sec)).toISOString();
const ms = (sec: number) => Date.parse(at(sec));
const job = (status: Job['status'], finishedSec: number | null, module: Job['module'] = 'wordbooks') => ({
  status,
  module,
  finishedAt: finishedSec == null ? null : at(finishedSec),
});

test('结束晚于打开应用、两处都没看过：没看过', () => {
  assert.equal(isJobUnseen(job('succeeded', 10), new Map(), ms(0)), true);
});

test('打开应用前结束的、进行中的都不算没看过', () => {
  assert.equal(isJobUnseen(job('failed', 10), new Map(), ms(20)), false);
  assert.equal(isJobUnseen(job('running', null), new Map(), ms(0)), false);
});

test('在所属模块或任务页任何一处看过就算看过', () => {
  assert.equal(isJobUnseen(job('failed', 10), new Map([['wordbooks', ms(15)]]), ms(0)), false);
  assert.equal(isJobUnseen(job('failed', 10), new Map([[JOBS_PAGE, ms(15)]]), ms(0)), false);
  // 看的是别的模块不算
  assert.equal(isJobUnseen(job('failed', 10), new Map([['videos', ms(15)]]), ms(0)), true);
  // 看过之后又结束的还是没看过
  assert.equal(isJobUnseen(job('failed', 20), new Map([['wordbooks', ms(15)]]), ms(0)), true);
});

test('没有所属模块的任务只看任务页', () => {
  assert.equal(isJobUnseen(job('succeeded', 10, null), new Map([['wordbooks', ms(15)]]), ms(0)), true);
  assert.equal(isJobUnseen(job('succeeded', 10, null), new Map([[JOBS_PAGE, ms(15)]]), ms(0)), false);
});

test('任务页默认页签：进行中优先，否则跟着最近结束的任务', () => {
  assert.equal(defaultJobsTab([]), 'active');
  assert.equal(defaultJobsTab([job('failed', 5), job('running', null)]), 'active');
  assert.equal(defaultJobsTab([job('succeeded', 5), job('failed', 9)]), 'failed');
  assert.equal(defaultJobsTab([job('failed', 5), job('cancelled', 9)]), 'done');
});
