import React from 'react';
import { GraduationCap, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { WordExplanationView } from '@/components/WordExplanation';
import { cn } from '@/lib/utils';

/** 老师头像 */
export const TeacherAvatar: React.FC<{ className?: string }> = ({ className }) => (
  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground', className)}>
    <GraduationCap className="size-5" />
  </span>
);

export interface AiTeacherSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 正在讲的单词（显示用） */
  word: string;
  /** 讲解 / 答疑用的 id（单词本的词为 wordId，单词卡为负数 id） */
  wordId: number;
}

/**
 * AI 老师的对话面板：从右侧滑出，不遮挡、不拦截页面——开着它也能继续切换单词，老师跟着讲新的词。
 * 同一个词的对话在单词卡、练习、短文与视频里共用（D43）。
 */
export const AiTeacherSheet: React.FC<AiTeacherSheetProps> = ({ open, onOpenChange, word, wordId }) => (
  <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
    <SheetContent
      side="right"
      className="gap-0 sm:max-w-md"
      // 点页面其它地方（如切换单词）不关闭面板
      onInteractOutside={(e) => e.preventDefault()}
    >
      <SheetHeader className="flex-row items-center gap-3 border-b">
        <TeacherAvatar />
        <div className="min-w-0">
          <SheetTitle>AI 老师</SheetTitle>
          <SheetDescription className="truncate">正在讲 {word}</SheetDescription>
        </div>
      </SheetHeader>
      <div className="min-h-0 flex-1 p-4">
        <WordExplanationView key={wordId} wordId={wordId} active={open} autoGenerate fill />
      </div>
    </SheetContent>
  </Sheet>
);

/** 单词卡上的老师入口：醒目的一块，点「讲讲这个词」打开对话面板 */
export const AiTeacherEntry: React.FC<{ word: string; onOpen: () => void; open: boolean }> = ({ word, onOpen, open }) => (
  <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-accent/50 px-4 py-3">
    <TeacherAvatar />
    <div className="min-w-0 flex-1">
      <div className="font-medium">AI 老师</div>
      <div className="truncate text-sm text-muted-foreground">{open ? `正在讲 ${word}` : `${word} 怎么拼、怎么记、怎么用，都可以问我`}</div>
    </div>
    <Button onClick={onOpen} disabled={open}>
      <MessageCircle />
      讲讲这个词
    </Button>
  </div>
);
