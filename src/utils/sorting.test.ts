import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byInstant, byNumber, byText, sortItems, type SortOption } from './sorting.ts';

interface Item {
  name: string;
  n: number | null;
  at: string | null;
}
const items: Item[] = [
  { name: '第10课', n: 3, at: '2026-10-01T00:00:00.000Z' },
  { name: '第2课', n: null, at: null },
  { name: 'apple', n: 8, at: '2026-10-05T00:00:00.000Z' },
];
const OPTIONS: SortOption<Item>[] = [
  { value: 'recent', label: '最近', compare: byInstant((i) => i.at) },
  { value: 'name', label: '名称', compare: byText((i) => i.name) },
  { value: 'n', label: '数量', compare: byNumber((i) => i.n) },
  { value: 'n-asc', label: '数量少', compare: byNumber((i) => i.n, false) },
];
const names = (list: Item[]) => list.map((i) => i.name);

test('时刻新的在前，没有时刻的在最后', () => {
  assert.deepEqual(names(sortItems(items, OPTIONS, 'recent')), ['apple', '第10课', '第2课']);
});

test('名称里的数字按大小排', () => {
  const sorted = names(sortItems(items, OPTIONS, 'name'));
  assert.ok(sorted.indexOf('第2课') < sorted.indexOf('第10课'));
});

test('数值升降序都把空值放最后', () => {
  assert.deepEqual(names(sortItems(items, OPTIONS, 'n')), ['apple', '第10课', '第2课']);
  assert.deepEqual(names(sortItems(items, OPTIONS, 'n-asc')), ['第10课', 'apple', '第2课']);
});

test('未知排序项用第一项，不改原数组', () => {
  const before = names(items);
  assert.deepEqual(names(sortItems(items, OPTIONS, 'nope')), ['apple', '第10课', '第2课']);
  assert.deepEqual(names(items), before);
});
