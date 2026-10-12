import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/Toast/ToastContainer';
import { lanService } from '@/services/lanService';
import { formatBytes, LAN_EVENTS, summaryText, type TransferClosed, type TransferOffer } from '@/types/lan';

/**
 * 已配对的设备想发送内容（App 级，任何页面都会弹出）：每次都要确认。
 * 接收后在后台进行（后台任务里看进度），收完自动加进素材库与计划；对方取消或超时时自动关闭。
 */
export const LanTransferOffer: React.FC = () => {
  const toast = useToast();
  const [offer, setOffer] = useState<TransferOffer | null>(null);
  const offerRef = useRef(offer);
  offerRef.current = offer;

  useEffect(() => {
    void lanService.getPendingTransfer().then((r) => r.success && r.data && setOffer(r.data));
    const offs = [
      listen<TransferOffer>(LAN_EVENTS.transferOffer, ({ payload }) => setOffer(payload)),
      listen<TransferClosed>(LAN_EVENTS.transferClosed, ({ payload }) => {
        const current = offerRef.current;
        if (current?.transferId !== payload.transferId) return;
        setOffer(null);
        if (payload.reason === 'canceled') toast.showInfo(`「${current.alias}」取消了发送`);
        else if (payload.reason === 'timeout') toast.showInfo(`「${current.alias}」发来的内容没有接收（已过期）`);
      }),
    ];
    return () => offs.forEach((off) => void off.then((f) => f()));
  }, [toast]);

  const respond = async (accept: boolean) => {
    if (!offer) return;
    const current = offer;
    setOffer(null);
    const r = await lanService.respondTransferOffer(current.transferId, accept);
    if (!r.success) toast.showError(accept ? '无法接收' : '无法拒绝', r.error);
    else if (accept) toast.showInfo(`正在接收「${current.alias}」发来的内容`, '收完会自动加进来，进度在后台任务里');
  };

  const s = offer?.summary;
  return (
    <Dialog open={offer !== null} onOpenChange={(open) => !open && void respond(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>「{offer?.alias}」想发送内容给你</DialogTitle>
          <DialogDescription>{s && `${summaryText(s)}${s.totalBytes > 0 ? `，共 ${formatBytes(s.totalBytes)}` : ''}。接收后会新建一份，不影响已有的内容。`}</DialogDescription>
        </DialogHeader>
        {s && s.titles.length > 0 && (
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto rounded-lg bg-muted px-8 py-2.5 text-sm">
            {s.titles.map((t, i) => (
              <li key={`${t}-${i}`} className="truncate">
                {t}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => void respond(false)}>
            拒绝
          </Button>
          <Button onClick={() => void respond(true)}>接收</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
