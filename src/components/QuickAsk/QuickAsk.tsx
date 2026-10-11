import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavigateFn } from '@/navigation';

/**
 * 顶栏右侧的快速对话：在任何页面输入一句话，回车就开一个新的 AI 老师对话。⌘K 聚焦。
 */
export const QuickAsk: React.FC<{ onNavigate: NavigateFn }> = ({ onNavigate }) => {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = () => {
    const prompt = text.trim();
    if (!prompt) return;
    setText('');
    input.current?.blur();
    onNavigate('tutor', { prompt, at: Date.now() });
  };

  return (
    <div
      className={cn(
        'flex h-8 w-72 items-center gap-1.5 rounded-md border bg-background pr-1 pl-2 text-sm',
        'focus-within:w-96 focus-within:ring-1 focus-within:ring-ring transition-[width] max-md:w-48'
      )}
    >
      <GraduationCap className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={input}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            setText('');
            input.current?.blur();
          }
        }}
        placeholder="问 AI 老师，或让它帮你做点什么"
        aria-label="问 AI 老师"
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
      />
      {text.trim() ? (
        <button
          type="button"
          onClick={submit}
          aria-label="发送"
          className="flex size-6 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground"
        >
          <ArrowUp className="size-3.5" />
        </button>
      ) : (
        <kbd className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">⌘K</kbd>
      )}
    </div>
  );
};
