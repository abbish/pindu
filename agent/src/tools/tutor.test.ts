import { test } from "node:test";
import assert from "node:assert/strict";
import { DECLINED_REASON, gateDecision, normalizeReplies, pinduDetails, suggestRepliesTool, VIEW_ONLY_REASON } from "./tutor.ts";

test("MCP 结果里取出拼读给界面的部分", () => {
  const redlark = { step: "查了你的词汇本", output: { kind: "wordbook", id: 3 } };
  assert.deepEqual(pinduDetails({ content: [], structuredContent: { data: {}, redlark } }), redlark);
  assert.equal(pinduDetails({ content: [] }), undefined);
  assert.equal(pinduDetails(undefined), undefined);
});

test("推荐下一步：结构化交给界面，并结束这一轮", async () => {
  const result = await suggestRepliesTool.execute("1", { replies: ["再来一个例句", "考考我"] } as never, undefined, undefined, {} as never);
  assert.equal(result.terminate, true);
  assert.deepEqual((result.details as { redlark: { suggestions: string[] } }).redlark.suggestions, ["再来一个例句", "考考我"]);
});

test("改动前把关按 AI 老师的权限：默认只问删除，可改为改动都问或只查看", () => {
  const read = { readOnlyHint: true };
  const change = { readOnlyHint: false, destructiveHint: false };
  const remove = { readOnlyHint: false, destructiveHint: true };
  assert.deepEqual([read, change, remove].map(h => gateDecision(undefined, h)), ["allow", "allow", "confirm"]);
  assert.deepEqual([read, change, remove].map(h => gateDecision("ask_delete", h)), ["allow", "allow", "confirm"]);
  assert.deepEqual([read, change, remove].map(h => gateDecision("ask_changes", h)), ["allow", "confirm", "confirm"]);
  assert.deepEqual([read, change, remove].map(h => gateDecision("view_only", h)), ["allow", "block", "block"]);
  // 没有注解的当作改动
  assert.equal(gateDecision("view_only", undefined), "block");
});

test("推荐下一步的参数：写法偏差在校验前整理好，最多 3 条", () => {
  assert.deepEqual(normalizeReplies({ item: "帮我翻一句话" }), ["帮我翻一句话"]);
  assert.deepEqual(normalizeReplies({ replies: ["讲几个难词", "出几道题考我", "写篇短文", "建个计划"] }), ["讲几个难词", "出几道题考我", "写篇短文"]);
  assert.deepEqual(normalizeReplies({ items: [" 考考我 ", "", "考考我", 3] }), ["考考我"]);
  assert.deepEqual(normalizeReplies(undefined), []);
  // replies 是空的、给了别的写法：接着看下一个
  assert.deepEqual(normalizeReplies({ replies: [], item: "考考我" }), ["考考我"]);
  // 太长的截到 30 个字（不为长度再来一轮）
  assert.equal(normalizeReplies({ replies: ["很".repeat(40)] })[0].length, 30);
});

test("拦下时的说明：界面按开头认出没同意 / 只查看（与 src/utils/tutorTranscript.ts 的 TOOL_OUTCOMES 一致）", () => {
  assert.ok(DECLINED_REASON.startsWith("The learner did not confirm"));
  assert.ok(VIEW_ONLY_REASON.startsWith("The learner set the AI teacher to view only"));
});
