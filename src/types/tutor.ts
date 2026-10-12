/**
 * AI 老师独立对话（handlers/tutor.rs）。对话内容是 pi 的会话：消息格式与事件照 pi 的定义（只列出界面用到的字段）。
 */

/** 对话列表的一项 */
export interface TutorConversation {
  id: string;
  /** pi 会话名，没有时为第一条消息 */
  title: string;
  created: string;
  modified: string;
  messageCount: number;
  pinned: boolean;
  archived: boolean;
  /** 从哪个对话「重新问」另开的（那个对话还在时） */
  parentId: string | null;
  /** 学习者说的第一句话（悬停预览） */
  firstMessage: string;
  /** 最近说的几句（悬停预览；列表读完之前为空） */
  recent: string;
}

/** 搜索对话的一条结果 */
export interface TutorSearchHit {
  id: string;
  /** 对话内容里匹配的那一段（只有标题匹配时为空） */
  snippet: string;
}

/** 打开对话：pi 的消息（get_messages） */
export interface TutorOpened {
  id: string;
  messages: PiMessage[];
  running: boolean;
  /** 还在等学习者回答的提问（pi 的 extension_ui_request 原样） */
  pendingAsks: unknown[];
  /** 取现状时的事件序号：序号不大于它的事件已经算在里面 */
  seq: number;
  /** 重建现状的事件（正在写的回答、排队的消息、重试提示），按 pi 事件重放 */
  replay: PiEvent[];
}

/** 在回答或在等学习者回答的对话（侧边栏「AI 老师」的标记） */
export interface TutorActivity {
  conversationId: string;
  running: boolean;
  asking: boolean;
}

/** 随消息发送的图片（base64，不含 data: 前缀） */
export interface TutorImage {
  data: string;
  mimeType: string;
}

/** 随消息发送的文件（PDF、Word、图片），放进对话的资料夹 */
export interface TutorFileUpload {
  name: string;
  /** base64（不含 data: 前缀） */
  data: string;
}

export interface TutorSendRequest {
  /** 空 = 开新对话 */
  conversationId?: string;
  message: string;
  images: TutorImage[];
  files: TutorFileUpload[];
}

/** 回答工具向用户的提问（pi extension_ui_response） */
export interface TutorUiAnswer {
  conversationId: string;
  requestId: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

// ---- pi 的消息（docs/message-types.md） ----

export interface PiTextBlock {
  type: 'text';
  text: string;
}
export interface PiImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
}
export interface PiThinkingBlock {
  type: 'thinking';
  thinking: string;
}
export interface PiToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface PiUserMessage {
  role: 'user';
  content: string | (PiTextBlock | PiImageBlock)[];
  timestamp: number;
}
export interface PiAssistantMessage {
  role: 'assistant';
  content: (PiTextBlock | PiThinkingBlock | PiToolCallBlock)[];
  stopReason?: 'pending' | 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | 'deferred';
  errorMessage?: string;
  timestamp: number;
}
export interface PiToolResultMessage {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: (PiTextBlock | PiImageBlock)[];
  details?: unknown;
  isError: boolean;
  timestamp: number;
}
/** 扩展放进会话的消息（如后台任务结束的通知 pindu-job） */
export interface PiCustomMessage {
  role: 'custom';
  customType: string;
  content: string | PiTextBlock[];
  display: boolean;
  timestamp: number;
}
/** 其它角色（system 等）界面不显示 */
export interface PiOtherMessage {
  role: 'system' | 'bashExecution' | 'branchSummary' | 'compactionSummary';
  timestamp: number;
}
export type PiMessage = PiUserMessage | PiAssistantMessage | PiToolResultMessage | PiCustomMessage | PiOtherMessage;

/** `tutor-event` 事件：pi 的原始事件（docs/json.md；message_update 去掉了整条消息的快照，只留增量）+ 对话 id + 序号 */
export interface TutorEventPayload {
  conversationId: string;
  /** 递增序号（所有对话共用）：打开对话时丢掉不大于快照序号的 */
  seq: number;
  event: PiEvent;
}

/** 界面处理的 pi 事件（其余忽略） */
export type PiEvent =
  | { type: 'agent_start' }
  | { type: 'agent_settled'; aborted?: boolean }
  | { type: 'message_start'; message: PiMessage }
  | { type: 'message_end'; message: PiMessage }
  | {
      type: 'message_update';
      assistantMessageEvent: {
        type: string;
        contentIndex?: number;
        delta?: string;
        id?: string;
        toolName?: string;
        toolCall?: PiToolCallBlock;
        content?: string;
      };
    }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args?: Record<string, unknown> }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string; partialResult?: { details?: unknown } }
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      toolName: string;
      isError: boolean;
      result?: { content?: (PiTextBlock | PiImageBlock)[]; details?: unknown };
    }
  /** pi 排队的消息（运行中发的补充），每次都是完整的队列 */
  | { type: 'queue_update'; steering: string[]; followUp: string[] }
  | { type: 'auto_retry_start' }
  | { type: 'auto_retry_end' }
  | { type: 'compaction_start' }
  | { type: 'compaction_end' }
  | { type: 'session_info_changed'; name?: string }
  | {
      type: 'extension_ui_request';
      id: string;
      method: string;
      title?: string;
      message?: string;
      options?: string[];
      placeholder?: string;
      prefill?: string;
      timeout?: number;
      /** notify：info / warning / error */
      notifyType?: string;
    }
  /** 拼读补发：对话进程已结束 */
  | { type: 'redlark_closed' }
  /** 拼读补发：在回答 / 等学习者回答变了 */
  | { type: 'redlark_activity'; running: boolean; asking: boolean }
  | { type: string };
