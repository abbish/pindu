// 学习计划任务工具：submit_learning_order。模型只给出学习顺序与每词难度 / 优先级，日程由 RedLark 计算（DECISIONS D13）。
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const submitLearningOrderTool = defineTool({
  name: "submit_learning_order",
  label: "提交学习顺序",
  description:
    "Submit ALL words once, in the order the student should learn them (first = learned first), each with difficulty 1-5 and priority. Never print the list as text.",
  parameters: Type.Object({
    order: Type.Array(
      Type.Object({
        id: Type.Integer({ description: "word id exactly as given" }),
        difficulty: Type.Integer({ minimum: 1, maximum: 5, description: "1 = easiest for a Chinese primary-school student" }),
        priority: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
      }),
    ),
  }),
  async execute(_toolCallId, params) {
    if (params.order.length === 0) throw new Error("order 为空：请按学习顺序提交全部单词");
    const ids = params.order.map(o => o.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicates.length > 0) {
      throw new Error(`以下 id 重复出现，请每个单词只出现一次后重新提交：${[...new Set(duplicates)].join(", ")}`);
    }
    return {
      content: [{ type: "text", text: `Accepted ${params.order.length} words.` }],
      details: params,
      terminate: true,
    };
  },
});
