import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/Toast/ToastContainer';
import { lanService } from '@/services/lanService';
import { LAN_EVENTS, osLabel, type PairRequest, type PairRequestClosed } from '@/types/lan';

/** 6 位配对码分两组显示，便于对照 */
export const PairingCode: React.FC<{ code: string }> = ({ code }) => (
  <div className="flex justify-center gap-3 py-2 font-mono text-4xl font-semibold tracking-[0.2em] tabular-nums">
    <span>{code.slice(0, 3)}</span>
    <span>{code.slice(3)}</span>
  </div>
);

/**
 * 别的设备发来的配对请求（App 级，任何页面都会弹出）：核对数字后同意或拒绝。
 * 同时来了几个时逐个处理；对方取消或超时时自动关闭。
 */
export const LanPairRequest: React.FC = () => {
  const toast = useToast();
  const [queue, setQueue] = useState<PairRequest[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    void lanService.getPendingPairRequests().then((r) => r.success && setQueue(r.data));
    const offs = [
      listen<PairRequest>(LAN_EVENTS.pairRequest, ({ payload }) =>
        setQueue((q) => [...q.filter((r) => r.requestId !== payload.requestId), payload])
      ),
      listen<PairRequestClosed>(LAN_EVENTS.pairRequestClosed, ({ payload }) => {
        const req = queueRef.current.find((r) => r.requestId === payload.requestId);
        setQueue((q) => q.filter((r) => r.requestId !== payload.requestId));
        if (payload.reason === 'accepted') toast.showSuccess(`已和「${req?.alias ?? '对方'}」配对`);
        else if (req && payload.reason === 'canceled') toast.showInfo(`「${req.alias}」取消了配对请求`);
        else if (req && payload.reason === 'timeout') toast.showInfo(`「${req.alias}」的配对请求已过期`);
      }),
    ];
    return () => offs.forEach((off) => void off.then((f) => f()));
  }, [toast]);

  const current = queue[0];
  const respond = async (accept: boolean) => {
    if (!current) return;
    setQueue((q) => q.filter((r) => r.requestId !== current.requestId));
    const r = await lanService.respondPairRequest(current.requestId, accept);
    if (!r.success) toast.showError(accept ? '无法配对' : '无法拒绝', r.error);
  };

  return (
    <Dialog open={current !== undefined} onOpenChange={(open) => !open && void respond(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>「{current?.alias}」想和这台电脑配对</DialogTitle>
          <DialogDescription>
            {current && `${osLabel(current.os)} · ${current.address}。`}确认对方屏幕上也是这串数字再同意。
          </DialogDescription>
        </DialogHeader>
        {current && <PairingCode code={current.code} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => void respond(false)}>
            拒绝
          </Button>
          <Button onClick={() => void respond(true)}>配对</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
