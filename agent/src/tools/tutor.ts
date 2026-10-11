// AI 老师独立对话：ask_user（问学习者，经 pi 的扩展 UI 交给拼读界面）与拼读 MCP 服务的接入。
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MATERIAL_TOOLS } from "./material.ts";
import { withReason } from "./reason.ts";

/**
 * 回答末尾推荐学习者接下来可以说的话：模型调用一次，界面显示成按钮；调用后这一轮直接结束（pi 的 terminate），不再多一次回复。
 * 结构化交付，不从回答正文里解析。
 */
export const suggestRepliesTool = defineTool({
  name: "suggest_replies",
  label: "推荐下一步",
  description:
    "Call once at the very end of every reply, after your answer text: 2-3 short things the learner could say next (in Chinese, in the learner's own voice, at most 20 characters each, only things you can actually do). This ends your turn.",
  parameters: Type.Object({
    replies: Type.Array(Type.String({ maxLength: 30 }), { minItems: 1, maxItems: 3 }),
  }),
  async execute(_id, { replies }) {
    return {
      content: [{ type: "text", text: "Shown to the learner." }],
      details: { redlark: { suggestions: replies } },
      terminate: true,
    };
  },
});

/** 给对话起标题（第一轮回答时由模型起，存成 pi 的会话名；已经有名字（含学习者改过的）时不覆盖） */
function nameConversationTool(pi: ExtensionAPI) {
  return defineTool({
    name: "name_conversation",
    label: "给对话起标题",
    description:
      "In your first reply of a conversation, give it a short Chinese title (at most 12 characters) summarizing what the learner wants. It does not end your turn.",
    parameters: Type.Object({ title: Type.String({ minLength: 1, maxLength: 20 }) }),
    async execute(_id, { title }) {
      if (!pi.getSessionName()) pi.setSessionName(title.trim());
      return { content: [{ type: "text", text: "Named." }], details: undefined };
    },
  });
}

/** 拼读 MCP 服务里直接声明给模型的常用工具（其余按需加载） */
export const DIRECT_TOOLS = [
  "lookup_words",
  "list_word_books",
  "get_word_book",
  "add_words",
  "create_word_book",
  "save_examples",
  "list_passages",
  "get_passage",
  "save_passage",
  "today",
  "list_plans",
  "get_plan",
  "study_stats",
  "background_jobs",
  "open_page",
  "read_aloud",
];

/** 拼读 MCP 服务在 pi 里的名字：工具为 `mcp__pindu__<tool>` */
export const PINDU_SERVER = "pindu";

export const askUserTool = defineTool({
  name: "ask_user",
  label: "问学习者",
  description:
    "Ask the learner to choose when there are clearly different ways to proceed (e.g. add to an existing word book or create a new one). Give 2-4 short options in Chinese. The learner may pick an option, answer in their own words, or skip. Do not use it for things you can decide yourself.",
  parameters: Type.Object({
    question: Type.String({ description: "the question in Chinese, one sentence" }),
    options: Type.Array(Type.String(), { minItems: 2, maxItems: 4, description: "short options in Chinese" }),
  }),
  async execute(_id, { question, options }, signal, _onUpdate, ctx) {
    if (!ctx.hasUI) throw new Error("no learner is available to answer");
    // 界面上除了点选项，也可以直接在输入框里用自己的话回答（拼读把输入的文字作为回答传回）
    const answer = (await ctx.ui.select(question, options, { signal }))?.trim();
    const text = !answer
      ? "The learner skipped the question; decide yourself or ask in your reply."
      : options.includes(answer)
        ? `The learner chose: ${answer}`
        : `The learner answered in their own words: ${answer}`;
    return {
      content: [{ type: "text", text }],
      details: { redlark: { step: answer ? `问了你：${question}（${answer}）` : `问了你：${question}（跳过）` } },
    };
  },
});

/**
 * 接入拼读的 MCP 服务（地址与令牌由拼读经环境变量给出），并把工具结果里拼读给界面的部分（structuredContent.redlark）
 * 放进 pi 工具结果的 details——界面按 details.redlark 显示步骤与收进来的素材。
 */
export function registerPindu(pi: ExtensionAPI) {
  const url = process.env.REDLARK_MCP_URL;
  const token = process.env.REDLARK_MCP_TOKEN;
  if (!url || !token) return;
  pi.registerTool(suggestRepliesTool);
  pi.registerTool(nameConversationTool(pi));
  // AI 老师用的自带工具也带上调用意图（重新注册同名工具即替换）；素材阅读任务不受影响
  for (const tool of [askUserTool, ...MATERIAL_TOOLS.filter(t => t.name !== "submit_material")]) {
    pi.registerTool(withReason(tool));
  }
  const conversation = process.env.REDLARK_CONVERSATION_ID ?? "";
  pi.registerMcpServer(PINDU_SERVER, {
    url,
    // 对话 id：拼读据此把工具提交的后台任务与这个对话关联，任务结束时通知回来（/pindu-job）
    headers: { Authorization: `Bearer ${token}`, "X-Pindu-Conversation": conversation },
    // 按需加载（pi 的 deferred）：常用的直接声明给模型，其余不占每次请求的上下文，模型用 tool_search 找到再加载
    exposure: "deferred",
    toolExposure: Object.fromEntries(DIRECT_TOOLS.map(name => [name, "direct"])),
    description: "Pindu features not yet in your tool list (editing / deleting materials, plan adjustments, video cutting, tags, detailed statistics). Search with English tool names or English keywords, e.g. delete_words, plan_cuts.",
    timeout: 120,
  });
  pi.on("tool_result", event => {
    if (!event.toolName.startsWith(`mcp__${PINDU_SERVER}__`)) return;
    const redlark = pinduDetails(event.structuredContent);
    if (!redlark) return;
    const details = (event as { details?: unknown }).details;
    return { details: { ...(details && typeof details === "object" ? details : {}), redlark } };
  });
  registerJobNotice(pi);
  registerConfirmGate(pi);
}

/**
 * 改动拼读内容前按「设置 → AI 老师」的权限把关（pi 文档的权限控制写法：按工具注解在 tool_call 里 confirm，不同意就 block）：
 * - ask_delete（默认）：会删除、结束的（destructiveHint）先问
 * - ask_changes：所有改动（不是 readOnlyHint 的）都先问
 * - view_only：所有改动直接拦下
 * 确认卡片的标题用模型写的这一步意图（reason）。
 */
export function gateDecision(permission: string | undefined, hints: { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined): "allow" | "confirm" | "block" {
  const changes = hints?.readOnlyHint !== true;
  if (permission === "view_only") return changes ? "block" : "allow";
  if (permission === "ask_changes") return changes ? "confirm" : "allow";
  return hints?.destructiveHint === true ? "confirm" : "allow";
}

function registerConfirmGate(pi: ExtensionAPI) {
  const permission = process.env.REDLARK_TUTOR_PERMISSION;
  pi.on("tool_call", async (event, ctx) => {
    if (!event.toolName.startsWith(`mcp__${PINDU_SERVER}__`)) return;
    const hints = pi.getAllTools().find(tool => tool.name === event.toolName)?.annotations;
    const decision = gateDecision(permission, hints);
    if (decision === "allow") return;
    if (decision === "block") {
      return { block: true, reason: "The learner set the AI teacher to view only, so nothing in Pindu can be created, changed or deleted. Tell them they can allow changes in Settings → AI 老师, or put the content in your answer instead." };
    }
    const reason = String((event.input as { reason?: unknown }).reason ?? "").trim();
    const detail = hints?.destructiveHint === true ? "这一步会删除或结束，确认后才会执行。" : "这一步会改动你的内容，确认后才会执行。";
    const ok = await ctx.ui.confirm(reason || "确定要这样做吗？", detail, { signal: ctx.signal });
    if (!ok) {
      return { block: true, reason: "The learner did not confirm, so nothing was changed. Do not retry unless they ask again." };
    }
  });
}

/** 自定义消息类型：后台任务结束的通知（界面显示成系统提示） */
export const JOB_NOTICE = "pindu-job";

/**
 * 拼读在后台任务（存短文、出题）结束时调用 `/pindu-job <JSON>`：把结果作为自定义消息放进会话并让 AI 老师接着说。
 * 扩展命令在 AI 回答过程中也会立即执行（pi rpc 文档）；空闲时立刻触发一轮，忙时排到这一轮之后。
 */
function registerJobNotice(pi: ExtensionAPI) {
  pi.registerCommand(JOB_NOTICE, {
    description: "Background job finished (sent by Pindu)",
    handler: async (args, ctx) => {
      let notice: { text?: string; job?: unknown };
      try {
        notice = JSON.parse(args);
      } catch {
        return;
      }
      if (!notice.text) return;
      pi.sendMessage(
        { customType: JOB_NOTICE, content: notice.text, display: true, details: notice.job },
        ctx.isIdle() ? { triggerTurn: true } : { triggerTurn: true, deliverAs: "followUp" },
      );
    },
  });
}

/** MCP 结果（pi 的 structuredContent 是整个 CallToolResult）里拼读给界面的部分 */
export function pinduDetails(structured: unknown): unknown {
  if (!structured || typeof structured !== "object") return undefined;
  const inner = (structured as { structuredContent?: unknown }).structuredContent;
  if (!inner || typeof inner !== "object") return undefined;
  return (inner as { redlark?: unknown }).redlark;
}
