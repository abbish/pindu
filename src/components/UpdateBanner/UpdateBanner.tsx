import React, { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ArrowDownToLine, Loader2, RotateCw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/Toast/ToastContainer';
import { updater, useUpdater } from '@/hooks/useUpdater';

/** 启动后多久第一次自动检查、之后多久检查一次 */
const FIRST_CHECK_DELAY = 10_000;
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/** 手动检查更新（设置页按钮、macOS 菜单「检查更新…」、启动错误页）：结果用 toast 告知，有新版本时提示条会出现 */
export function useCheckForUpdates() {
  const toast = useToast();
  return useCallback(async () => {
    const result = await updater.check(true);
    if (result.kind === 'error') toast.showError('无法检查更新', result.error);
    else if (result.kind === 'latest') toast.showSuccess('已是最新版本');
  }, [toast]);
}

/**
 * 自动检查更新（启动 10 秒后一次、之后每 24 小时；开发版不自动检查）与 macOS 菜单「检查更新…」。
 * 挂在 App 最外层：练习页等不显示提示条的页面里，菜单也能用。不渲染任何内容。
 */
export const UpdateWatcher: React.FC = () => {
  const checkForUpdates = useCheckForUpdates();

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const auto = () => {
      if (updater.get().autoCheck) void updater.check(false);
    };
    const first = window.setTimeout(auto, FIRST_CHECK_DELAY);
    const every = window.setInterval(auto, CHECK_INTERVAL);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);

  useEffect(() => {
    const unlisten = listen('menu-check-update', () => void checkForUpdates());
    return () => {
      void unlisten.then((off) => off());
    };
  }, [checkForUpdates]);

  return null;
};

/**
 * 更新提示条：发现新版本 → 下载进度 → 重启完成更新。顶栏下方（AppShell）与启动错误页使用。
 */
export const UpdateBanner: React.FC = () => {
  const { state, skippedVersion, dismissedVersion } = useUpdater();
  const [showNotes, setShowNotes] = useState(false);

  if (state.kind === 'idle' || state.kind === 'checking') return null;
  const { info } = state;
  const closable = state.kind === 'available' || state.kind === 'failed';
  if (closable && dismissedVersion === info.version) return null;
  if (state.kind === 'available' && skippedVersion === info.version) return null;

  const percent =
    state.kind === 'downloading' && state.total ? Math.min(100, Math.round((state.downloaded / state.total) * 100)) : null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-accent/40 px-4 py-2 text-sm">
      <Sparkles className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        {state.kind === 'available' &&
          (info.canInstall ? (
            <>新版本 {info.version} 可以更新了</>
          ) : (
            <>新版本 {info.version} 已发布，请到 GitHub 下载新的安装包</>
          ))}
        {state.kind === 'downloading' && (
          <div className="flex items-center gap-3">
            <span className="shrink-0">正在下载 {info.version}{percent !== null ? `：${percent}%` : '…'}</span>
            {percent !== null && <Progress value={percent} className="h-1.5 max-w-60" />}
          </div>
        )}
        {state.kind === 'ready' && <>{info.version} 已安装，重启后生效</>}
        {state.kind === 'failed' && <span className="text-destructive">无法更新到 {info.version}：{state.error}</span>}
      </div>

      {closable && info.notes && (
        <Button variant="ghost" size="sm" onClick={() => setShowNotes(true)}>
          更新内容
        </Button>
      )}
      {state.kind === 'available' && (
        <>
          <Button variant="ghost" size="sm" onClick={() => updater.skip(info.version)}>
            跳过此版本
          </Button>
          {info.canInstall && (
            <Button size="sm" onClick={() => void updater.install()}>
              <ArrowDownToLine />
              立即更新
            </Button>
          )}
        </>
      )}
      {state.kind === 'downloading' && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {state.kind === 'ready' && (
        <Button size="sm" onClick={() => void updater.restart()}>
          <RotateCw />
          立即重启
        </Button>
      )}
      {state.kind === 'failed' && (
        <Button size="sm" variant="outline" onClick={() => void updater.install()}>
          <RotateCw />
          重试
        </Button>
      )}
      {closable && (
        <Button variant="ghost" size="icon" className="size-7" aria-label="稍后再说" onClick={() => updater.dismiss(info.version)}>
          <X />
        </Button>
      )}

      <Dialog open={showNotes} onOpenChange={setShowNotes}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{info.version} 更新内容</DialogTitle>
            <DialogDescription>当前版本 {info.currentVersion}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm">{info.notes}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
