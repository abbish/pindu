// 编译进 sidecar 的全部 RedLark 工具；每个任务由 Rust 通过 --tools 白名单只开放自己需要的工具。
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { submitExamplesTool } from "./examples.ts";
import { submitGradeTool, submitPassagePlanTool, submitPassageTool, submitQuestionsTool, submitTranslationTool } from "./passage.ts";
import { submitPhonicsTool } from "./phonics.ts";
import { submitVideoPlanTool } from "./video.ts";
import { submitLearningOrderTool } from "./planning.ts";
import { submitGeneratedWordsTool, submitWordsTool, tokenizeTextTool } from "./words.ts";

export const REDLARK_TOOLS = [tokenizeTextTool, submitWordsTool, submitGeneratedWordsTool, submitPhonicsTool, submitLearningOrderTool, submitExamplesTool, submitPassagePlanTool, submitPassageTool, submitQuestionsTool, submitGradeTool, submitTranslationTool, submitVideoPlanTool];

export default function redlarkTools(pi: ExtensionAPI) {
  for (const tool of REDLARK_TOOLS) pi.registerTool(tool);
}
