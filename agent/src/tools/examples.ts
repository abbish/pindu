// 例句生成任务工具：submit_examples。复用拼读分析的例句校验，不合格返回错误让模型修正后重交。

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { examplesProblems } from "./phonics.ts";

export const submitExamplesTool = defineTool({
  name: "submit_examples",
  label: "提交例句",
  description:
    "Submit the new example sentences for the word in one call. The submission is validated; if it returns errors, fix only the listed problems and call again.",
  parameters: Type.Object({
    word: Type.String(),
    examples: Type.Array(
      Type.Object({
        sentence: Type.String({ description: "short, simple English sentence for kids containing the word" }),
        translation: Type.String({ description: "natural Chinese translation of the sentence" }),
      }),
      { description: "5-8 NEW example sentences in different everyday scenes, simplest first" },
    ),
  }),
  async execute(_toolCallId, params) {
    const problems = examplesProblems(params.word, params.examples, `「${params.word.trim()}」`);
    if (problems.length > 0) {
      throw new Error(`提交未通过校验（${problems.length} 处），请修正后重新提交：\n- ${problems.join("\n- ")}`);
    }
    return {
      content: [{ type: "text", text: `Accepted ${params.examples.length} examples.` }],
      details: params,
      terminate: true,
    };
  },
});
