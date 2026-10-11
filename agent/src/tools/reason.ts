// 工具调用意图：给工具加一个必填参数 reason，模型用一句话写给学习者看「这一步要做什么」，
// 界面在工具执行时显示它（取自工具调用参数）；执行前拿掉，工具本身不用关心。
// 拼读 MCP 服务的工具在服务端做同样的事（src-tauri/src/mcp/reason.rs，说明文字保持一致）。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type TObject, type TSchema } from "typebox";

export const REASON_DESCRIPTION =
  "One short sentence in Chinese telling the learner what this step is for, e.g. 「查一下你学过的机场英语词」. Shown to the learner as the step's progress text; no ids, tool names or English jargon.";

/** 同名工具，参数多一个必填的 reason；执行时去掉 reason 再交给原工具 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 任意工具的 details / state 类型
export function withReason<T extends ToolDefinition<TSchema, any, any>>(tool: T): T {
  const params = tool.parameters as unknown as TObject;
  return {
    ...tool,
    parameters: Type.Object({ reason: Type.String({ description: REASON_DESCRIPTION }), ...params.properties }),
    execute(id, args, ...rest) {
      const original = { ...((args ?? {}) as Record<string, unknown>) };
      delete original.reason;
      return tool.execute(id, original as never, ...rest);
    },
  } as T;
}
