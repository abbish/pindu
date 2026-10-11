// 编译进 sidecar 的全部 RedLark 工具；每个任务由 Rust 通过 --tools 白名单只开放自己需要的工具。
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { submitExamplesTool } from "./examples.ts";
import { MATERIAL_TOOLS } from "./material.ts";
import { submitGradeTool, submitPassagePlanTool, submitPassageTool, submitQuestionsTool, submitTargetWordsTool, submitTranslationTool } from "./passage.ts";
import { submitPhonicsTool } from "./phonics.ts";
import { submitSentenceAnalysisTool } from "./sentence.ts";
import { submitPlanSuggestionsTool, submitSubtitlesTool, submitVideoPlanTool } from "./video.ts";
import { submitLearningOrderTool } from "./planning.ts";
import { askUserTool, registerPindu } from "./tutor.ts";
import { registerSkillRead } from "./skillRead.ts";
import { submitGeneratedWordsTool, submitTopicSuggestionsTool, submitWordsTool, tokenizeTextTool } from "./words.ts";

export const REDLARK_TOOLS = [tokenizeTextTool, submitWordsTool, submitGeneratedWordsTool, submitPhonicsTool, submitLearningOrderTool, submitExamplesTool, submitPassagePlanTool, submitPassageTool, submitQuestionsTool, submitGradeTool, submitTranslationTool, submitVideoPlanTool, submitPlanSuggestionsTool, submitSubtitlesTool, submitSentenceAnalysisTool, submitTopicSuggestionsTool, submitTargetWordsTool, ...MATERIAL_TOOLS, askUserTool];

export default function redlarkTools(pi: ExtensionAPI) {
  for (const tool of REDLARK_TOOLS) pi.registerTool(tool);
  // 带 skills 的任务：pi 的 read 只能读 skill 目录
  registerSkillRead(pi);
  // AI 老师：拼读给了 MCP 服务地址时接入（其它任务不带这个环境变量）
  registerPindu(pi);
}
