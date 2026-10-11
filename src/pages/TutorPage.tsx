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

/** 新对话的开场建议 */
const STARTERS = [
  { title: '查一个词', prompt: 'itinerary 是什么意思？怎么记？' },
  { title: '翻译一段话', prompt: '帮我翻译这段话，顺便讲讲里面的长句：' },
  { title: '讲讲语法', prompt: '现在完成时和一般过去时有什么区别？' },
  { title: '看一张截图', prompt: '帮我看看这张截图里的英语' },
];

export const TutorPage: React.FC<{ initialPrompt?: string; onNavigate: NavigateFn }> = ({ initialPrompt, onNavigate }) => {
  const chat = useTutorChat(initialPrompt);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
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
                    ask={i === turns.length - 1 ? chat.transcript.ask : null}
                    notice={chat.transcript.notice}
                    onAnswer={(reply) => void chat.answer(reply)}
                    onNavigate={onNavigate}
                  />
                )
              )}
            </div>
          ) : (
            <EmptyState onPick={setDraft} />
          )}
        </div>

        <Composer
          draft={draft}
          attachments={attachments}
          running={running}
          onDraft={setDraft}
          onAttachments={setAttachments}
          onSend={() => void send(draft)}
          onStop={() => void chat.stop()}
        />
      </section>
    </div>
  );
};

const EmptyState: React.FC<{ onPick: (prompt: string) => void }> = ({ onPick }) => (
  <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-6">
    <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
      <GraduationCap className="size-6" />
    </span>
    <div className="text-center">
      <div className="text-lg font-semibold">想学点什么？</div>
      <div className="mt-1 text-sm text-muted-foreground">查词、翻译、讲语法，也可以直接粘贴截图问我</div>
    </div>
    <div className="grid w-full grid-cols-2 gap-2">
      {STARTERS.map((s) => (
        <button key={s.title} type="button" onClick={() => onPick(s.prompt)} className="rounded-lg border p-3 text-left hover:bg-accent">
          <div className="text-sm font-medium">{s.title}</div>
          <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{s.prompt}</div>
        </button>
      ))}
    </div>
  </div>
);
