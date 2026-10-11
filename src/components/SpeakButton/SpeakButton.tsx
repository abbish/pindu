import React from 'react';
import { AudioLines, Loader2, Snail, Volume2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SpeakStatus } from '@/hooks/useAudioPlayer';

/** 朗读图标：空闲是喇叭（慢速是蜗牛），生成语音时转圈，播放中是跳动的声波（慢速是跳动的蜗牛） */
export const SpeakIcon: React.FC<{ status: SpeakStatus; slow?: boolean; icon?: LucideIcon; className?: string }> = ({ status, slow, icon, className }) => {
  if (status === 'loading') return <Loader2 className={cn('animate-spin', className)} />;
  const Icon = slow ? Snail : status === 'playing' ? AudioLines : (icon ?? Volume2);
  return <Icon className={cn(status === 'playing' && 'animate-pulse', className)} />;
};

export interface SpeakButtonProps extends Omit<React.ComponentProps<typeof Button>, 'onClick' | 'children'> {
  status: SpeakStatus;
  onClick: () => void;
  /** 慢速（蜗牛图标） */
  slow?: boolean;
  /** 按钮做什么，如「发音」「慢速发音」「朗读例句」；播放中读作「停止…」 */
  label: string;
  /** 图标后的文字（不填只显示图标） */
  text?: React.ReactNode;
  /** 空闲时的图标（默认喇叭，如例句用对话气泡区分） */
  icon?: LucideIcon;
}

/**
 * 朗读按钮（全应用统一）：点一下开始读，生成语音时显示转圈，播放中高亮并显示声波，再点一下停止。
 * 状态来自 useAudioPlayer 的 `speak(text, …)`。
 */
export const SpeakButton: React.FC<SpeakButtonProps> = ({ status, onClick, slow, label, text, icon, className, ...props }) => {
  const busy = status !== 'idle';
  const name = busy ? `停止${label}` : label;
  return (
    <Button
      {...props}
      aria-label={text ? undefined : name}
      aria-busy={status === 'loading' || undefined}
      data-state={busy ? 'on' : 'off'}
      className={cn(busy && 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary', className)}
      onClick={onClick}
    >
      <SpeakIcon status={status} slow={slow} icon={icon} />
      {text}
    </Button>
  );
};
