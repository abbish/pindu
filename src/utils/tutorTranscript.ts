/**
 * AI 老师对话的显示状态：按 pi 的消息与事件重建（docs/json.md「Reconstruct streaming messages」），再分成界面上的轮次。
 * 纯函数，有 node 测试。
 */
import type {
  PiAssistantMessage,
  PiEvent,
  PiMessage,
  PiToolCallBlock,
  PiToolResultMessage,
  PiUserMessage,
} from '../types/tutor';

/** 工具向用户的提问（pi extension_ui_request 里要等回答的：select / confirm / input / editor） */
export interface TutorAsk {
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor';
  title: string;
  message?: string;
  options: string[];
  placeholder?: string;
  /** editor 预填的内容 */
  prefill?: string;
  /** 带 timeout 的提问：过期时刻（毫秒），过期后 pi 按默认值收回 */
  expiresAt?: number;
}

const DIALOGS = ['select', 'confirm', 'input', 'editor'];

/** pi 的 extension_ui_request → 提问；不是要等回答的返回 null */
export function toAsk(raw: unknown, now = Date.now()): TutorAsk | null {
  const e = (raw ?? {}) as {
    id?: string;
    method?: string;
    title?: string;
    message?: string;
    options?: string[];
    placeholder?: string;
    prefill?: string;
    timeout?: number;
  };
  if (!e.id || !e.method || !DIALOGS.includes(e.method)) return null;
  return {
    id: e.id,
    method: e.method as TutorAsk['method'],
    title: e.title ?? '',
    message: e.message,
    options: e.options ?? [],
    placeholder: e.placeholder,
    prefill: e.prefill,
    expiresAt: typeof e.timeout === 'number' ? now + e.timeout : undefined,
  };
}

/** 发出去、pi 还没确认的消息（先显示出来） */
export interface PendingUser {
  text: string;
  /** 图片的 data: 地址 */
  images: string[];
  /** 文件名 */
  files: string[];
}

export interface TranscriptState {
  messages: PiMessage[];
  /** 正在生成的 assistant 消息 */
  partial: PiAssistantMessage | null;
  /** 工具执行状态（toolCallId → 状态与最新 details） */
  tools: Record<string, { status: 'running' | 'done' | 'error'; details?: unknown }>;
  running: boolean;
  /** 等学习者回答的提问（按到达顺序，一次答一个） */
  asks: TutorAsk[];
  /** 正在重试 / 整理之前的对话 */
  notice: string | null;
  pendingUser: PendingUser | null;
  /** 排队等 AI 老师看的消息（pi 的队列） */
  queue: string[];
}

export const emptyTranscript = (messages: PiMessage[] = [], running = false, asks: TutorAsk[] = []): TranscriptState => ({
  messages,
  partial: null,
  tools: {},
  running,
  asks,
  notice: null,
  pendingUser: null,
  queue: [],
});

const sameMessage = (a: PiMessage, b: PiMessage) =>
  a.role === b.role &&
  a.timestamp === b.timestamp &&
  (a.role !== 'toolResult' || (b as PiToolResultMessage).toolCallId === a.toolCallId);

/** 回答了（或过期了）一个提问 */
export const dropAsk = (state: TranscriptState, id: string): TranscriptState => ({
  ...state,
  asks: state.asks.filter((a) => a.id !== id),
});

/** 一条 pi 事件 → 新状态 */
export function applyEvent(state: TranscriptState, event: PiEvent): TranscriptState {
  switch (event.type) {
    case 'agent_start':
      return { ...state, running: true };
    case 'agent_settled':
    case 'redlark_closed':
      return { ...state, running: false, partial: null, asks: [], notice: null, queue: [] };
    case 'message_start': {
      const { message } = event as { message: PiMessage };
      if (message.role === 'assistant') return { ...state, partial: { ...message, content: [...message.content] } };
      return state;
    }
    case 'message_update': {
      if (!state.partial) return state;
      const update = (event as Extract<PiEvent, { type: 'message_update' }>).assistantMessageEvent;
      const index = update.contentIndex ?? 0;
      const content = [...state.partial.content];
      const block = content[index];
      switch (update.type) {
        case 'text_start':
          content[index] = { type: 'text', text: '' };
          break;
        case 'text_delta':
          content[index] = { type: 'text', text: (block?.type === 'text' ? block.text : '') + (update.delta ?? '') };
          break;
        case 'text_end':
          if (typeof update.content === 'string') content[index] = { type: 'text', text: update.content };
          break;
        case 'thinking_start':
          content[index] = { type: 'thinking', thinking: '' };
          break;
        case 'thinking_delta':
          content[index] = {
            type: 'thinking',
            thinking: (block?.type === 'thinking' ? block.thinking : '') + (update.delta ?? ''),
          };
          break;
        case 'toolcall_start':
          content[index] = { type: 'toolCall', id: update.id ?? '', name: update.toolName ?? '', arguments: {} };
          break;
        case 'toolcall_end':
          if (update.toolCall) content[index] = update.toolCall;
          break;
        default:
          return state;
      }
      return { ...state, partial: { ...state.partial, content } };
    }
    case 'message_end': {
      const { message } = event as { message: PiMessage };
      const exists = state.messages.some((m) => sameMessage(m, message));
      return {
        ...state,
        messages: exists ? state.messages : [...state.messages, message],
        partial: message.role === 'assistant' ? null : state.partial,
        pendingUser: message.role === 'user' ? null : state.pendingUser,
      };
    }
    case 'tool_execution_start': {
      const { toolCallId } = event as { toolCallId: string };
      return { ...state, tools: { ...state.tools, [toolCallId]: { status: 'running' } } };
    }
    case 'tool_execution_update': {
      const e = event as Extract<PiEvent, { type: 'tool_execution_update' }>;
      return {
        ...state,
        tools: { ...state.tools, [e.toolCallId]: { status: 'running', details: e.partialResult?.details } },
      };
    }
    case 'tool_execution_end': {
      const e = event as Extract<PiEvent, { type: 'tool_execution_end' }>;
      return {
        ...state,
        tools: { ...state.tools, [e.toolCallId]: { status: e.isError ? 'error' : 'done', details: e.result?.details } },
      };
    }
    case 'queue_update': {
      const e = event as Extract<PiEvent, { type: 'queue_update' }>;
      return { ...state, queue: [...(e.steering ?? []), ...(e.followUp ?? [])] };
    }
    case 'auto_retry_start':
      return { ...state, notice: '网络不太稳定，正在重试' };
    case 'compaction_start':
      return { ...state, notice: '对话比较长，正在整理之前的内容' };
    case 'auto_retry_end':
    case 'compaction_end':
      return { ...state, notice: null };
    case 'extension_ui_request': {
      const ask = toAsk(event);
      if (!ask || state.asks.some((x) => x.id === ask.id)) return state;
      return { ...state, asks: [...state.asks, ask] };
    }
    default:
      return state;
  }
}

// ---- 界面轮次 ----

/** 工具结果 details 里给界面的部分（拼读的工具约定写在 `redlark` 下） */
export interface StepOutput {
  kind: 'wordbook' | 'passage' | 'questions' | 'words' | 'plan';
  id?: number;
  title: string;
  meta?: string;
  /** 还在后台做的任务（如拼读分析） */
  jobId?: string;
}

export interface ViewStep {
  id: string;
  tool: string;
  /** 用户能看懂的一句话 */
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'error';
  output?: StepOutput;
}

/** AI 一轮里按发生顺序的内容：说的话、连续的几步工具调用 */
export type ViewItem = { kind: 'text'; key: string; text: string } | { kind: 'steps'; key: string; steps: ViewStep[] };

export type ViewTurn =
  | { role: 'user'; key: string; text: string; images: string[]; files: string[]; pending?: boolean }
  /** 系统提示（后台任务结束等），AI 老师随后会接着说 */
  | { role: 'notice'; key: string; text: string }
  | {
      role: 'agent';
      key: string;
      items: ViewItem[];
      /** 全部工具调用（收进来的素材从这里取） */
      steps: ViewStep[];
      /** 推荐的下一步（回答末尾 `<<<下一步>>>` 之后），点一下就发 */
      suggestions: string[];
      /** 用时（秒）：学习者发出消息到最后一条回答；还没有时间时为空 */
      seconds?: number;
      error?: string;
      stopped?: boolean;
      running: boolean;
    };

/** AI 读的 skill（做法说明）的名字 */
const SKILL_NAMES: Record<string, string> = {
  'tutor-vocabulary': '词汇本',
  'tutor-passages': '短文与题组',
  'tutor-plans': '学习计划',
  'tutor-videos': '视频',
  'tutor-organize': '整理',
  'tutor-materials': '读材料',
};

function skillLabel(call: PiToolCallBlock, done: boolean): string | undefined {
  if (call.name !== 'read') return undefined;
  const path = String(call.arguments?.path ?? '');
  const skill = Object.keys(SKILL_NAMES).find((name) => path.includes(name));
  if (!skill) return undefined;
  return `${done ? '看了' : '正在看'}「${SKILL_NAMES[skill]}」的做法`;
}

function redlarkDetails(details: unknown): { step?: string; detail?: string; output?: StepOutput } {
  if (!details || typeof details !== 'object') return {};
  const r = (details as { redlark?: unknown }).redlark;
  return r && typeof r === 'object' ? (r as { step?: string; detail?: string; output?: StepOutput }) : {};
}

/** 消息末尾的附件标记（后端 `tutor_chat::attachment_line`）：〔附件：a.pdf、b.txt〕 */
const ATTACHMENT_LINE = /\n*〔附件：([^〕]*)〕\s*$/;

/** 拆出附件标记：正文 + 文件名 */
export function splitAttachments(text: string): { text: string; files: string[] } {
  const match = ATTACHMENT_LINE.exec(text);
  if (!match) return { text, files: [] };
  return { text: text.slice(0, match.index), files: match[1].split('、').filter(Boolean) };
}

function userText(message: PiUserMessage): { text: string; images: string[]; files: string[] } {
  if (typeof message.content === 'string') return { images: [], ...splitAttachments(message.content) };
  return {
    ...splitAttachments(
      message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n')
    ),
    images: message.content
      .filter((b) => b.type === 'image')
      .map((b) => {
        const image = b as { data: string; mimeType: string };
        return `data:${image.mimeType};base64,${image.data}`;
      }),
  };
}

/** 模型服务的报错 → 学习者能看懂的话（原文另外保留给悬停提示） */
export function friendlyError(raw: string): string {
  const text = raw.toLowerCase();
  if (/\b429\b|rate.?limit|overload|too many requests|busy/.test(text)) return 'AI 服务现在太忙，请稍后再试';
  if (/\b401\b|\b403\b|api.?key|unauthori|authentication|forbidden/.test(text)) return 'AI 服务的密钥不对，请在「设置 → AI 模型」检查';
  if (/quota|insufficient|balance|billing|credit|余额|额度/.test(text)) return 'AI 服务的额度用完了，请检查账户余额';
  if (/timeout|timed out|network|econn|socket|fetch failed|网络/.test(text)) return '网络不太稳定，请再试一次';
  if (/context|too long|maximum.*token/.test(text)) return '对话太长了，可以新开一个对话接着聊';
  return 'AI 老师这次没能回答完，请再试一次';
}

/** 正文与推荐下一步之间的分隔行（提示词 tutor_chat.md 要求模型原样输出；兼容讲解用的「追问」） */
const NEXT_MARKERS = ['<<<下一步>>>', '<<<追问>>>'];
/** 最多几条推荐、每条最长几个字（与讲解的追问一致：agent/follow_up.rs） */
const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_CHARS = 30;

const normalizeText = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/** 一行推荐：去掉列表符号、编号与引号；太长或为空返回 null */
function cleanSuggestion(line: string): string | null {
  const text = line
    .trim()
    .replace(/^[-*•·\s]+/, '')
    .replace(/^\d+[.、)]\s*/, '')
    .replace(/^["“”「」*`]+|["“”「」*`]+$/g, '')
    .trim();
  return text && [...text].length <= MAX_SUGGESTION_CHARS ? text : null;
}

/**
 * 拆出回答末尾的推荐下一步。流式输出时分隔行可能只到一半（如「<<<下」），一并挡住不显示。
 * `said` 是学习者已经说过的话（不再推荐）。
 */
export function splitSuggestions(text: string, said: string[] = []): { body: string; suggestions: string[] } {
  const found = NEXT_MARKERS.map((m) => ({ m, at: text.indexOf(m) })).find((x) => x.at >= 0);
  if (!found) {
    // 末尾是分隔行开头的一截：先不显示
    const tail = NEXT_MARKERS.flatMap((m) => [...Array(m.length).keys()].map((n) => m.slice(0, n + 1))).find(
      (prefix) => text.trimEnd().endsWith(prefix)
    );
    return { body: tail ? text.trimEnd().slice(0, -tail.length).trimEnd() : text, suggestions: [] };
  }
  const body = text.slice(0, found.at).trimEnd().replace(/[*`]+$/, '').trimEnd();
  const seen = new Set(said.map(normalizeText));
  const suggestions: string[] = [];
  for (const line of text.slice(found.at + found.m.length).split('\n')) {
    const item = cleanSuggestion(line);
    if (!item) continue;
    const key = normalizeText(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    suggestions.push(item);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return { body, suggestions };
}

/** 状态 → 界面轮次：用户一条一轮；之后的 assistant 消息与工具结果按发生顺序合成 AI 的一轮 */
export function toTurns(state: TranscriptState): ViewTurn[] {
  const turns: ViewTurn[] = [];
  const results = new Map<string, PiToolResultMessage>();
  for (const m of state.messages) if (m.role === 'toolResult') results.set(m.toolCallId, m);

  let agent: Extract<ViewTurn, { role: 'agent' }> | null = null;
  /** 这一轮从学习者哪条消息开始（算用时） */
  let askedAt: number | undefined;
  const agentTurn = (key: string) => {
    if (!agent) {
      agent = { role: 'agent', key, items: [], steps: [], suggestions: [], running: false };
      turns.push(agent);
    }
    return agent;
  };
  const addAssistant = (message: PiAssistantMessage, key: string) => {
    const turn = agentTurn(key);
    message.content.forEach((block, i) => {
      const last = turn.items[turn.items.length - 1];
      if (block.type === 'text' && block.text.trim()) {
        turn.items.push({ kind: 'text', key: `${key}-${i}`, text: block.text });
      } else if (block.type === 'toolCall') {
        const s = step(block, results.get(block.id), state.tools[block.id], state.running);
        turn.steps.push(s);
        // 连着的工具调用放在一组
        if (last?.kind === 'steps') last.steps.push(s);
        else turn.items.push({ kind: 'steps', key: `${key}-${i}`, steps: [s] });
      }
    });
    if (askedAt && message.timestamp > askedAt && message.stopReason && message.stopReason !== 'pending') {
      turn.seconds = Math.max(1, Math.round((message.timestamp - askedAt) / 1000));
    }
    // pi 会自动重试：后面有成功的回复，前面那次失败就不算（只看这一轮最后一条）
    if (message.stopReason === 'error') turn.error = message.errorMessage || '';
    else delete turn.error;
    if (message.stopReason === 'aborted') turn.stopped = true;
  };

  state.messages.forEach((m, i) => {
    if (m.role === 'user') {
      agent = null;
      askedAt = m.timestamp;
      turns.push({ role: 'user', key: `u${m.timestamp}-${i}`, ...userText(m) });
    } else if (m.role === 'assistant') {
      addAssistant(m, `a${m.timestamp}-${i}`);
    } else if (m.role === 'custom' && m.display) {
      agent = null;
      askedAt = m.timestamp;
      const text = typeof m.content === 'string' ? m.content : m.content.map((b) => b.text).join('');
      turns.push({ role: 'notice', key: `n${m.timestamp}-${i}`, text });
    }
  });
  if (state.pendingUser) {
    agent = null;
    turns.push({ role: 'user', key: 'pending', ...state.pendingUser, pending: true });
  }
  if (state.partial) addAssistant(state.partial, 'partial');
  if (state.running) {
    const last = turns[turns.length - 1];
    const turn = last?.role === 'agent' ? last : agentTurn('running');
    turn.running = true;
    // 还在跑（自动重试中）：不显示错误
    delete turn.error;
  }
  // 每段说的话都拆掉推荐下一步；推荐取这一轮最后一段的
  const said = turns.flatMap((t) => (t.role === 'user' ? [t.text] : []));
  for (const turn of turns) {
    if (turn.role !== 'agent') continue;
    turn.items = turn.items.flatMap((item): ViewItem[] => {
      if (item.kind !== 'text') return [item];
      const { body, suggestions } = splitSuggestions(item.text, said);
      if (suggestions.length > 0) turn.suggestions = suggestions;
      return body.trim() ? [{ ...item, text: body }] : [];
    });
  }
  return turns;
}

function step(
  call: PiToolCallBlock,
  result: PiToolResultMessage | undefined,
  live: TranscriptState['tools'][string] | undefined,
  running: boolean
): ViewStep {
  const details = result?.details ?? live?.details;
  const info = redlarkDetails(details);
  // 没有结果也不在运行：被停止了
  const status = result ? (result.isError ? 'error' : 'done') : (live?.status ?? (running ? 'running' : 'error'));
  // 进行中：模型写的调用意图（reason 参数）；做完：工具给的结果说明，没有就沿用意图。
  // pi 自带的 read（读 skill）没有 reason，按读的是哪个 skill 说
  const reason = typeof call.arguments?.reason === 'string' ? call.arguments.reason.trim() : '';
  const label =
    status === 'running'
      ? reason || (skillLabel(call, false) ?? '正在处理')
      : info.step || reason || (skillLabel(call, true) ?? '处理了一步');
  return {
    id: call.id,
    tool: call.name,
    label,
    detail: info.detail,
    status,
    output: info.output,
  };
}
