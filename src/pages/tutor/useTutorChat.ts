/**
 * AI 老师页的数据：对话列表、当前对话（按 pi 事件重建）、发送 / 停止 / 回答提问 / 置顶归档改名删除。
 * 对话由 pi 会话保存；回答经 `tutor-event` 推送，按对话 id 分发。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '@/components';
import { tutorService } from '@/services/tutorService';
import type { PiEvent, TutorConversation, TutorEventPayload, TutorFileUpload, TutorImage } from '@/types/tutor';
import { applyEvent, emptyTranscript, type TranscriptState } from '@/utils/tutorTranscript';

/** 离开再回来时打开上次的对话 */
let lastConversationId: string | null = null;

/** 要发送的附件 */
export interface Attachment {
  file: File;
  /** 图片预览（object URL） */
  preview?: string;
}

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function useTutorChat(initialPrompt?: string) {
  const toast = useToast();
  const [conversations, setConversations] = useState<TutorConversation[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(initialPrompt ? null : lastConversationId);
  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript());
  const [loading, setLoading] = useState(false);

  const activeRef = useRef(activeId);
  /** 还没确定 id 的新对话、正在打开的对话：先存下事件，确定后补上 */
  const buffer = useRef<{ id: string | null; events: Map<string, PiEvent[]>; holding: boolean }>({
    id: null,
    events: new Map(),
    holding: false,
  });

  const setActiveId = useCallback((id: string | null) => {
    activeRef.current = id;
    lastConversationId = id;
    setActiveIdState(id);
  }, []);

  const refreshList = useCallback(async () => {
    const result = await tutorService.list();
    if (result.success) setConversations(result.data);
  }, []);

  // 列表刷新稍微合并一下（一轮结束时会有好几个事件）
  const refreshTimer = useRef<number | undefined>(undefined);
  const refreshSoon = useCallback(() => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => void refreshList(), 400);
  }, [refreshList]);

  useEffect(() => {
    void refreshList();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<TutorEventPayload>('tutor-event', ({ payload }) => {
      const { conversationId, event } = payload;
      if (['agent_start', 'agent_settled', 'session_info_changed', 'redlark_closed'].includes(event.type)) refreshSoon();
      const b = buffer.current;
      if (b.holding && (b.id === null || b.id === conversationId)) {
        b.events.set(conversationId, [...(b.events.get(conversationId) ?? []), event]);
        return;
      }
      if (conversationId === activeRef.current) setTranscript((s) => applyEvent(s, event));
    }).then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
      window.clearTimeout(refreshTimer.current);
    };
  }, [refreshList, refreshSoon]);

  /** 结束暂存：把这个对话暂存的事件补到状态上 */
  const release = (id: string, state: TranscriptState) => {
    const events = buffer.current.events.get(id) ?? [];
    buffer.current = { id: null, events: new Map(), holding: false };
    return events.reduce(applyEvent, state);
  };

  const open = useCallback(
    async (id: string) => {
      setActiveId(id);
      setTranscript(emptyTranscript());
      setLoading(true);
      buffer.current = { id, events: new Map(), holding: true };
      const result = await tutorService.open(id);
      if (activeRef.current !== id) return;
      setLoading(false);
      if (!result.success) {
        buffer.current = { id: null, events: new Map(), holding: false };
        toast.showError('无法打开这个对话', result.error);
        return;
      }
      setTranscript(release(id, emptyTranscript(result.data.messages, result.data.running)));
    },
    [setActiveId, toast]
  );

  // 进入时打开上次的对话
  useEffect(() => {
    if (activeId) void open(activeId);
  }, []);

  const newConversation = useCallback(() => {
    setActiveId(null);
    setTranscript(emptyTranscript());
  }, [setActiveId]);

  const send = useCallback(
    async (text: string, attachments: Attachment[] = []): Promise<boolean> => {
      const message = text.trim();
      // 图片（选的、粘贴的截图）直接随消息发；其它文件放进对话的资料夹，AI 老师用工具读
      const imageFiles = attachments.filter((a) => a.file.type.startsWith('image/'));
      const otherFiles = attachments.filter((a) => !a.file.type.startsWith('image/'));
      if (!message && attachments.length === 0) return false;
      let images: TutorImage[];
      let files: TutorFileUpload[];
      try {
        images = await Promise.all(imageFiles.map(async (a) => ({ data: await readBase64(a.file), mimeType: a.file.type })));
        files = await Promise.all(otherFiles.map(async (a) => ({ name: a.file.name, data: await readBase64(a.file) })));
      } catch {
        toast.showError('无法读取文件');
        return false;
      }
      const conversationId = activeRef.current;
      setTranscript((s) => ({
        ...s,
        running: true,
        pendingUser: { text: message, images: imageFiles.map((a) => a.preview ?? ''), files: otherFiles.map((a) => a.file.name) },
      }));
      // 新对话：id 由后端返回，期间的事件先存着
      if (!conversationId) buffer.current = { id: null, events: new Map(), holding: true };
      const result = await tutorService.send({ conversationId: conversationId ?? undefined, message, images, files });
      if (!result.success) {
        if (!conversationId) buffer.current = { id: null, events: new Map(), holding: false };
        setTranscript((s) => ({ ...s, running: false, pendingUser: null }));
        toast.showError('没能发出去', result.error);
        return false;
      }
      if (!conversationId) {
        const id = result.data;
        setActiveId(id);
        setTranscript((s) => release(id, s));
        refreshSoon();
      }
      return true;
    },
    [setActiveId, refreshSoon, toast]
  );

  const stop = useCallback(async () => {
    const id = activeRef.current;
    if (!id) return;
    const result = await tutorService.stop(id);
    if (!result.success) toast.showError('没能停止', result.error);
  }, [toast]);

  const answer = useCallback(
    async (reply: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      const id = activeRef.current;
      const ask = transcript.ask;
      if (!id || !ask) return;
      setTranscript((s) => ({ ...s, ask: null }));
      const result = await tutorService.answer({ conversationId: id, requestId: ask.id, ...reply });
      if (!result.success) toast.showError('没能回复', result.error);
    },
    [transcript.ask, toast]
  );

  const setFlags = useCallback(
    async (id: string, pinned: boolean, archived: boolean) => {
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, pinned, archived } : c)));
      const result = await tutorService.setFlags(id, pinned, archived);
      if (!result.success) {
        toast.showError('没能保存', result.error);
        void refreshList();
      }
    },
    [refreshList, toast]
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const result = await tutorService.rename(id, name);
      if (!result.success) toast.showError('无法重命名', result.error);
      void refreshList();
    },
    [refreshList, toast]
  );

  const remove = useCallback(
    async (id: string) => {
      const result = await tutorService.remove(id);
      if (!result.success) {
        toast.showError('无法删除', result.error);
        return;
      }
      if (activeRef.current === id) newConversation();
      setConversations((list) => list.filter((c) => c.id !== id));
    },
    [newConversation, toast]
  );

  return {
    conversations,
    activeId,
    transcript,
    loading,
    open,
    newConversation,
    send,
    stop,
    answer,
    setFlags,
    rename,
    remove,
  };
}
