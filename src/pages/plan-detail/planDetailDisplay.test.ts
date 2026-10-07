import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTimeProgress, getActionConfig, groupPlanActions } from './planDetailDisplay';

const day = (s: string) => new Date(`${s}T12:00:00`);

test('时间进度：未设置日期为 0，开始前为 0，结束后为 100', () => {
  assert.equal(calculateTimeProgress(null, '2026-10-10', day('2026-10-05')), 0);
  assert.equal(calculateTimeProgress('2026-10-01', '2026-10-10', day('2026-09-30')), 0);
  assert.equal(calculateTimeProgress('2026-10-01', '2026-10-10', day('2026-10-11')), 100);
});

test('时间进度：开始日为 0，按自然日线性增长（含首尾共 10 天）', () => {
  assert.equal(calculateTimeProgress('2026-10-01', '2026-10-10', day('2026-10-01')), 0);
  assert.equal(calculateTimeProgress('2026-10-01', '2026-10-10', day('2026-10-06')), 50);
  assert.equal(calculateTimeProgress('2026-10-01', '2026-10-10', day('2026-10-10')), 90);
});

test('操作文案与分组；危险操作标记为 danger', () => {
  assert.equal(getActionConfig('publish').label, '发布计划');
  assert.equal(getActionConfig('pause').tone, 'menu');
  assert.equal(getActionConfig('terminate').tone, 'danger');
  assert.equal(getActionConfig('unknown').label, 'unknown');
});

test('页头操作：主操作在前；暂停 / 标记完成进菜单；终止 / 删除是破坏性操作；不出现恢复 / 永久删除', () => {
  assert.deepEqual(groupPlanActions(['delete'], 'Pending'), { primary: [], menu: [], danger: ['delete'] });
  assert.deepEqual(groupPlanActions(['pause', 'complete', 'terminate', 'delete'], 'Active'), {
    primary: [],
    menu: ['pause', 'complete'],
    danger: ['terminate', 'delete'],
  });
  assert.deepEqual(groupPlanActions(['resume', 'complete', 'terminate', 'delete'], 'Paused').primary, ['resume']);
  assert.deepEqual(groupPlanActions(['restore', 'permanentDelete'], 'Deleted'), { primary: [], menu: [], danger: [] });
});
