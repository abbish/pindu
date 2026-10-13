import React, { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Loader2, Monitor, Moon, RefreshCw, Sun, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useTheme, type ThemePreference } from '@/hooks/useTheme';
import { updater, useUpdater } from '@/hooks/useUpdater';
import { useCheckForUpdates } from '@/components/UpdateBanner';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
];

/** 设置「通用」：外观（主题）与更新（版本与自动检查）。诊断在「数据与系统 → 诊断」。 */
export const GeneralSettings: React.FC = () => {
  const { preference, setPreference } = useTheme();
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

    </SettingsPanel>
  );
};
