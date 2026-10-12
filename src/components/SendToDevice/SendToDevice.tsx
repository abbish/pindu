import React, { useEffect, useState } from 'react';
import { Laptop, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InlineError } from '@/components/InlineError';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { lanService } from '@/services/lanService';
import { osLabel, type ExportItem, type PairedDevice } from '@/types/lan';
import type { NavigateFn } from '@/navigation';

/** 要发送的内容：几项 + 给用户看的名字（「旅行词汇」/「3 个词汇本」） */
export interface SendRequest {
  items: ExportItem[];
  title: string;
}

const EVENT = 'pindu:send-to-device';

/** 打开「发送到其他电脑」弹窗（任何页面的 ⋯ 菜单 / 多选栏调用；弹窗挂在 App 上） */
export function sendToDevice(request: SendRequest): void {
  window.dispatchEvent(new CustomEvent<SendRequest>(EVENT, { detail: request }));
}

/** 菜单项的文字与图标（各页面保持一致） */
export const SEND_LABEL = '发送到其他电脑…';
export const SendIcon = Send;

/** 多选栏里的「发送到其他电脑」 */
export const BatchSendButton: React.FC<SendRequest> = (request) => (
  <Button variant="ghost" size="sm" onClick={() => sendToDevice(request)}>
    <Send />
    发送到其他电脑
  </Button>
);

/**
 * 「发送到其他电脑」：选一台已配对、在线的电脑，计划可选连同学习进度，视频可选包括原始视频。
 * 发送在后台进行（后台任务里看进度），对方确认后开始。
 */
export const SendToDeviceHost: React.FC<{ onNavigate: NavigateFn }> = ({ onNavigate }) => {
  const toast = useToast();
  const [request, setRequest] = useState<SendRequest | null>(null);
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [running, setRunning] = useState(true);
  const [target, setTarget] = useState<string | null>(null);
  const [withProgress, setWithProgress] = useState(false);
  const [withSource, setWithSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setRequest((e as CustomEvent<SendRequest>).detail);
      setTarget(null);
      setWithProgress(false);
      setWithSource(false);
      setError(null);
      setDevices(null);
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!request) return;
    void Promise.all([lanService.getStatus(), lanService.getPairedDevices()]).then(([s, d]) => {
      setRunning(s.success ? s.data.running : false);
      if (!d.success) return setError(d.error);
      setDevices(d.data);
      const online = d.data.filter((x) => x.online);
      if (online.length === 1) setTarget(online[0].fingerprint);
    });
  }, [request]);

  const hasPlan = request?.items.some((i) => i.kind === 'plan') ?? false;
  const hasVideo = request?.items.some((i) => i.kind === 'video') ?? false;

  const send = async () => {
    if (!request || !target) return;
    setBusy(true);
    setError(null);
    const r = await lanService.startTransfer({ fingerprint: target, items: request.items, includeProgress: withProgress, includeSourceVideo: withSource });
    setBusy(false);
    if (!r.success) return setError(r.error);
    const name = devices?.find((d) => d.fingerprint === target)?.alias ?? '';
    toast.showSuccess(`正在发送到「${name}」`, '对方确认后开始传送，进度在后台任务里');
    setRequest(null);
  };

  const close = () => setRequest(null);
  /** 去「设置 → 附近的设备」打开互传或配对（设置页按上次打开的分类显示） */
  const openSettings = () => {
    try {
      localStorage.setItem('settings.activePanel', 'devices');
    } catch {
      // 存储不可用时停在设置页默认分类
    }
    close();
    onNavigate('settings');
  };

  return (
    <Dialog open={request !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>发送「{request?.title}」</DialogTitle>
          <DialogDescription>发到家里另一台电脑上的拼读，对方会收到一份新的。</DialogDescription>
        </DialogHeader>

        {!running ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">
            还没有打开设备互传
            <Button size="sm" variant="outline" onClick={openSettings}>
              去设置
            </Button>
          </div>
        ) : devices === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : devices.length === 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">
            还没有配对的电脑
            <Button size="sm" variant="outline" onClick={openSettings}>
              去配对
            </Button>
          </div>
        ) : (
          <div role="radiogroup" aria-label="发送到" className="flex flex-col gap-1.5">
            {devices.map((d) => (
              <button
                key={d.fingerprint}
                type="button"
                role="radio"
                aria-checked={target === d.fingerprint}
                disabled={!d.online}
                onClick={() => setTarget(d.fingerprint)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
                  target === d.fingerprint && 'border-primary bg-primary/5 hover:bg-primary/5'
                )}
              >
                <Laptop className="size-5 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.alias}</span>
                  <span className="block text-xs text-muted-foreground">
                    {osLabel(d.os)} · {d.online ? '在线' : '不在线'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {running && devices && devices.length > 0 && (hasPlan || hasVideo) && (
          <div className="flex flex-col gap-2.5">
            {hasPlan && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={withProgress} onCheckedChange={(v) => setWithProgress(v === true)} className="mt-0.5" />
                <span>
                  连同学习进度
                  <span className="block text-xs text-muted-foreground">换一台电脑继续学同一个计划时勾选；不勾选，对方从头开始学</span>
                </span>
              </label>
            )}
            {hasVideo && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={withSource} onCheckedChange={(v) => setWithSource(v === true)} className="mt-0.5" />
                <span>
                  包括原始视频
                  <span className="block text-xs text-muted-foreground">文件较大；不包括时对方可以学习全部场景片段，但不能再切新片段</span>
                </span>
              </label>
            )}
          </div>
        )}

        {error && <InlineError title="无法发送">{error}</InlineError>}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            取消
          </Button>
          <Button onClick={() => void send()} disabled={!target || busy || !running}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            发送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
