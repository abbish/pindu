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
  /** 正在回答 */
  running: boolean;
}

/** 打开对话：pi 的消息（get_messages） */
export interface TutorOpened {
  id: string;
  messages: PiMessage[];
  running: boolean;
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
/** 其它角色（system、custom 等）界面不显示 */
export interface PiOtherMessage {
  role: 'system' | 'custom' | 'bashExecution' | 'branchSummary' | 'compactionSummary';
  timestamp: number;
}
export type PiMessage = PiUserMessage | PiAssistantMessage | PiToolResultMessage | PiOtherMessage;

/** `tutor-event` 事件：pi 的原始事件（docs/json.md）+ 对话 id */
export interface TutorEventPayload {
  conversationId: string;
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
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; isError: boolean; result?: { details?: unknown } }
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
    }
  /** 拼读补发：对话进程已结束 */
  | { type: 'redlark_closed' }
  | { type: string };
