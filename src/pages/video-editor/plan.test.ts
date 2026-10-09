import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addSegment,
  autoSplit,
  cueBoundaries,
  cuesIn,
  emptySegment,
  mergeWithNext,
  moveEdge,
  pushHistory,
  redo,
  removeSegment,
  segmentIssues,
  snapTime,
  splitAt,
  undo,
  alignedOffset,
  nearestCue,
  segmentThumb,
  splitByKeyWords,
} from './plan.ts';
import type { Cue, VideoPlan } from '../../types/video';

const cue = (startMs: number, endMs: number, en = 'Hi'): Cue => ({ startMs, endMs, en, zh: '' });
const plan = (...ranges: [number, number][]): VideoPlan => ({
  requirements: '',
  segments: ranges.map(([a, b]) => emptySegment(a, b)),
});
const ranges = (p: VideoPlan) => p.segments.map((s) => [s.startMs, s.endMs]);

test('吸附到附近的字幕边界', () => {
  const b = cueBoundaries([cue(1000, 2000), cue(2000, 3500)]);
  assert.deepEqual(b, [1000, 2000, 3500]);
  assert.equal(snapTime(2300, b, 400), 2000);
  assert.equal(snapTime(2700, b, 400), 2700);
});

test('拆分：离两端太近不拆', () => {
  const p = plan([0, 10_000]);
  const { plan: split, rightId } = splitAt(p, 4000);
  assert.deepEqual(ranges(split), [[0, 4000], [4000, 10_000]]);
  assert.equal(split.segments[1].id, rightId);
  assert.equal(splitAt(p, 500).rightId, null);
  assert.equal(splitAt(p, 20_000).rightId, null);
});

test('合并：并进空隙，重点词去重', () => {
  const p = plan([0, 3000], [5000, 9000], [9000, 12_000]);
  p.segments[0].keyWords = ['menu'];
  p.segments[1].keyWords = ['menu', 'bill'];
  const merged = mergeWithNext(p, p.segments[0].id);
  assert.deepEqual(ranges(merged), [[0, 9000], [9000, 12_000]]);
  assert.deepEqual(merged.segments[0].keyWords, ['menu', 'bill']);
  // 最后一段没有后一段
  assert.equal(mergeWithNext(merged, merged.segments[1].id), merged);
});

test('拖动边界：不越过邻居、不短于最短长度、不出界，可吸附', () => {
  const p = plan([0, 5000], [8000, 12_000]);
  const [a, b] = p.segments;
  assert.deepEqual(ranges(moveEdge(p, a.id, 'end', 9500, 20_000)), [[0, 8000], [8000, 12_000]]);
  assert.deepEqual(ranges(moveEdge(p, b.id, 'start', 11_800, 20_000)), [[0, 5000], [11_000, 12_000]]);
  assert.deepEqual(ranges(moveEdge(p, b.id, 'end', 30_000, 20_000)), [[0, 5000], [8000, 20_000]]);
  const snapped = moveEdge(p, a.id, 'end', 6200, 20_000, { boundaries: [6000], withinMs: 400 });
  assert.deepEqual(ranges(snapped)[0], [0, 6000]);
});

test('新建片段只放在空隙里', () => {
  const p = plan([0, 5000], [8000, 12_000]);
  const added = addSegment(p, 4000, 9000);
  assert.ok(added);
  assert.deepEqual(ranges(added.plan), [[0, 5000], [5000, 8000], [8000, 12_000]]);
  assert.equal(addSegment(p, 1000, 4000), null);
});

test('删除', () => {
  const p = plan([0, 5000], [8000, 12_000]);
  assert.deepEqual(ranges(removeSegment(p, p.segments[0].id)), [[8000, 12_000]]);
});

test('片段里的字幕：重叠一半以上才算', () => {
  const cues = [cue(0, 2000), cue(4000, 6000), cue(9000, 11_000)];
  assert.equal(cuesIn(cues, { startMs: 0, endMs: 5000 }).length, 2);
  assert.equal(cuesIn(cues, { startMs: 0, endMs: 4500 }).length, 1);
});

test('自动切分：按停顿与长度分组，留白不重叠', () => {
  const cues = [cue(1000, 3000), cue(3200, 6000), cue(9000, 12_000), cue(12_100, 14_000), cue(30_000, 32_000)];
  const segs = autoSplit(cues, 40_000, { minMs: 4000, maxMs: 20_000 });
  assert.deepEqual(
    segs.map((s) => [s.startMs, s.endMs]),
    [[700, 6300], [8700, 14_300], [29_700, 32_300]]
  );
  // 长度上限：没有停顿也会切
  const dense = Array.from({ length: 10 }, (_, i) => cue(i * 3000, i * 3000 + 2900));
  assert.ok(autoSplit(dense, 40_000, { minMs: 1000, maxMs: 9000 }).length >= 3);
});

test('片段问题', () => {
  const s = emptySegment(0, 5000);
  assert.deepEqual(segmentIssues(s, []), ['short', 'no-subtitles', 'untitled']);
  const ok = { ...emptySegment(0, 60_000), title: '点餐' };
  assert.deepEqual(segmentIssues(ok, [cue(1000, 3000)]), []);
});

test('撤销与重做', () => {
  const a = plan([0, 1000]);
  const b = plan([0, 2000]);
  let h = { past: [], present: a, future: [] };
  h = pushHistory(h, b);
  assert.equal(undo(h).present, a);
  assert.equal(redo(undo(h)).present, b);
  assert.equal(undo(undo(h)).present, a);
});

test('时间显示', async () => {
  const { formatClock } = await import('./time.ts');
  assert.equal(formatClock(62_345), '1:02.3');
  assert.equal(formatClock(3_723_000, false), '1:02:03');
  assert.equal(formatClock(-5), '0:00.0');
});

test('片段预览图取中间那一刻', () => {
  const thumbs = ['a', 'b', 'c', 'd'];
  assert.equal(segmentThumb(thumbs, 10_000, { startMs: 0, endMs: 20_000 }), 'b');
  assert.equal(segmentThumb(thumbs, 10_000, { startMs: 50_000, endMs: 90_000 }), 'd');
  assert.equal(segmentThumb([], 10_000, { startMs: 0, endMs: 1 }), undefined);
});

test('对齐字幕：让这句从播放头开始', () => {
  // 字幕显示在 5s，实际 6.2s 才开口：字幕要延后 1.2s
  assert.equal(alignedOffset(0, 5000, 6200), 1200);
  assert.equal(alignedOffset(1200, 6200, 5900), 900);
  const cues = [cue(1000, 2000, 'a'), cue(5000, 6000, 'b')];
  assert.equal(nearestCue(cues, 4200)?.en, 'b');
});

test('句子里标出重点词与变形', () => {
  const parts = splitByKeyWords('She ordered the menu. Orders!', ['order', 'menu']);
  assert.deepEqual(
    parts.filter((p) => p.key).map((p) => p.text),
    ['ordered', 'menu', 'Orders']
  );
  assert.equal(splitByKeyWords('Hello', []).length, 1);
  assert.deepEqual(splitByKeyWords('a piece of cake', ['piece of cake']).filter((p) => p.key).map((p) => p.text), ['piece of cake']);
  assert.equal(splitByKeyWords('Careful', ['car']).filter((p) => p.key).length, 0);
});
