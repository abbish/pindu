import React, { useEffect, useState } from 'react';
import { AlertTriangle, FileText, FolderOpen } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { dataManagementService } from '@/services/dataManagementService';
import type { StartupFailure } from '@/types';

export interface StartupGateProps {
  children: React.ReactNode;
}

/**
 * 启动关卡：数据库打开并升级成功才渲染应用；否则整窗只显示原因（数据原样保留，不调用其它命令）。
 * 失败原因由后端 `startup.rs` 给出：数据来自更新的版本、升级失败、升级前备份失败等。
 */
export const StartupGate: React.FC<StartupGateProps> = ({ children }) => {
  const [state, setState] = useState<'checking' | 'ok' | StartupFailure>('checking');

  useEffect(() => {
    dataManagementService.getStartupStatus().then((result) => {
      // 读取状态本身失败时按正常启动处理，具体命令各自报错
      if (!result.success || result.data.ok || !result.data.failure) setState('ok');
      else setState(result.data.failure);
    });
  }, []);

  if (state === 'checking') return null;
  if (state === 'ok') return <>{children}</>;
  return <StartupErrorScreen failure={state} />;
};

const StartupErrorScreen: React.FC<{ failure: StartupFailure }> = ({ failure }) => {
  const [actionError, setActionError] = useState<string | null>(null);
  const run = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    const result = await action();
    setActionError(result.success ? null : (result.error ?? null));
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-8">
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
        </div>
        {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        <p className="text-sm text-muted-foreground">
          你的数据没有被修改，也没有被删除。解决后重新打开应用即可；如需帮助，请到 GitHub Issues 反馈并附上日志。
        </p>
      </div>
    </div>
  );
};
