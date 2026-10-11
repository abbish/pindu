// 让模型能读 skills：pi 只有在 read（或 bash）可用时才把 skills 写进系统提示词（core/system-prompt.js）。
// 带 skills 的任务开放 pi 的 read，但用 pi 的 tool_call 处理器（权限控制的标准做法）限定只能读 skill 目录里的文件——
// 导入的素材内容不可信，不能让它诱导模型读别的文件。允许的目录由拼读经 REDLARK_SKILL_DIRS 给出（路径分隔符分开）。
import { realpathSync } from "node:fs";
import { delimiter, isAbsolute, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 允许 read 的目录（真实路径） */
export function skillRoots(value = process.env.REDLARK_SKILL_DIRS): string[] {
  return (value ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map(dir => {
      try {
        return realpathSync(dir);
      } catch {
        return resolve(dir);
      }
    });
}

/** 这个路径是否在允许的目录里（解析符号链接与 ..） */
export function insideRoots(path: string, cwd: string, roots: string[]): boolean {
  if (!path) return false;
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  let real: string;
  try {
    real = realpathSync(absolute);
  } catch {
    return false;
  }
  return roots.some(root => real === root || real.startsWith(root + sep));
}

export function registerSkillRead(pi: ExtensionAPI) {
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "read") return;
    const path = String((event.input as { path?: unknown }).path ?? "");
    if (insideRoots(path, ctx.cwd, skillRoots())) return;
    return { block: true, reason: "read can only open skill files (SKILL.md and files next to it). Use the material tools for the learner's files." };
  });
}
