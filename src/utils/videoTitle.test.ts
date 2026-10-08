import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromFileName } from './videoTitle.ts';

test('文件名去掉发布标记作为标题', () => {
  assert.equal(titleFromFileName('/a/Article.15.2019.1080p.WEBRip.x264.AAC5.1-[YTS.MX].mp4'), 'Article 15 2019');
  assert.equal(titleFromFileName('C:\\v\\Friends_S01E01.mkv'), 'Friends S01E01');
  assert.equal(titleFromFileName('lesson one.mp4'), 'lesson one');
});
