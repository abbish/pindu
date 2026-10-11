import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMaterial, resolveFile } from "./material.ts";

test("resolveFile 只认工作目录里的文件，去掉路径部分", () => {
  const dir = mkdtempSync(join(tmpdir(), "material-"));
  writeFileSync(join(dir, "a.png"), "x");
  assert.equal(resolveFile("a.png", dir), join(dir, "a.png"));
  assert.equal(resolveFile("/etc/../a.png", dir), join(dir, "a.png"));
  assert.throws(() => resolveFile("../../etc/passwd", dir));
  assert.throws(() => resolveFile(".hidden", dir));
});

test("checkMaterial：至少要有短文或词汇，句子必须是英文", () => {
  const empty = { passages: [], phrases: [], vocabulary: [] };
  assert.match(checkMaterial(empty) ?? "", /Nothing was submitted/);
  assert.equal(checkMaterial({ ...empty, vocabulary: [{ word: "gate" }] }), null);
  assert.match(checkMaterial({ ...empty, passages: [{ sentences: [{ en: "你好" }] }] }) ?? "", /not English/);
  assert.equal(checkMaterial({ ...empty, passages: [{ sentences: [{ en: "Hello there.", zh: "你好。" }] }] }), null);
});
