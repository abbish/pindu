import { test } from "node:test";
import assert from "node:assert/strict";
import { gateDecision, pinduDetails, suggestRepliesTool } from "./tutor.ts";

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
