import React, { useEffect, useState } from 'react';
import { FolderOpen, Loader2, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/Toast/ToastContainer';
import { dataManagementService } from '../../services/dataManagementService';
import { formatDateTime, nowInstant } from '../../utils/datetime';

/** app.log 中的一条日志（Rust Logger 按行写 JSON） */
interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  details?: string;
}

export interface LogViewerProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭 */
  onClose: () => void;
}

/** 非 JSON 行按 INFO 级系统日志显示 */
function parseLogLine(line: string): LogEntry {
  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    return { timestamp: nowInstant(), level: 'INFO', component: 'SYSTEM', message: line };
  }
}

const LEVEL_CLASS: Record<string, string> = {
  ERROR: 'bg-destructive/10 text-destructive',
  WARN: 'bg-warning-soft text-warning',
  INFO: 'bg-secondary text-secondary-foreground',
  DEBUG: 'bg-muted text-muted-foreground',
};

const LEVELS = [
  { value: 'all', label: '所有级别' },
  { value: 'ERROR', label: '错误' },
  { value: 'WARN', label: '警告' },
  { value: 'INFO', label: '信息' },
  { value: 'DEBUG', label: '调试' },
];

/** 一次读取的日志条数（后端上限 2000） */
const LOG_LIMIT = 1000;

/**
 * 系统日志查看器：读取 app.log 末尾，按文本与级别筛选
 */
export const LogViewer: React.FC<LogViewerProps> = ({ isOpen, onClose }) => {
  const toast = useToast();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');

  const loadLogs = async () => {
    setLoading(true);
    const result = await dataManagementService.getSystemLogs(LOG_LIMIT);
    if (result.success) {
      setLogs(result.data.map(parseLogLine));
    } else {
      // 读取失败也作为一条日志显示，便于排查
      setLogs([{ timestamp: nowInstant(), level: 'ERROR', component: 'LOG_VIEWER', message: '无法读取日志', details: result.detail ?? result.error }]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen) loadLogs();
  }, [isOpen]);

  const keyword = filter.toLowerCase();
  const filteredLogs = logs.filter((log) => {
    const matchesText =
      !keyword ||
      log.message.toLowerCase().includes(keyword) ||
      log.component.toLowerCase().includes(keyword) ||
      (log.details ?? '').toLowerCase().includes(keyword);
    return matchesText && (levelFilter === 'all' || log.level === levelFilter);
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-4xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>系统日志</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜索日志" aria-label="搜索日志" className="pl-8" />
          </div>
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-32" aria-label="日志级别">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={loadLogs} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            刷新
          </Button>
        </div>

        <div className="min-h-64 flex-1 overflow-y-auto rounded-lg border">
          {loading && logs.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : filteredLogs.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">没有找到日志记录</p>
          ) : (
            <ul className="divide-y">
              {filteredLogs.map((log, index) => (
                <li key={index} className="space-y-1 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className={cn('h-5 border-transparent font-mono', LEVEL_CLASS[log.level] ?? LEVEL_CLASS.DEBUG)}>
                      {log.level}
                    </Badge>
                    <span className="tabular-nums text-muted-foreground">{formatDateTime(log.timestamp, undefined, true) || log.timestamp}</span>
                    <span className="font-mono text-muted-foreground">{log.component}</span>
                  </div>
                  <div className="text-sm break-words select-text">{log.message}</div>
                  {log.details && (
                    <details className="text-xs">
                      <summary className="cursor-default text-muted-foreground">详细信息</summary>
                      <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted/50 p-2 font-mono whitespace-pre-wrap select-text">{log.details}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">显示 {filteredLogs.length} 条日志</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={async () => {
              const result = await dataManagementService.openLogFolder();
              if (!result.success) toast.showError('无法打开日志文件夹', result.error);
            }}>
              <FolderOpen />
              打开日志文件夹
            </Button>
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
