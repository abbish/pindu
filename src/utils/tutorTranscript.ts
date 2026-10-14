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
  TutorOpened,
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
  /** 工具执行状态（toolCallId → 状态、最新 details、出错时的说明） */
  tools: Record<string, { status: 'running' | 'done' | 'error'; details?: unknown; text?: string }>;
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

/** 带序号的一条事件 */
export interface SeqEvent {
  seq: number;
  event: PiEvent;
}

/**
 * 打开对话时的状态：pi 的消息 + 重放现状（正在写的回答、排队的消息、重试提示）+ 打开期间收到的、序号大于快照的事件。
 * 序号不大于快照的已经算在现状里，再用一次流式增量会把同一段字拼两次。
 */
export function openedTranscript(
  opened: Pick<TutorOpened, 'messages' | 'running' | 'seq' | 'replay'>,
  asks: TutorAsk[],
  later: SeqEvent[]
): TranscriptState {
  const events = [...opened.replay, ...later.filter((e) => e.seq > opened.seq).map((e) => e.event)];
  return events.reduce(applyEvent, emptyTranscript(opened.messages, opened.running, asks));
}

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
        tools: {
          ...state.tools,
          [e.toolCallId]: { status: e.isError ? 'error' : 'done', details: e.result?.details, text: blocksText(e.result?.content) },
        },
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
  /**
   * revised：交稿前的核对没通过，AI 改好再交；skipped：没有改动——学习者没同意、只查看、停止了。
   * 都不算出错，只有 error 显示成红色
   */
  status: 'running' | 'done' | 'error' | 'revised' | 'skipped';
  output?: StepOutput;
}

/** AI 一轮里按发生顺序的内容：说的话、连续的几步工具调用 */
export type ViewItem = { kind: 'text'; key: string; text: string } | { kind: 'steps'; key: string; steps: ViewStep[] };

export type ViewTurn =
  /** timestamp：pi 消息的时刻（「从这里重新问」按它找到这条；还没发出去的没有） */
  | { role: 'user'; key: string; text: string; images: string[]; files: string[]; pending?: boolean; timestamp?: number }
  /** 系统提示（后台任务结束等），AI 老师随后会接着说 */
  | { role: 'notice'; key: string; text: string }
  | {
      role: 'agent';
      key: string;
      items: ViewItem[];
      /** 全部工具调用（收进来的素材从这里取） */
      steps: ViewStep[];
      /** 推荐的下一步（模型调用 suggest_replies 给的），点一下就发 */
      suggestions: string[];
      /** 用时（秒）：学习者发出消息到最后一条回答；还没有时间时为空 */
      seconds?: number;
      /** 这一轮从什么时候开始（学习者发出消息 / 系统提示的时刻，ms）：进行中显示已用时间；消息还没确认、或由运行自己开始时为空 */
      startedAt?: number;
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

/** check：交稿前的核对没通过（后端 mcp/tools needs_revision） */
type RedlarkDetails = { step?: string; detail?: string; output?: StepOutput; check?: boolean };

function redlarkDetails(details: unknown): RedlarkDetails {
  if (!details || typeof details !== 'object') return {};
  const r = (details as { redlark?: unknown }).redlark;
  return r && typeof r === 'object' ? (r as RedlarkDetails) : {};
}

const blocksText = (content: unknown): string | undefined =>
  Array.isArray(content)
    ? content
        .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
    : undefined;

/**
 * 没成功的工具调用怎么显示（按 pi 给的说明认）：
 * - pi 找工具（调用了还没加载的工具）、参数格式不对：智能体自己换个方式再调，和 tool_search 一样不显示；
 * - 学习者没同意、只查看（sidecar 确认门的说明，agent/src/tools/tutor.ts 的 DECLINED_REASON / VIEW_ONLY_REASON）、停止：没有改动，不算出错。
 */
const TOOL_OUTCOMES: { match: RegExp; hidden?: true; note?: string }[] = [
  { match: /^Tool \S+ not found/, hidden: true },
  { match: /^Validation failed for tool /, hidden: true },
  { match: /^The learner did not confirm/, note: '你没有同意，没有改动' },
  { match: /^The learner set the AI teacher to view only/, note: '只查看，没有改动' },
  { match: /^Operation aborted/, note: '已停止' },
];

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

/** 不算「做了的事」、不显示成步骤的工具：界面元信息（推荐下一步显示成按钮，标题进对话列表）与 pi 找工具的 tool_search */
const META_TOOLS = new Set(['suggest_replies', 'name_conversation', 'tool_search']);

/** 一条 assistant 消息以这些原因结束时，这一次运行就结束了（error 不算：pi 可能还会自动重试） */
const RUN_ENDED = new Set(['stop', 'aborted', 'length']);

/**
 * 状态 → 界面轮次：用户一条一轮；之后的 assistant 消息与工具结果按发生顺序合成 AI 的一轮。
 * 轮次与内容的 key 在一轮的整个过程中不变（正在写 → 写完、消息待确认 → 已确认），界面不因此重建（展开状态、逐字显示都保留）：
 * AI 的一轮按它前面第几个学习者消息 / 系统提示编号，内容按消息的时刻编号（正在写的消息与写完的是同一个时刻）。
 */
export function toTurns(state: TranscriptState): ViewTurn[] {
  const turns: ViewTurn[] = [];
  const results = new Map<string, PiToolResultMessage>();
  for (const m of state.messages) if (m.role === 'toolResult') results.set(m.toolCallId, m);
  const lastAssistant = state.messages.map((m) => m.role).lastIndexOf('assistant');

  let agent: Extract<ViewTurn, { role: 'agent' }> | null = null;
  /** 这一轮从学习者哪条消息开始（算用时）；还没确认的消息没有时刻 */
  let askedAt: number | undefined;
  /** 前面有几个学习者消息 / 系统提示（AI 那一轮的 key） */
  let anchors = 0;
  /** 最后一条消息已经结束运行的轮次 */
  const ended = new WeakSet<object>();
  const agentTurn = (key = `t${anchors}`) => {
    if (!agent) {
      agent = { role: 'agent', key, items: [], steps: [], suggestions: [], running: false, startedAt: askedAt };
      turns.push(agent);
    }
    return agent;
  };
  /** live：这条消息属于正在进行的运行（没有结果的工具调用算进行中，否则算已停止） */
  const addAssistant = (message: PiAssistantMessage, live: boolean) => {
    const turn = agentTurn();
    const key = `a${message.timestamp}`;
    message.content.forEach((block, i) => {
      const last = turn.items[turn.items.length - 1];
      if (block.type === 'text' && block.text.trim()) {
        turn.items.push({ kind: 'text', key: `${key}-${i}`, text: block.text });
      } else if (block.type === 'toolCall' && block.name === 'suggest_replies') {
        const replies = block.arguments?.replies;
        if (Array.isArray(replies)) turn.suggestions = replies.filter((r): r is string => typeof r === 'string');
      } else if (block.type === 'toolCall' && !META_TOOLS.has(block.name)) {
        const s = step(block, results.get(block.id), state.tools[block.id], live);
        if (!s) return;
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
    if (message.stopReason && RUN_ENDED.has(message.stopReason)) ended.add(turn);
    else ended.delete(turn);
  };

  state.messages.forEach((m, i) => {
    if (m.role === 'user') {
      agent = null;
      askedAt = m.timestamp;
      anchors += 1;
      turns.push({ role: 'user', key: `u${anchors}`, ...userText(m), timestamp: m.timestamp });
    } else if (m.role === 'assistant') {
      const live = state.running && !state.partial && i === lastAssistant && m.stopReason !== 'aborted' && m.stopReason !== 'error';
      addAssistant(m, live);
    } else if (m.role === 'custom' && m.display) {
      agent = null;
      askedAt = m.timestamp;
      anchors += 1;
      const text =
        typeof m.details?.text === 'string'
          ? m.details.text
          : typeof m.content === 'string'
            ? m.content
            : m.content.map((b) => b.text).join('');
      turns.push({ role: 'notice', key: `n${anchors}`, text });
    }
  });
  if (state.pendingUser) {
    agent = null;
    askedAt = undefined;
    anchors += 1;
    turns.push({ role: 'user', key: `u${anchors}`, ...state.pendingUser, pending: true });
  }
  if (state.partial) addAssistant(state.partial, true);
  if (state.running) {
    const last = turns[turns.length - 1];
    // 上一轮已经结束、新的运行还没有消息（如后台任务的通知触发的运行，pi 先发 agent_start）：另起一轮，不把结束了的那轮改回进行中
    const current = last?.role === 'agent' && !ended.has(last) ? last : null;
    if (!current) agent = null;
    const turn = current ?? agentTurn(last?.role === 'agent' ? `t${anchors}-next` : undefined);
    if (!current) turn.startedAt = undefined;
    turn.running = true;
    // 还在跑（自动重试中）：不显示错误
    delete turn.error;
  }
  // 核对后没有再交（AI 放弃了）：这一步就是没做成
  for (const turn of turns) {
    if (turn.role !== 'agent' || turn.running) continue;
    turn.steps.forEach((s, i) => {
      if (s.status === 'revised' && !turn.steps.slice(i + 1).some((later) => later.tool === s.tool)) s.status = 'error';
    });
  }
  return turns;
}

function step(
  call: PiToolCallBlock,
  result: PiToolResultMessage | undefined,
  live: TranscriptState['tools'][string] | undefined,
  /** 这条调用所在的消息属于正在进行的运行 */
  running: boolean
): ViewStep | null {
  const details = result?.details ?? live?.details;
  const info = redlarkDetails(details);
  // 进行中：模型写的调用意图（reason 参数）；做完：工具给的结果说明，没有就沿用意图。
  // pi 自带的 read（读 skill）没有 reason，按读的是哪个 skill 说
  const reason = typeof call.arguments?.reason === 'string' ? call.arguments.reason.trim() : '';
  // 没有结果也不在运行：被停止了
  // 进程中途退出时没有 tool_execution_end：不在运行就不再算进行中
  const liveStatus = live?.status === 'running' && !running ? undefined : live?.status;
  let status: ViewStep['status'] = result ? (result.isError ? 'error' : 'done') : (liveStatus ?? (running ? 'running' : 'skipped'));
  let note: string | undefined;
  if (status === 'error') {
    const outcome = TOOL_OUTCOMES.find((o) => o.match.test((result ? blocksText(result.content) : live?.text) ?? ''));
    if (outcome?.hidden) return null;
    if (outcome) {
      status = 'skipped';
      note = outcome.note;
    } else if (info.check) {
      status = 'revised';
    }
  } else if (status === 'skipped') {
    note ??= '已停止';
  }
  const base =
    status === 'running'
      ? reason || (skillLabel(call, false) ?? '正在处理')
      : status === 'skipped'
        ? reason || info.step || (skillLabel(call, false) ?? '这一步')
        : info.step || reason || (skillLabel(call, true) ?? '处理了一步');
  const label = note ? `${base}（${note}）` : base;
  return {
    id: call.id,
    tool: call.name,
    label,
    detail: info.detail,
    status,
    output: info.output,
  };
}
