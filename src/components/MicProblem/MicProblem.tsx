import React from 'react';
import { MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dataManagementService } from '@/services/dataManagementService';
import type { MicProblemKind } from '@/utils/microphone';

/** 打开系统设置里的麦克风权限（拒绝过以后系统不再弹授权框） */
export const openMicrophoneSettings = () => void dataManagementService.openMicrophoneSettings();

export interface MicProblemProps {
  /** 给学习者看的原因（useRecorder 的 error） */
  message: string;
  /** 原因的种类：denied 时给出「打开系统设置」 */
  problem: MicProblemKind | null;
  className?: string;
}

/** 麦克风打不开：说明原因；权限没打开时一键打开系统设置 */
export const MicProblem: React.FC<MicProblemProps> = ({ message, problem, className }) => (
  <div className={cn('flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground', className)} role="alert">
    <MicOff className="size-4 shrink-0 text-destructive" />
    <span className="min-w-0 flex-1">{message}</span>
    {problem === 'denied' && (
      <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={openMicrophoneSettings}>
        打开系统设置
      </Button>
    )}
  </div>
);
