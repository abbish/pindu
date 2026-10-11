import { BaseService } from './baseService';
import type { ApiResult } from '../types';
import type { TutorConversation, TutorOpened, TutorSendRequest, TutorUiAnswer } from '../types/tutor';

/** AI 老师独立对话（handlers/tutor.rs）：对话由 pi 会话保存，回答经 `tutor-event` 事件推送 */
export class TutorService extends BaseService {
  async list(): Promise<ApiResult<TutorConversation[]>> {
    return this.executeWithLoading(() => this.client.invoke<TutorConversation[]>('get_tutor_conversations'));
  }

  async open(conversationId: string): Promise<ApiResult<TutorOpened>> {
    return this.executeWithLoading(() => this.client.invoke<TutorOpened>('open_tutor_conversation', { conversationId }));
  }

  /** 发一条消息，返回对话 id（新对话时是新建的） */
  async send(request: TutorSendRequest): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('send_tutor_message', { request }));
  }

  async stop(conversationId: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('stop_tutor_conversation', { conversationId }));
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
