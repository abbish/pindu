import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useElapsed } from '@/hooks/useElapsed';
import { formatDuration } from '@/utils/datetime';

/**
 * 需要等 AI 结果才能继续的操作（生成单词、内容规划等十几秒到一分钟）：在结果的位置显示
 * 「AI 正在…」+ 已用时间。停止按钮由调用方放在操作栏（弹窗底部 / 页面底部），文案统一为「停止」。
 */
export const AiWorking: React.FC<{ title: string; detail?: React.ReactNode }> = ({ title, detail }) => {
  const [since] = useState(() => Date.now());
  const elapsed = useElapsed(since);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center" role="status">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent">
        <Loader2 className="size-6 animate-spin text-primary" />
      </span>
      <div className="font-medium">{title}</div>
      <div className="max-w-md text-sm text-muted-foreground">
        {detail}
        {detail ? ' · ' : ''}已用 {formatDuration((elapsed ?? 0) * 1000)}
      </div>
    </div>
  );
};
