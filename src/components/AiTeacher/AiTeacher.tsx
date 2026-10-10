import React from 'react';
import { createPortal } from 'react-dom';
import { GraduationCap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { WordExplanationView } from '@/components/WordExplanation';
import { cn } from '@/lib/utils';

/** 老师头像 */
export const TeacherAvatar: React.FC<{ className?: string }> = ({ className }) => (
  <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground', className)}>
    <GraduationCap className="size-4" />
  </span>
);

export interface AiTeacherPanelProps {
  /** 正在讲的单词（显示用） */
  word: string;
  /** 讲解 / 答疑用的 id（单词本的词为 wordId，单词卡为负数 id） */
  wordId: number;
  onClose: () => void;
}

/**
 * AI 老师的对话面板：固定在窗口右侧（标题栏下方到窗口底部），不随页面滚动，输入框一直可见、对话在面板里滚动；开着时切换单词，老师跟着讲新的词。
 * 同一个词的对话在单词卡、练习、短文与视频里共用（D43）。
 */
export const AiTeacherPanel: React.FC<AiTeacherPanelProps> = ({ word, wordId, onClose }) =>
  // 固定在窗口右侧：上到标题栏（面包屑）下方、下到窗口底部，主页面滚动不影响；浮在内容之上，不挤占单词卡
  createPortal(
    <Card className="fixed top-[calc(3rem+0.75rem)] right-3 bottom-3 z-30 w-[380px] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden py-0 shadow-xl duration-200 animate-in fade-in slide-in-from-right-4">
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <TeacherAvatar />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">AI 老师</div>
          <div className="truncate text-xs text-muted-foreground">正在讲 {word}</div>
        </div>
        <Button variant="ghost" size="icon" className="size-8" aria-label="关闭 AI 老师" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 pt-4 pb-4">
        <WordExplanationView key={wordId} wordId={wordId} word={word} active fill />
      </div>
    </Card>,
    document.body
  );
