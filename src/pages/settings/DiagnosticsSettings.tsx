import React, { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogViewer } from '@/components/LogViewer';
import { useToast } from '@/components/Toast/ToastContainer';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { dataManagementService } from '../../services/dataManagementService';

/** 日志记录级别：选中的级别及更严重的才写入日志 */
const LOG_LEVELS = [
  { value: 'DEBUG', label: '调试（全部）' },
  { value: 'INFO', label: '信息' },
  { value: 'WARN', label: '警告' },
  { value: 'ERROR', label: '仅错误' },
];

/** 设置「诊断」：日志记录级别、打开 / 查看系统日志（出问题时给开发者看） */
export const DiagnosticsSettings: React.FC = () => {
  const toast = useToast();
  const [showLogs, setShowLogs] = useState(false);
  const [logLevel, setLogLevel] = useState<string | null>(null);
  useEffect(() => {
    dataManagementService.getLogLevel().then((r) => r.success && setLogLevel(r.data));
  }, []);
  const changeLogLevel = async (level: string) => {
    const result = await dataManagementService.setLogLevel(level);
    if (result.success) setLogLevel(result.data);
    else toast.showError('无法修改日志级别', result.error);
  };
  return (
    <SettingsPanel title="诊断">
      <SettingsSection title="日志">
        <SettingsRow label="记录级别">
          <Select value={logLevel ?? ''} onValueChange={changeLogLevel} disabled={logLevel === null}>
            <SelectTrigger className="w-36" aria-label="日志记录级别">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="系统日志">
          <Button variant="outline" size="sm" onClick={async () => {
              const result = await dataManagementService.openLogFolder();
              if (!result.success) toast.showError('无法打开日志文件夹', result.error);
            }}>
            <FolderOpen />
            打开文件夹
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowLogs(true)}>
            查看日志
          </Button>
        </SettingsRow>
      </SettingsSection>

      <LogViewer isOpen={showLogs} onClose={() => setShowLogs(false)} />
    </SettingsPanel>
  );
};
