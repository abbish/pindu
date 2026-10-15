import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUN = join(AGENT_DIR, "node_modules", "bun", "bin", "bun.exe");

test("单文件程序里，编译机器上的 Photon wasm 路径不存在时读嵌入的那份（正式版 AI 老师发不了图片）", () => {
  const out = join(mkdtempSync(join(tmpdir(), "photon-wasm-")), process.platform === "win32" ? "fixture.exe" : "fixture");
  execFileSync(BUN, ["build", "--compile", join("src", "photon-wasm.fixture.ts"), "--outfile", out], { cwd: AGENT_DIR, stdio: "pipe" });
  const result = JSON.parse(execFileSync(out, { cwd: tmpdir() }).toString());
  assert.deepEqual(result, { valid: true, other: "ENOENT" });
});
