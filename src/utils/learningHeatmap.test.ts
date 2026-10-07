import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHeatmap, heatLevel, toLocalDateKey } from './learningHeatmap.ts';

test('等级按最大值四等分，0 为无学习', () => {
  assert.equal(heatLevel(0, 20), 0);
  assert.equal(heatLevel(1, 20), 1);
  assert.equal(heatLevel(5, 20), 1);
  assert.equal(heatLevel(6, 20), 2);
  assert.equal(heatLevel(20, 20), 4);
  assert.equal(heatLevel(3, 0), 0);
});

test('网格：周一开头，最后一列含今天，之后为 future', () => {
  const today = new Date(2026, 9, 7); // 2026-10-07 周三
  const grid = buildHeatmap(
    [
      { date: '2026-10-05', practiced_words: 10, mastered_words: 4 },
      { date: '2026-10-07', practiced_words: 5, mastered_words: 0 },
      { date: '2026-08-01', practiced_words: 99, mastered_words: 9 }, // 区间外
    ],
    today,
    2
  );
  assert.equal(grid.weeks.length, 2);
  assert.equal(grid.weeks[0][0].date, '2026-09-28'); // 第一列周一
  const last = grid.weeks[1];
  assert.equal(last[0].date, '2026-10-05');
  assert.equal(last[0].level, 4);
  assert.equal(last[2].isToday, true);
  assert.equal(last[2].level, 2);
  assert.equal(last[3].future, true);
  assert.equal(grid.activeDays, 2);
  assert.equal(grid.totalPracticed, 15);
  assert.deepEqual(grid.monthLabels, [{ column: 0, label: '9月' }, { column: 1, label: '10月' }]);
});

test('本地日期键', () => {
  assert.equal(toLocalDateKey(new Date(2026, 0, 5)), '2026-01-05');
});
