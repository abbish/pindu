import { BaseService } from './baseService';
import type { ApiResult } from '../types';
import type { TutorActivity, TutorConversation, TutorOpened, TutorSearchHit, TutorSendRequest, TutorUiAnswer } from '../types/tutor';

/** AI 老师独立对话（handlers/tutor.rs）：对话由 pi 会话保存，回答经 `tutor-event` 事件推送 */
export class TutorService extends BaseService {
  /** 对话列表；对话很多时边读边经 `tutor-conversations-partial` 事件推送已读到的部分 */
  async list(): Promise<ApiResult<TutorConversation[]>> {
    return this.executeWithLoading(() => this.client.invoke<TutorConversation[]>('get_tutor_conversations'));
  }

  /** 搜索对话：标题或对话内容 */
  async search(query: string): Promise<ApiResult<TutorSearchHit[]>> {
    return this.executeWithLoading(() => this.client.invoke<TutorSearchHit[]>('search_tutor_conversations', { query }));
  }

  /** 从某条学习者消息重新问：这条之前的对话另开成新对话，返回新对话 id（这条之前还没有回答时为 null，直接开新对话） */
  async fork(conversationId: string, timestamp: number): Promise<ApiResult<string | null>> {
    return this.executeWithLoading(() => this.client.invoke<string | null>('fork_tutor_conversation', { conversationId, timestamp }));
  }

  /** 在回答或在等学习者回答的对话（之后的变化经 tutor-event 的 redlark_activity 推送） */
  async activity(): Promise<ApiResult<TutorActivity[]>> {
    return this.executeWithLoading(() => this.client.invoke<TutorActivity[]>('get_tutor_activity'));
  }

  async open(conversationId: string): Promise<ApiResult<TutorOpened>> {
    return this.executeWithLoading(() => this.client.invoke<TutorOpened>('open_tutor_conversation', { conversationId }));
  }

  /** 发一条消息，返回对话 id（新对话时是新建的） */
  async send(request: TutorSendRequest): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('send_tutor_message', { request }));
  }

  /** 停止，返回被清掉的排队消息（放回输入框） */
  async stop(conversationId: string): Promise<ApiResult<string[]>> {
    return this.executeWithLoading(() => this.client.invoke<string[]>('stop_tutor_conversation', { conversationId }));
  }

  /** 改排队的消息（删掉 / 拿回编辑后剩下的，按顺序） */
  async setQueue(conversationId: string, messages: string[]): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('set_tutor_queue', { conversationId, messages }));
  }

  async answer(request: TutorUiAnswer): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('answer_tutor_question', { request }));
  }

  async rename(conversationId: string, name: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('rename_tutor_conversation', { conversationId, name }));
  }

  async setFlags(conversationId: string, pinned: boolean, archived: boolean): Promise<ApiResult<void>> {
    return this.executeWithLoading(() =>
      this.client.invoke<void>('set_tutor_conversation_flags', { conversationId, pinned, archived })
    );
  }

  async remove(conversationId: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('delete_tutor_conversation', { conversationId }));
  }
}

export const tutorService = new TutorService();
