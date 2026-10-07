import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { type PracticeSession } from '@/types/study';
import {
  formatActiveTime,
  lastActiveLabel,
  practiceProgress,
  scheduleLabel,
  scheduleTiming,
  sortByLastActive,
} from '@/utils/incompletePractice';

export interface IncompletePracticeModalProps {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 未完成的练习会话列表 */
  sessions: PracticeSession[];
  /** 继续练习 */
  onContinue: (session: PracticeSession) => void;
  /** 放弃练习（已经过用户确认；会删除这次练习的作答记录） */
  onDiscard: (session: PracticeSession) => void;
  /** 关闭（稍后再说） */
  onClose: () => void;
}

const planName = (s: PracticeSession) => s.planTitle || `学习计划 #${s.planId}`;

/** 一次练习的摘要：日程、进度、词数、已练时长与上次练习时间 */
const SessionSummary: React.FC<{ session: PracticeSession }> = ({ session }) => {
  const progress = practiceProgress(session);
  const overdue = scheduleTiming(session.scheduleDate) === 'overdue';
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className={cn('text-muted-foreground', overdue && 'font-medium text-warning')}>
          日程：{scheduleLabel(session.scheduleDate)}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {progress.done > 0 ? `已完成 ${progress.done} / ${progress.total} 题` : `还没作答 · 共 ${progress.total} 题`}
        </span>
      </div>
      {progress.done > 0 && <Progress value={percent} className="h-1.5" aria-label={`已完成 ${percent}%`} />}
      <span className="text-xs text-muted-foreground">
        {progress.words} 个词 · 已练 {formatActiveTime(session.activeTime)} ·{' '}
        {lastActiveLabel(session.updatedAt || session.startTime)}练过
      </span>
    </div>
  );
};

/** 放弃确认的说明 */
const discardMessage = (session: PracticeSession) => {
  const { done } = practiceProgress(session);
  return done > 0
    ? `放弃后，这次已做的 ${done} 题作答记录会删除，这个日程需要重新开始。`
    : '这次还没有作答，放弃后下次从头开始。';
};

/**
 * 未完成练习提醒：应用启动后首次进入首页时提示一次。
 * - 只有一次未完成练习：直接展示摘要；主操作「继续练习」默认聚焦（按 Enter 即继续），「放弃」放在左侧次要位置；
 * - 有多次：逐条列出（最近练过的在前），每条各自「继续 / 放弃」。
 * 放弃要再确认一次，确认区默认聚焦「不放弃」。
 */
export const IncompletePracticeModal: React.FC<IncompletePracticeModalProps> = ({
  isOpen,
  sessions,
  onContinue,
  onDiscard,
  onClose,
}) => {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const sorted = sortByLastActive(sessions);
  const single = sorted.length === 1 ? sorted[0] : null;
  const confirming = sorted.find(s => s.sessionId === confirmingId) ?? null;

  const discard = (session: PracticeSession) => {
    setConfirmingId(null);
    onDiscard(session);
  };

  return (
    <Dialog
      open={isOpen && sessions.length > 0}
      onOpenChange={open => {
        if (!open) {
          setConfirmingId(null);
          onClose();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        // 默认聚焦主操作，避免焦点（和 Enter）落在「放弃」上
        onOpenAutoFocus={e => {
          if (continueRef.current) {
            e.preventDefault();
            continueRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>继续上次的练习？</DialogTitle>
          <DialogDescription>
            {single
              ? `「${planName(single)}」有一次练习还没做完，进度已保存。`
              : `有 ${sorted.length} 次练习还没做完，进度都已保存。`}
          </DialogDescription>
        </DialogHeader>

        {single ? (
          <div className="rounded-lg bg-muted/50 p-3">
            <SessionSummary session={single} />
          </div>
        ) : (
          <ul className="flex max-h-[50vh] flex-col divide-y overflow-y-auto rounded-lg border">
            {sorted.map((session, index) => (
              <li key={session.sessionId} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{planName(session)}</div>
                  <SessionSummary session={session} />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button size="sm" ref={index === 0 ? continueRef : undefined} onClick={() => onContinue(session)}>
                    继续
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmingId(session.sessionId)}
                  >
                    放弃
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {confirming ? (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3" role="alert">
            <p className="text-sm">
              {!single && <span className="font-medium">「{planName(confirming)}」：</span>}
              {discardMessage(confirming)}确定放弃吗？
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" autoFocus onClick={() => setConfirmingId(null)}>
                不放弃
              </Button>
              <Button variant="destructive" size="sm" onClick={() => discard(confirming)}>
                确定放弃
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter className="items-center gap-2 sm:justify-between">
            {single ? (
              <Button
                variant="link"
                size="sm"
                className="px-0 text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmingId(single.sessionId)}
              >
                放弃这次练习
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">之后也可以在「日历」页继续。</span>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                稍后再说
              </Button>
              {single && (
                <Button ref={continueRef} onClick={() => onContinue(single)}>
                  继续练习
                </Button>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
