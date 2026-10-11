// AI 老师独立对话：ask_user（问学习者，经 pi 的扩展 UI 交给拼读界面）与拼读 MCP 服务的接入。
import { uuidv7 } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** 拼读 MCP 服务在 pi 里的名字：工具为 `mcp__pindu__<tool>` */
export const PINDU_SERVER = "pindu";

export const askUserTool = defineTool({
  name: "ask_user",
  label: "问学习者",
  description:
    "Ask the learner to choose when there are clearly different ways to proceed (e.g. add to an existing word book or create a new one). Give 2-4 short options in Chinese. Returns the chosen option, or that the learner skipped. Do not use it for things you can decide yourself.",
  parameters: Type.Object({
    question: Type.String({ description: "the question in Chinese, one sentence" }),
    options: Type.Array(Type.String(), { minItems: 2, maxItems: 4, description: "short options in Chinese" }),
  }),
  async execute(_id, { question, options }, signal, _onUpdate, ctx) {
    if (!ctx.hasUI) throw new Error("no learner is available to answer");
    const choice = await ctx.ui.select(question, options, { signal });
    const text = choice ? `The learner chose: ${choice}` : "The learner skipped the question; decide yourself or ask in your reply.";
    return {
      content: [{ type: "text", text }],
      details: { redlark: { step: choice ? `问了你：${question}（${choice}）` : `问了你：${question}（跳过）` } },
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
  pi.registerMcpServer(PINDU_SERVER, {
    url,
    headers: { Authorization: `Bearer ${token}` },
    exposure: "direct",
    description: "拼读：学习者的词汇本、短文与学习记录；把内容收进素材库",
    timeout: 120,
  });
  pi.on("tool_result", event => {
    if (!event.toolName.startsWith(`mcp__${PINDU_SERVER}__`)) return;
    const redlark = pinduDetails(event.structuredContent);
    if (!redlark) return;
    const details = (event as { details?: unknown }).details;
    return { details: { ...(details && typeof details === "object" ? details : {}), redlark } };
  });
  registerAutoTitle(pi);
}

/** 标题最长（字符） */
const MAX_TITLE = 16;

/** 第一轮回答完后，用当前模型给对话起个短标题（pi 的会话名）；学习者改过名或已有名字时不动 */
function registerAutoTitle(pi: ExtensionAPI) {
  let tried = false;
  pi.on("agent_settled", async (event, ctx) => {
    if (tried || event.aborted || pi.getSessionName() || !ctx.model) return;
    const first = ctx.sessionManager.getBranch().find(e => e.type === "message" && e.message.role === "user");
    const text = first?.type === "message" && "content" in first.message ? messageText(first.message.content) : "";
    if (!text.trim()) return;
    tried = true;
    try {
      const reply = await ctx.modelRegistry.complete(
        ctx.model,
        {
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: titlePrompt(text) }],
              timestamp: Date.now(),
            },
          ],
        },
        { cacheRetention: "none", sessionId: uuidv7() },
      );
      const title = cleanTitle(reply.content.filter(c => c.type === "text").map(c => c.text).join(""));
      if (title && !pi.getSessionName()) pi.setSessionName(title);
    } catch {
      // 起不了标题时沿用第一条消息
    }
  });
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(b => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "")).join("\n");
}

export function titlePrompt(firstMessage: string): string {
  return [
    "给下面这段对话起一个中文标题，概括学习者想做的事，不超过 12 个字，不要标点和引号，只输出标题。",
    "学习者的第一句话：",
    firstMessage.replace(/〔附件：[^〕]*〕/g, "（附带了文件）").slice(0, 500),
  ].join("\n");
}

/** 模型给的标题：去掉引号、句末标点与多余空白，限制长度 */
export function cleanTitle(raw: string): string {
  const line = raw.split("\n").map(l => l.trim()).find(Boolean) ?? "";
  return line
    .replace(/^(标题[:：]\s*)/, "")
    .replace(/[。.!！?？]+$/, "")
    .replace(/^["'“”‘’「」《》]+|["'“”‘’「」《》]+$/g, "")
    .replace(/[。.!！?？]+$/, "")
    .trim()
    .slice(0, MAX_TITLE);
}

/** MCP 结果（pi 的 structuredContent 是整个 CallToolResult）里拼读给界面的部分 */
export function pinduDetails(structured: unknown): unknown {
  if (!structured || typeof structured !== "object") return undefined;
  const inner = (structured as { structuredContent?: unknown }).structuredContent;
  if (!inner || typeof inner !== "object") return undefined;
  return (inner as { redlark?: unknown }).redlark;
}
