/**
 * AI 老师：独立的智能体对话。用户说要做什么，AI 自己查、读、做，过程按步骤列出，收进来的素材出现在对话里。
 * 对话由 pi 会话保存（handlers/tutor.rs）；页面按 pi 的事件重建对话（utils/tutorTranscript.ts）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap, Loader2, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { NavigateFn } from '@/navigation';
import { toTurns } from '@/utils/tutorTranscript';
import { Composer } from './tutor/Composer';
import { ConversationList } from './tutor/ConversationList';
import { AgentTurnView, OutputsPopover, UserBubble } from './tutor/TurnViews';
import { useTutorChat, type Attachment } from './tutor/useTutorChat';

/**
 * 新对话的开场示例。模板（fill）只填开头、光标停在后面让学习者补上自己的内容；
 * 完整的指令直接发；attach 同时打开选文件。
 */
interface Starter {
  title: string;
  text: string;
  /** 模板：填进输入框等学习者补全 */
  fill?: boolean;
  /** 同时打开选文件 */
  attach?: boolean;
}

const STARTERS: Starter[] = [
  { title: '查一个词', text: '这个词是什么意思？怎么记：', fill: true },
  { title: '翻译一段话', text: '帮我翻译这段话，顺便讲讲里面的长句：\n', fill: true },
  { title: '讲讲语法', text: '给我讲讲这个语法点，多举几个例子：', fill: true },
  { title: '按场景备词汇', text: '帮我准备一个词汇本，场景是：', fill: true },
  { title: '整理一份材料', text: '帮我看看这份材料，把值得学的词和文章整理出来', fill: true, attach: true },
  { title: '考考我', text: '根据我最近容易错的词考考我' },
];

export const TutorPage: React.FC<{ initialPrompt?: string; onNavigate: NavigateFn }> = ({ initialPrompt, onNavigate }) => {
  const chat = useTutorChat(initialPrompt);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** 变化时输入框获得焦点、光标到末尾（开场示例用）；openPicker 打开选文件 */
  const [focusKey, setFocusKey] = useState(0);
  const openPicker = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const turns = useMemo(() => toTurns(chat.transcript), [chat.transcript]);
  const outputs = useMemo(
    () => turns.flatMap((t) => (t.role === 'agent' ? t.steps.flatMap((s) => (s.output ? [s.output] : [])) : [])),
    [turns]
  );
  const active = chat.conversations.find((c) => c.id === chat.activeId);
  const running = chat.transcript.running;

  // 新内容到来时滚到底（用户往上翻看时不打扰）
  const pinnedToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) el.scrollTo({ top: el.scrollHeight });
  }, [turns]);

  const send = async (text: string, files: Attachment[] = attachments) => {
    // 有提问在等：输入的文字就是回答（不然消息会排在提问后面，两边互相等）
    const ask = chat.transcript.asks[0];
    if (ask && text.trim() && files.length === 0 && ask.method !== 'confirm') {
      setDraft('');
      await chat.answer({ value: text.trim() });
      return;
    }
    // 确认类的提问：先当作「不用」，再把这句话发出去
    if (ask?.method === 'confirm') await chat.answer({ confirmed: false });
    const keep = { draft, attachments };
    setDraft('');
    setAttachments([]);
    pinnedToBottom.current = true;
    const ok = await chat.send(text, files);
    if (!ok) {
      setDraft(keep.draft);
      setAttachments(keep.attachments);
    }
  };

  // 从顶栏快速对话进来：开新对话并发出这句（只在进入时发一次）
  const started = useRef(false);
  useEffect(() => {
    if (!initialPrompt || started.current) return;
    started.current = true;
    void send(initialPrompt, []);
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/30">
        <div className="p-3">
          <Button variant="outline" className="w-full justify-start" onClick={chat.newConversation}>
            <MessageSquarePlus /> 新对话
          </Button>
        </div>
        <ConversationList
          conversations={chat.conversations}
          activeId={chat.activeId}
          onOpen={(id) => id !== chat.activeId && void chat.open(id)}
          onFlags={(id, pinned, archived) => void chat.setFlags(id, pinned, archived)}
          onRename={(id, name) => void chat.rename(id, name)}
          onDelete={(id) => void chat.remove(id)}
        />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <div className="min-w-0 flex-1 truncate text-sm font-medium" title={active?.title}>
            {chat.activeId ? (active?.title ?? '') : '新对话'}
          </div>
          {outputs.length > 0 && <OutputsPopover outputs={outputs} onNavigate={onNavigate} />}
        </header>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {chat.loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : turns.length > 0 ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
              {turns.map((turn, i) =>
                turn.role === 'user' ? (
                  <UserBubble key={turn.key} turn={turn} />
                ) : (
                  <AgentTurnView
                    key={turn.key}
                    turn={turn}
                    ask={i === turns.length - 1 ? (chat.transcript.asks[0] ?? null) : null}
                    askCount={chat.transcript.asks.length}
                    onExpireAsk={chat.expireAsk}
                    notice={chat.transcript.notice}
                    onAnswer={(reply) => void chat.answer(reply)}
                    onSuggest={i === turns.length - 1 ? (text) => void send(text, []) : undefined}
                    onNavigate={onNavigate}
                  />
                )
              )}
            </div>
          ) : (
            <EmptyState
              onPick={(starter) => {
                if (!starter.fill) {
                  void send(starter.text, []);
                  return;
                }
                setDraft(starter.text);
                setFocusKey((k) => k + 1);
                if (starter.attach) openPicker.current?.();
              }}
            />
          )}
        </div>

        <Composer
          draft={draft}
          attachments={attachments}
          running={running}
          answering={chat.transcript.asks.length > 0}
          focusKey={focusKey}
          pickerRef={openPicker}
          queue={chat.transcript.queue}
          onEditQueued={(i) =>
            void chat.dropQueued(i).then((text) => {
              if (text !== null) setDraft((d) => (d.trim() ? `${text}\n${d}` : text));
            })
          }
          onRemoveQueued={(i) => void chat.dropQueued(i)}
          onDraft={setDraft}
          onAttachments={setAttachments}
          onSend={() => void send(draft)}
          onStop={() =>
            // 排队的消息放回输入框（pi 的做法：停止前先清空队列）
            void chat.stop().then((queued) => {
              if (queued.length > 0) setDraft((d) => [...queued, d].filter((t) => t.trim()).join('\n'));
            })
          }
        />
      </section>
    </div>
  );
};

const EmptyState: React.FC<{ onPick: (starter: Starter) => void }> = ({ onPick }) => (
  <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-6">
    <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
      <GraduationCap className="size-6" />
    </span>
    <div className="text-center">
      <div className="text-lg font-semibold">想学点什么？</div>
      <div className="mt-1 text-sm text-muted-foreground">查词、翻译、讲语法，整理材料、准备词汇，也可以直接粘贴截图问我</div>
    </div>
    <div className="grid w-full grid-cols-2 gap-2">
      {STARTERS.map((s) => (
        <button key={s.title} type="button" onClick={() => onPick(s)} className="rounded-lg border p-3 text-left hover:bg-accent">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-medium">{s.title}</span>
            <span className="text-xs text-muted-foreground">{s.attach ? '选文件' : s.fill ? '填进输入框' : '直接发送'}</span>
          </div>
          <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {s.text.trim()}
            {s.fill && !s.attach && <span className="opacity-60"> ……</span>}
          </div>
        </button>
      ))}
    </div>
  </div>
);
