/**
 * AI 老师页的数据：对话列表、当前对话（按 pi 事件重建）、发送 / 停止 / 回答提问 / 置顶归档改名删除。
 * 对话由 pi 会话保存；回答经 `tutor-event` 推送，按对话 id 分发。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '@/components';
import { tutorService } from '@/services/tutorService';
import { forgetTutorActivity } from '@/hooks/useTutorActivity';
import type { PiEvent, TutorConversation, TutorEventPayload, TutorFileUpload, TutorImage } from '@/types/tutor';
import { applyEvent, dropAsk, emptyTranscript, openedTranscript, toAsk, type SeqEvent, type TranscriptState, type TutorAsk } from '@/utils/tutorTranscript';

/** 离开再回来时打开上次的对话 */
let lastConversationId: string | null = null;
/** 上次的对话列表：再进来时先显示，后台再刷新 */
let lastConversations: TutorConversation[] | null = null;
/** 正在进行的列表请求（同一时间只发一个） */
let listing: ReturnType<typeof tutorService.list> | null = null;

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** 图片的类型（按扩展名判断：WebView 有时不给 File.type）；不是图片返回 null */
export function imageMime(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME[ext] ?? (file.type.startsWith('image/') ? file.type : null);
}

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

/** initialConversationId：进入时打开这个对话（默认打开上次的；有 initialPrompt 时开新对话） */
export function useTutorChat(initialPrompt?: string, initialConversationId?: string) {
  const toast = useToast();
  const [conversations, setConversationsState] = useState<TutorConversation[]>(lastConversations ?? []);
  /** 第一次加载列表（还没有上次的列表可显示） */
  const [listLoading, setListLoading] = useState(lastConversations === null);
  const setConversations = useCallback((update: React.SetStateAction<TutorConversation[]>) => {
    setConversationsState((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      lastConversations = next;
      return next;
    });
  }, []);
  const [activeId, setActiveIdState] = useState<string | null>(initialConversationId ?? (initialPrompt ? null : lastConversationId));
  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript());
  const [loading, setLoading] = useState(false);

  const activeRef = useRef(activeId);
  /** 当前对话打开时的快照序号：之后到达的、不大于它的事件已经算在快照里 */
  const seqFloor = useRef(0);
  /** 还没确定 id 的新对话、正在打开的对话：先存下事件（带序号），确定后补上 */
  const buffer = useRef<{ id: string | null; events: Map<string, SeqEvent[]>; holding: boolean }>({
    id: null,
    events: new Map(),
    holding: false,
  });

  const setActiveId = useCallback((id: string | null) => {
    activeRef.current = id;
    lastConversationId = id;
    setActiveIdState(id);
  }, []);

  // pi 的事件按帧合并处理：流式增量很密，逐个重画会让界面一卡一卡
  const pending = useRef<{ id: string; event: PiEvent }[]>([]);
  const frame = useRef(0);
  const enqueue = useCallback((id: string, event: PiEvent) => {
    pending.current.push({ id, event });
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      // 这一帧里切换了对话：只用当前对话的
      const events = pending.current.filter((p) => p.id === activeRef.current).map((p) => p.event);
      pending.current = [];
      if (events.length > 0) setTranscript((s) => events.reduce(applyEvent, s));
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const refreshList = useCallback(async () => {
    listing ??= tutorService.list().finally(() => {
      listing = null;
    });
    const result = await listing;
    setListLoading(false);
    if (result.success) setConversations(result.data);
  }, [setConversations]);

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
      const { conversationId, seq, event } = payload;
      // pi 扩展的通知（如连不上拼读的工具服务）：轻提示
      if (event.type === 'extension_ui_request' && 'method' in event && event.method === 'notify' && conversationId === activeRef.current) {
        const { message, notifyType } = event as { message?: string; notifyType?: string };
        if (message) (notifyType === 'error' ? toast.showError : notifyType === 'warning' ? toast.showWarning : toast.showInfo)(message);
      }
      if (['agent_start', 'agent_settled', 'session_info_changed', 'redlark_closed'].includes(event.type)) refreshSoon();
      const b = buffer.current;
      if (b.holding && (b.id === null || b.id === conversationId)) {
        b.events.set(conversationId, [...(b.events.get(conversationId) ?? []), { seq, event }]);
        return;
      }
      if (conversationId === activeRef.current && seq > seqFloor.current) enqueue(conversationId, event);
    }).then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
      window.clearTimeout(refreshTimer.current);
    };
  }, [refreshList, refreshSoon]);

  /** 结束暂存：取出这个对话暂存的事件 */
  const release = (id: string): SeqEvent[] => {
    const events = buffer.current.events.get(id) ?? [];
    buffer.current = { id: null, events: new Map(), holding: false };
    return events;
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
      const asks = result.data.pendingAsks.map((raw) => toAsk(raw)).filter((a): a is TutorAsk => a !== null);
      // 回答写到一半时打开：从快照接着显示，打开期间收到的事件只补快照之后的
      seqFloor.current = result.data.seq;
      setTranscript(openedTranscript(result.data, asks, release(id)));
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
      const imageFiles = attachments.filter((a) => imageMime(a.file));
      const otherFiles = attachments.filter((a) => !imageMime(a.file));
      if (!message && attachments.length === 0) return false;
      let images: TutorImage[];
      let files: TutorFileUpload[];
      try {
        images = await Promise.all(
          imageFiles.map(async (a) => ({ data: await readBase64(a.file), mimeType: imageMime(a.file) ?? 'image/png' }))
        );
        files = await Promise.all(otherFiles.map(async (a) => ({ name: a.file.name, data: await readBase64(a.file) })));
      } catch {
        toast.showError('无法读取文件');
        return false;
      }
      const conversationId = activeRef.current;
      // 运行中发的进 pi 的队列（显示在输入框上方）；空闲时先显示出来
      setTranscript((s) =>
        s.running
          ? s
          : {
              ...s,
              running: true,
              pendingUser: { text: message, images: imageFiles.map((a) => a.preview ?? ''), files: otherFiles.map((a) => a.file.name) },
            }
      );
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
        const later = release(id);
        setTranscript((s) => later.reduce((state, e) => applyEvent(state, e.event), s));
        refreshSoon();
      }
      return true;
    },
    [setActiveId, refreshSoon, toast]
  );

  /** 停止；返回被清掉的排队消息（放回输入框） */
  const stop = useCallback(async (): Promise<string[]> => {
    const id = activeRef.current;
    if (!id) return [];
    const result = await tutorService.stop(id);
    if (!result.success) {
      toast.showError('没能停止', result.error);
      return [];
    }
    return result.data;
  }, [toast]);

  /** 从队列里拿掉一条（删除，或拿回输入框编辑） */
  const dropQueued = useCallback(
    async (index: number): Promise<string | null> => {
      const id = activeRef.current;
      const queue = transcript.queue;
      if (!id || index < 0 || index >= queue.length) return null;
      const removed = queue[index];
      const rest = queue.filter((_, i) => i !== index);
      setTranscript((s) => ({ ...s, queue: rest }));
      const result = await tutorService.setQueue(id, rest);
      if (!result.success) {
        toast.showError('没能修改排队的消息', result.error);
        return null;
      }
      return removed;
    },
    [transcript.queue, toast]
  );

  /** 回答排在最前面的提问 */
  const answer = useCallback(
    async (reply: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      const id = activeRef.current;
      const ask = transcript.asks[0];
      if (!id || !ask) return;
      setTranscript((s) => dropAsk(s, ask.id));
      const result = await tutorService.answer({ conversationId: id, requestId: ask.id, ...reply });
      if (!result.success) toast.showError('没能回复', result.error);
    },
    [transcript.asks, toast]
  );

  /** 带超时的提问过期了：pi 已按默认值收回，界面上拿掉 */
  const expireAsk = useCallback((askId: string) => setTranscript((s) => dropAsk(s, askId)), []);

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
      forgetTutorActivity(id);
    },
    [newConversation, toast]
  );

  return {
    conversations,
    listLoading,
    activeId,
    transcript,
    loading,
    open,
    newConversation,
    send,
    stop,
    dropQueued,
    answer,
    expireAsk,
    setFlags,
    rename,
    remove,
  };
}
