import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, pinduDetails, titlePrompt } from "./tutor.ts";

test("MCP 结果里取出拼读给界面的部分", () => {
  const redlark = { step: "查了你的词汇本", output: { kind: "wordbook", id: 3 } };
  assert.deepEqual(pinduDetails({ content: [], structuredContent: { data: {}, redlark } }), redlark);
  assert.equal(pinduDetails({ content: [] }), undefined);
  assert.equal(pinduDetails(undefined), undefined);
});

test("对话标题：去掉引号、前缀和句末标点，限制长度", () => {
  assert.equal(cleanTitle("「登机讲义整理成词汇本」。"), "登机讲义整理成词汇本");
  assert.equal(cleanTitle("标题：itinerary 查词\n多余"), "itinerary 查词");
  assert.equal(cleanTitle("一二三四五六七八九十一二三四五六七八"), "一二三四五六七八九十一二三四五六");
  assert.ok(titlePrompt("看看这个\n\n〔附件：讲义.pdf〕").includes("（附带了文件）"));
});
