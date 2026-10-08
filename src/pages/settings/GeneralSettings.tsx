import React, { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { FolderOpen, Loader2, Monitor, Moon, RefreshCw, Sun, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LogViewer } from '@/components/LogViewer';
import { useToast } from '@/components/Toast/ToastContainer';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useTheme, type ThemePreference } from '@/hooks/useTheme';
import { updater, useUpdater } from '@/hooks/useUpdater';
import { useCheckForUpdates } from '@/components/UpdateBanner';
import { dataManagementService } from '../../services/dataManagementService';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
];

/**
 * 设置「通用」：外观（主题）、更新（版本与自动检查）与诊断（系统日志）。
 */
export const GeneralSettings: React.FC = () => {
  const toast = useToast();
  const { preference, setPreference } = useTheme();
  const [showLogs, setShowLogs] = useState(false);
  const { state: updateState, autoCheck } = useUpdater();
  const checkForUpdates = useCheckForUpdates();
  const [version, setVersion] = useState('');
  useEffect(() => {
    getVersion().then(setVersion, () => setVersion(''));
  }, []);

  return (
    <SettingsPanel title="通用">
      <SettingsSection title="外观">
        <SettingsRow label="主题">
          <ToggleGroup
            type="single"
            value={preference}
            className="rounded-lg bg-muted p-0.5"
            onValueChange={(v) => v && setPreference(v as ThemePreference)}
            aria-label="主题"
          >
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <Tooltip key={value}>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value={value} aria-label={label} className="h-7 rounded-md px-2.5 data-[state=on]:bg-background data-[state=on]:shadow-sm">
                    <Icon />
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="更新">
        <SettingsRow label={version ? `当前版本 ${version}` : '当前版本'}>
          <Button variant="outline" size="sm" disabled={updateState.kind === 'checking'} onClick={() => void checkForUpdates()}>
            {updateState.kind === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            检查更新
          </Button>
        </SettingsRow>
        <SettingsRow label="自动检查更新">
          <Switch checked={autoCheck} onCheckedChange={updater.setAutoCheck} aria-label="自动检查更新" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="诊断">
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
