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

/** 工具向用户的提问（pi extension_ui_request 的 select / confirm / input） */
export interface TutorAsk {
  id: string;
  method: 'select' | 'confirm' | 'input';
  title: string;
  message?: string;
  options: string[];
  placeholder?: string;
}

/** 发出去、pi 还没确认的消息（先显示出来） */
export interface PendingUser {
  text: string;
  /** 图片的 data: 地址 */
  images: string[];
}

export interface TranscriptState {
  messages: PiMessage[];
  /** 正在生成的 assistant 消息 */
  partial: PiAssistantMessage | null;
  /** 工具执行状态（toolCallId → 状态与最新 details） */
  tools: Record<string, { status: 'running' | 'done' | 'error'; details?: unknown }>;
  running: boolean;
  ask: TutorAsk | null;
  /** 正在重试 / 整理之前的对话 */
  notice: string | null;
  pendingUser: PendingUser | null;
}

export const emptyTranscript = (messages: PiMessage[] = [], running = false): TranscriptState => ({
  messages,
  partial: null,
  tools: {},
  running,
  ask: null,
  notice: null,
  pendingUser: null,
});

const sameMessage = (a: PiMessage, b: PiMessage) =>
  a.role === b.role &&
  a.timestamp === b.timestamp &&
  (a.role !== 'toolResult' || (b as PiToolResultMessage).toolCallId === a.toolCallId);

/** 一条 pi 事件 → 新状态 */
export function applyEvent(state: TranscriptState, event: PiEvent): TranscriptState {
  switch (event.type) {
    case 'agent_start':
      return { ...state, running: true };
    case 'agent_settled':
    case 'redlark_closed':
      return { ...state, running: false, partial: null, ask: null, notice: null };
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
    case 'auto_retry_start':
      return { ...state, notice: '网络不太稳定，正在重试' };
    case 'compaction_start':
      return { ...state, notice: '对话比较长，正在整理之前的内容' };
    case 'auto_retry_end':
    case 'compaction_end':
      return { ...state, notice: null };
    case 'extension_ui_request': {
      const e = event as Extract<PiEvent, { type: 'extension_ui_request'; method: string; id: string }>;
      if (e.method !== 'select' && e.method !== 'confirm' && e.method !== 'input') return state;
      return {
        ...state,
        ask: {
          id: e.id,
          method: e.method,
          title: e.title ?? '',
          message: e.message,
          options: e.options ?? [],
          placeholder: e.placeholder,
        },
      };
    }
    default:
      return state;
  }
}

// ---- 界面轮次 ----

/** 工具结果 details 里给界面的部分（拼读的工具约定写在 `redlark` 下） */
export interface StepOutput {
  kind: 'wordbook' | 'passage' | 'questions' | 'words';
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

export type ViewTurn =
  | { role: 'user'; key: string; text: string; images: string[]; pending?: boolean }
  | {
      role: 'agent';
      key: string;
      steps: ViewStep[];
      text: string;
      error?: string;
      stopped?: boolean;
      running: boolean;
    };

/** 工具没写说明时的默认说法 */
const TOOL_LABELS: Record<string, string> = {
  list_material: '看了看你给的文件',
  read_pdf_text: '读了 PDF 里的文字',
  view_pdf_page: '看了 PDF 的页面',
  view_image: '看了图片',
  read_text: '读了文件里的文字',
};

function redlarkDetails(details: unknown): { step?: string; detail?: string; output?: StepOutput } {
  if (!details || typeof details !== 'object') return {};
  const r = (details as { redlark?: unknown }).redlark;
  return r && typeof r === 'object' ? (r as { step?: string; detail?: string; output?: StepOutput }) : {};
}

function userText(message: PiUserMessage): { text: string; images: string[] } {
  if (typeof message.content === 'string') return { text: message.content, images: [] };
  return {
    text: message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n'),
    images: message.content
      .filter((b) => b.type === 'image')
      .map((b) => {
        const image = b as { data: string; mimeType: string };
        return `data:${image.mimeType};base64,${image.data}`;
      }),
  };
}

/** 状态 → 界面轮次：用户一条一轮；之后的 assistant 消息与工具结果合成 AI 的一轮 */
export function toTurns(state: TranscriptState): ViewTurn[] {
  const turns: ViewTurn[] = [];
  const results = new Map<string, PiToolResultMessage>();
  for (const m of state.messages) if (m.role === 'toolResult') results.set(m.toolCallId, m);

  let agent: Extract<ViewTurn, { role: 'agent' }> | null = null;
  const agentTurn = (key: string) => {
    if (!agent) {
      agent = { role: 'agent', key, steps: [], text: '', running: false };
      turns.push(agent);
    }
    return agent;
  };
  const addAssistant = (message: PiAssistantMessage, key: string) => {
    const turn = agentTurn(key);
    const texts: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text' && block.text.trim()) texts.push(block.text);
      if (block.type === 'toolCall') turn.steps.push(step(block, results.get(block.id), state.tools[block.id], state.running));
    }
    if (texts.length > 0) turn.text = turn.text ? `${turn.text}\n\n${texts.join('\n\n')}` : texts.join('\n\n');
    if (message.stopReason === 'error') turn.error = message.errorMessage || 'AI 老师这次没能回答';
    if (message.stopReason === 'aborted') turn.stopped = true;
  };

  state.messages.forEach((m, i) => {
    if (m.role === 'user') {
      agent = null;
      turns.push({ role: 'user', key: `u${m.timestamp}-${i}`, ...userText(m) });
    } else if (m.role === 'assistant') {
      addAssistant(m, `a${m.timestamp}-${i}`);
    }
  });
  if (state.pendingUser) {
    agent = null;
    turns.push({ role: 'user', key: 'pending', text: state.pendingUser.text, images: state.pendingUser.images, pending: true });
  }
  if (state.partial) addAssistant(state.partial, 'partial');
  if (state.running) {
    const last = turns[turns.length - 1];
    const turn = last?.role === 'agent' ? last : agentTurn('running');
    turn.running = true;
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
  return {
    id: call.id,
    tool: call.name,
    label: info.step || TOOL_LABELS[call.name] || '处理了一步',
    detail: info.detail,
    status,
    output: info.output,
  };
}
