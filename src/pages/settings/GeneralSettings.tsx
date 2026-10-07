import React, { useState } from 'react';
import { FolderOpen, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LogViewer } from '@/components/LogViewer';
import { useToast } from '@/components/Toast/ToastContainer';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useTheme, type ThemePreference } from '@/hooks/useTheme';
import { dataManagementService } from '../../services/dataManagementService';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
];

/**
 * 设置「通用」：外观（主题）与诊断（系统日志）。
 */
export const GeneralSettings: React.FC = () => {
  const toast = useToast();
  const { preference, setPreference } = useTheme();
  const [showLogs, setShowLogs] = useState(false);

  return (
    <SettingsPanel title="通用" description="应用的外观与诊断">
      <SettingsSection title="外观">
        <SettingsRow label="主题" description="浅色、深色，或跟随系统自动切换；侧边栏底部也可以快速切换">
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

      <SettingsSection title="诊断">
        <SettingsRow label="系统日志" description="遇到问题时查看最近的运行日志，或打开日志文件夹发给开发者">
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
