import React from 'react';
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
 * AI 老师的对话面板：贴在单词卡右侧，与单词卡等高、最高不超过可视区域并贴住顶部（输入框一直可见，对话在面板里滚动）；开着时切换单词，老师跟着讲新的词。
 * 同一个词的对话在单词卡、练习、短文与视频里共用（D43）。
 */
export const AiTeacherPanel: React.FC<AiTeacherPanelProps> = ({ word, wordId, onClose }) => (
  // 外层只占宽度、高度随单词卡（面板绝对定位，不把单词卡撑高）；面板贴住可视区域顶部，最高不超过可视区域，
  // 单词卡很长时往下滚，面板与输入框一直在视野里
  <div className="relative w-[300px] shrink-0 2xl:w-[380px]">
    <div className="absolute inset-0">
      <Card className="sticky top-4 h-full max-h-[calc(100svh-6rem)] gap-0 overflow-hidden py-0">
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
      <div className="min-h-0 flex-1 p-4">
        <WordExplanationView key={wordId} wordId={wordId} active autoGenerate fill />
      </div>
      </Card>
    </div>
  </div>
);
