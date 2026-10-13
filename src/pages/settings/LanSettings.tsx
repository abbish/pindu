import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Laptop, Loader2, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InlineError } from '@/components/InlineError';
import { PairingCode } from '@/components/LanPairRequest';
import { useToast } from '@/components/Toast/ToastContainer';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { formatRelative } from '@/utils/datetime';
import { lanService } from '../../services/lanService';
import { LAN_EVENTS, osLabel, type LanStatus, type NearbyDevice, type PairedDevice, type PairingResult, type PairingStarted } from '../../types/lan';

/**
 * 设置「附近的设备」：本机开关与名字、已配对的设备、附近的设备与配对（像 LocalSend）。
 * 别的设备发来的配对请求由 App 级的 LanPairRequest 弹窗处理。
 */
export const LanSettings: React.FC = () => {
  const toast = useToast();
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [alias, setAlias] = useState('');
  const [paired, setPaired] = useState<PairedDevice[]>([]);
  const [nearby, setNearby] = useState<NearbyDevice[]>([]);
  const [saving, setSaving] = useState(false);
  const [pairing, setPairing] = useState<PairingStarted | null>(null);
  /** 配对弹窗的进展：本机已确认数字 / 对方已同意 */
  const [pairingState, setPairingState] = useState({ confirmed: false, remoteAccepted: false });
  const [pairingWith, setPairingWith] = useState<string | null>(null);
  const [unpairTarget, setUnpairTarget] = useState<PairedDevice | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const loadDevices = useCallback(async () => {
    const [p, n] = await Promise.all([lanService.getPairedDevices(), lanService.getNearbyDevices()]);
    if (p.success) setPaired(p.data);
    if (n.success) setNearby(n.data);
  }, []);

  useEffect(() => {
    void lanService.getStatus().then((r) => {
      if (!r.success) return toast.showError('无法读取设备互传设置', r.error);
      setStatus(r.data);
      setAlias(r.data.alias);
    });
    void loadDevices();
    const offs = [listen(LAN_EVENTS.nearbyChanged, () => void loadDevices()), listen(LAN_EVENTS.pairedChanged, () => void loadDevices())];
    return () => offs.forEach((off) => void off.then((f) => f()));
  }, [loadDevices, toast]);

  // 本机发起的配对有了结果
  const pairingRef = useRef<PairingStarted | null>(null);
  pairingRef.current = pairing;
  /** 弹窗登记之前就到了的结果（对方很快回应时，事件可能早于 startPairing 返回）：登记后补上 */
  const earlyResults = useRef(new Map<string, PairingResult>());
  const handleResult = useRef<(payload: PairingResult) => void>(() => {});
  handleResult.current = (payload: PairingResult) => {
      if (payload.outcome === 'remote_accepted') {
        setPairingState((s) => ({ ...s, remoteAccepted: true }));
        return;
      }
      setPairing(null);
      if (payload.outcome === 'accepted') toast.showSuccess(`已和「${payload.alias}」配对`);
      else if (payload.outcome === 'rejected') toast.showInfo(`「${payload.alias}」没有同意配对`);
      else if (payload.outcome === 'failed') toast.showError('配对没有完成', payload.message ?? undefined);
  };
  useEffect(() => {
    const off = listen<PairingResult>(LAN_EVENTS.pairingResult, ({ payload }) => {
      if (pairingRef.current?.pairingId !== payload.pairingId) {
        earlyResults.current.set(payload.pairingId, payload);
        return;
      }
      handleResult.current(payload);
    });
    return () => void off.then((f) => f());
  }, []);

  const save = async (enabled: boolean, nextAlias: string) => {
    setSaving(true);
    const r = await lanService.updateSettings({ enabled, alias: nextAlias });
    setSaving(false);
    if (!r.success) {
      toast.showError('无法保存', r.error);
      if (status) setAlias(status.alias);
      return;
    }
    setStatus(r.data);
    setAlias(r.data.alias);
    void loadDevices();
  };

  const saveAlias = () => {
    if (!status || alias.trim() === status.alias) return;
    void save(status.enabled, alias);
  };

  const startPairing = async (device: NearbyDevice) => {
    setPairingWith(device.fingerprint);
    const r = await lanService.startPairing(device.fingerprint);
    setPairingWith(null);
    if (r.success) {
      setPairingState({ confirmed: false, remoteAccepted: false });
      setPairing(r.data);
      pairingRef.current = r.data;
      const early = earlyResults.current.get(r.data.pairingId);
      earlyResults.current.clear();
      if (early) handleResult.current(early);
    } else toast.showError('无法配对', r.error);
  };

  const confirmPairing = async () => {
    if (!pairing) return;
    setPairingState((s) => ({ ...s, confirmed: true }));
    const r = await lanService.confirmPairing(pairing.pairingId);
    if (!r.success) {
      setPairing(null);
      toast.showError('配对没有完成', r.error);
    }
  };

  const cancelPairing = () => {
    if (pairing) void lanService.cancelPairing(pairing.pairingId);
    setPairing(null);
  };

  const unpair = async () => {
    if (!unpairTarget) return;
    const r = await lanService.unpairDevice(unpairTarget.fingerprint);
    if (r.success) toast.showSuccess(`已取消和「${unpairTarget.alias}」的配对`);
    else toast.showError('无法取消配对', r.error);
    setUnpairTarget(null);
  };

  const unpairedNearby = nearby.filter((d) => !d.paired);
  const running = status?.running ?? false;

  return (
    <SettingsPanel title="附近的设备" description="同一网络里的电脑配对后，可以互相发送词汇本、短文、视频和学习计划。">
      <SettingsSection title="这台电脑">
        <SettingsRow label="让附近的设备找到这台电脑">
          <Switch
            checked={status?.enabled ?? false}
            disabled={!status || saving}
            onCheckedChange={(on) => void save(on, alias)}
            aria-label="让附近的设备找到这台电脑"
          />
        </SettingsRow>
        <SettingsRow label="名字" htmlFor="lan-alias">
          <Input
            id="lan-alias"
            value={alias}
            maxLength={32}
            disabled={!status || saving}
            onChange={(e) => setAlias(e.target.value)}
            onBlur={saveAlias}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
            className="w-56"
          />
        </SettingsRow>
        {running && status && status.addresses.length > 0 && (
          <SettingsRow label="地址">
            <span className="select-text text-sm text-muted-foreground tabular-nums">
              {status.addresses.map((a) => `${a}:${status.port}`).join('　')}
            </span>
          </SettingsRow>
        )}
        {status?.error && (
          <div className="px-4 py-3">
            <InlineError>{status.error}</InlineError>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="已配对的设备">
        {paired.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">还没有配对的设备</div>
        ) : (
          paired.map((d) => (
            <SettingsRow
              key={d.fingerprint}
              icon={<Laptop className="size-5 text-muted-foreground" />}
              label={d.alias}
              description={[
                osLabel(d.os),
                d.online ? '在线' : d.lastSeenAt ? `离线 · ${formatRelative(d.lastSeenAt)}在线` : '离线',
              ].join(' · ')}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="size-8" aria-label="更多操作">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onSelect={() => setUnpairTarget(d)}>
                    取消配对…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SettingsRow>
          ))
        )}
      </SettingsSection>

      {running && (
        <SettingsSection
          title="附近的设备"
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => void lanService.refreshNearbyDevices()}>
                <RefreshCw />
                刷新
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
                <Plus />
                按地址添加
              </Button>
            </>
          }
        >
          {unpairedNearby.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在查找，另一台电脑也要打开这个设置
            </div>
          ) : (
            unpairedNearby.map((d) => (
              <SettingsRow
                key={d.fingerprint}
                icon={<Laptop className="size-5 text-muted-foreground" />}
                label={d.alias}
                description={`${osLabel(d.os)} · ${d.address}`}
              >
                <Button size="sm" variant="outline" disabled={pairingWith !== null} onClick={() => void startPairing(d)}>
                  {pairingWith === d.fingerprint && <Loader2 className="animate-spin" />}
                  配对
                </Button>
              </SettingsRow>
            ))
          )}
        </SettingsSection>
      )}

      <Dialog open={pairing !== null} onOpenChange={(open) => !open && cancelPairing()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>与「{pairing?.alias}」配对</DialogTitle>
            <DialogDescription>两台电脑上显示的数字一致，才说明连上的是对方。</DialogDescription>
          </DialogHeader>
          {pairing && <PairingCode code={pairing.code} />}
          {(pairingState.confirmed || pairingState.remoteAccepted) && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              {pairingState.confirmed && <Loader2 className="size-4 animate-spin" />}
              {pairingState.confirmed ? `等待「${pairing?.alias}」确认` : `「${pairing?.alias}」已确认，请核对数字`}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={cancelPairing}>
              数字不一致，取消
            </Button>
            <Button onClick={() => void confirmPairing()} disabled={pairingState.confirmed}>
              数字一致
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddByAddressDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => void loadDevices()} />

      <AlertDialog open={unpairTarget !== null} onOpenChange={(open) => !open && setUnpairTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消和「{unpairTarget?.alias}」的配对？</AlertDialogTitle>
            <AlertDialogDescription>两台电脑都会删除这次配对，以后要传送需要重新配对。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: 'destructive' })} onClick={() => void unpair()}>
              取消配对
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPanel>
  );
};

const AddByAddressDialog: React.FC<{ open: boolean; onClose: () => void; onAdded: () => void }> = ({ open, onClose, onAdded }) => {
  const toast = useToast();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAddress('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await lanService.addDeviceByAddress(address);
    setBusy(false);
    if (!r.success) return setError(r.error);
    toast.showSuccess(`已找到「${r.data.alias}」`);
    onAdded();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>按地址添加</DialogTitle>
          <DialogDescription>在另一台电脑的这个设置里可以看到它的地址。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input autoFocus value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.8" aria-label="地址" />
          {error && <InlineError title="无法添加">{error}</InlineError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy || address.trim() === ''}>
              {busy && <Loader2 className="animate-spin" />}
              添加
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
