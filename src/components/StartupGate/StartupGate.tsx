import React, { useEffect, useState } from 'react';
import { AlertTriangle, FileText, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { UpdateBanner, useCheckForUpdates } from '@/components/UpdateBanner';
import { useUpdater } from '@/hooks/useUpdater';
import { dataManagementService } from '@/services/dataManagementService';
import type { StartupFailure } from '@/types';
import { bootStatusText, finishBoot, setBootStatus } from '@/utils/bootSplash';

export interface StartupGateProps {
  children: React.ReactNode;
}

/** 启动期间查询进度的间隔 */
const POLL_MS = 120;

/**
 * 启动关卡：后端在后台打开（必要时备份、升级）数据库，期间显示启动画面（index.html 的 #boot）与进度；
 * 就绪才渲染应用，启动画面淡出；失败则整窗只显示原因（数据原样保留，不调用其它命令）。
 * 失败原因由后端 `startup.rs` 给出：数据来自更新的版本、升级失败、升级前备份失败等。
 */
export const StartupGate: React.FC<StartupGateProps> = ({ children }) => {
  const [state, setState] = useState<'checking' | 'ok' | StartupFailure>('checking');

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const poll = async () => {
      const result = await dataManagementService.getStartupStatus();
      if (stopped) return;
      // 读取状态本身失败时按正常启动处理，具体命令各自报错
      if (!result.success || result.data.ok) {
        setBootStatus(bootStatusText(result.success ? result.data : null));
        setState('ok');
      } else if (result.data.failure) {
        setState(result.data.failure);
      } else {
        setBootStatus(bootStatusText(result.data));
        timer = window.setTimeout(poll, POLL_MS);
        return;
      }
      finishBoot();
    };
    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (state === 'checking') return null;
  if (state === 'ok') return <>{children}</>;
  return <StartupErrorScreen failure={state} />;
};

const StartupErrorScreen: React.FC<{ failure: StartupFailure }> = ({ failure }) => {
  const [actionError, setActionError] = useState<string | null>(null);
  const { state: updateState } = useUpdater();
  const checkForUpdates = useCheckForUpdates();
  const run = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    const result = await action();
    setActionError(result.success ? null : (result.error ?? null));
  };

  return (
    <div className="flex min-h-svh flex-col bg-background">
      {/* 新版本可能已经修好了这个问题：这里也能检查并安装更新 */}
      <UpdateBanner />
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-xl space-y-4">
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{failure.title}</AlertTitle>
            <AlertDescription>{failure.message}</AlertDescription>
          </Alert>
          <dl className="space-y-2 rounded-lg border bg-card p-4 text-sm">
            <div>
              <dt className="text-muted-foreground">数据文件夹</dt>
              <dd className="break-all font-mono text-xs">{failure.dataDir}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">升级前的自动备份</dt>
              <dd className="break-all font-mono text-xs">{failure.backupDir}</dd>
            </div>
            {failure.detail && (
              <div>
                <dt className="text-muted-foreground">错误详情</dt>
                <dd className="break-all font-mono text-xs">{failure.detail}</dd>
              </div>
            )}
          </dl>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => run(() => dataManagementService.openDataFolder())}>
              <FolderOpen />
              打开数据文件夹
            </Button>
            <Button variant="outline" onClick={() => run(() => dataManagementService.openLogFolder())}>
              <FileText />
              打开日志文件夹
            </Button>
            <Button variant="outline" disabled={updateState.kind === 'checking'} onClick={() => void checkForUpdates()}>
              {updateState.kind === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              检查更新
            </Button>
          </div>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <p className="text-sm text-muted-foreground">
            数据没有被修改或删除
          </p>
        </div>
      </div>
    </div>
  );
};
