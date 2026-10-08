import React, { useState, useEffect } from 'react';
import { Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTime } from '../../utils/datetime';
import { API_CALL_EVENT, type ApiCallEventDetail } from '../../api/client';

interface DevToolsProps {
  enabled?: boolean;
}

export const DevTools: React.FC<DevToolsProps> = ({ enabled = import.meta.env.DEV }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [apiCalls, setApiCalls] = useState<{command: string, args: unknown, timestamp: number}[]>([]);
  
  // 拦截控制台日志
  useEffect(() => {
    if (!enabled) return;

    // DevTools 有意接管 console.log 以在面板中展示（仅开发模式）
    // eslint-disable-next-line no-console
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    // eslint-disable-next-line no-console
    console.log = (...args) => {
      originalConsoleLog(...args);
      // 使用setTimeout避免在渲染过程中更新状态
      setTimeout(() => {
        setLogs(prev => [...prev, `[LOG] ${args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ')}`].slice(-50)); // 只保留最近50条日志
      }, 0);
    };

    console.error = (...args) => {
      originalConsoleError(...args);
      // 使用setTimeout避免在渲染过程中更新状态
      setTimeout(() => {
        setLogs(prev => [...prev, `[ERROR] ${args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ')}`].slice(-50));
      }, 0);
    };
    
    // 监听API调用
    const handleApiCall = (event: Event) => {
      const { command, args } = (event as CustomEvent<ApiCallEventDetail>).detail;
      // 使用setTimeout避免在渲染过程中更新状态
      setTimeout(() => {
        setApiCalls(prev => [...prev, {
          command,
          args,
          timestamp: Date.now()
        }].slice(-20)); // 只保留最近20个API调用
      }, 0);
    };
    
    window.addEventListener(API_CALL_EVENT, handleApiCall);
    
    return () => {
      // eslint-disable-next-line no-console
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      window.removeEventListener(API_CALL_EVENT, handleApiCall);
    };
  }, [enabled]);
  
  // 只在开发模式下显示（放在所有 hooks 之后，遵守 Hooks 规则）
  if (!enabled) return null;

  return (
    <div className="fixed right-3 bottom-3 z-50 flex flex-col items-end gap-2 text-xs">
      {isVisible && (
        <div className="flex max-h-[70vh] w-96 flex-col gap-3 overflow-y-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg">
          <h3 className="text-sm font-semibold">开发者调试面板</h3>

          <section className="space-y-1">
            <h4 className="font-medium text-muted-foreground">环境信息</h4>
            <div>开发模式: {import.meta.env.DEV ? '是' : '否'}</div>
            <div>环境: {import.meta.env.MODE}</div>
            <div>Tauri环境: {typeof window !== 'undefined' && '__TAURI__' in window ? '是' : '否'}</div>
          </section>

          <section className="space-y-1">
            <h4 className="font-medium text-muted-foreground">最近API调用 ({apiCalls.length})</h4>
            <div className="divide-y rounded-md border">
              {apiCalls.map((call, index) => (
                <div key={index} className="space-y-0.5 px-2 py-1.5">
                  <div className="flex justify-between gap-2 font-mono">
                    <span className="font-medium">{call.command}</span>
                    <span className="text-muted-foreground tabular-nums">{formatTime(call.timestamp, true)}</span>
                  </div>
                  <div className="truncate font-mono text-muted-foreground select-text">{JSON.stringify(call.args)}</div>
                </div>
              ))}
              {apiCalls.length === 0 && <div className="px-2 py-1.5 text-muted-foreground">暂无API调用</div>}
            </div>
          </section>

          <section className="space-y-1">
            <h4 className="font-medium text-muted-foreground">控制台日志</h4>
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono">
              {logs.map((log, index) => (
                <div key={index} className={log.startsWith('[ERROR]') ? 'text-destructive' : undefined}>
                  {log}
                </div>
              ))}
              {logs.length === 0 && <div className="text-muted-foreground">暂无日志</div>}
            </div>
          </section>
        </div>
      )}
      <Button size="sm" variant="outline" className="h-7 bg-background/90 text-xs shadow-sm" onClick={() => setIsVisible(!isVisible)}>
        <Bug />
        {isVisible ? '隐藏调试面板' : '显示调试面板'}
      </Button>
    </div>
  );
};
