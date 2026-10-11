import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insideRoots, skillRoots } from "./skillRead.ts";

test("read 只能读 skill 目录里的文件", () => {
  const base = mkdtempSync(join(tmpdir(), "skill-read-"));
  const skill = join(base, "skills", "tutor-vocabulary");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "x");
  writeFileSync(join(base, "secret.txt"), "x");
  symlinkSync(join(base, "secret.txt"), join(skill, "link.md"));
  const roots = skillRoots(skill);

  assert.ok(insideRoots(join(skill, "SKILL.md"), "/", roots));
  assert.ok(insideRoots("SKILL.md", skill, roots), "相对路径按工作目录解析");
  assert.ok(!insideRoots(join(skill, "..", "..", "secret.txt"), "/", roots), "不能用 .. 跳出");
  assert.ok(!insideRoots(join(skill, "link.md"), "/", roots), "不能用符号链接跳出");
  assert.ok(!insideRoots(join(base, "secret.txt"), "/", roots));
  assert.ok(!insideRoots("", "/", roots));
});
