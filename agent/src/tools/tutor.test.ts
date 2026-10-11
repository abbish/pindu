import { test } from "node:test";
import assert from "node:assert/strict";
import { pinduDetails, suggestRepliesTool } from "./tutor.ts";

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
