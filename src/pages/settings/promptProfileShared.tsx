import React, { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/Toast/ToastContainer';
import { promptProfileService, type PromptProfile } from '@/services/promptProfileService';

export type Option = { value: string; label: string };

export const OptionSelect: React.FC<{
  value: string;
  options: Option[];
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
}> = ({ value, options, label, disabled, onChange, className = 'w-56' }) => (
  <Select value={value} disabled={disabled} onValueChange={onChange}>
    <SelectTrigger className={className} aria-label={label}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

type ProfileResult = Awaited<ReturnType<typeof promptProfileService.updateProfile>>;

/**
 * 学习者档案（学习者、AI 老师的人设、补充要求共用一份，存 app_settings 的 prompt.profile）：读取、保存、套用预设。
 * 选了就生效的设置成功时不提示；点按钮的操作（套用预设、保存文字）才给成功提示。
 */
export function usePromptProfile() {
  const toast = useToast();
  const [profile, setProfile] = useState<PromptProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    promptProfileService.getProfile().then((r) => {
      if (cancelled) return;
      if (r.success) setProfile(r.data);
      setLoadError(r.success ? null : r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /** 返回是否成功 */
  const finish = (result: ProfileResult, failTitle: string, message?: string) => {
    if (result.success) {
      setProfile(result.data);
      if (message) toast.showSuccess(message);
    } else {
      toast.showError(failTitle, result.error);
    }
    return result.success;
  };

  const save = async (patch: Partial<PromptProfile>, message?: string) => {
    if (!profile) return false;
    setSaving(true);
    const result = await promptProfileService.updateProfile({ ...profile, ...patch });
    setSaving(false);
    return finish(result, '无法保存设置', message);
  };

  const applyPreset = async (preset: string, label: string) => {
    setSaving(true);
    const result = await promptProfileService.applyPreset(preset);
    setSaving(false);
    return finish(result, '无法套用预设', `已套用「${label}」预设`);
  };

  return { profile, saving, loadError, reload: () => setReloadKey((k) => k + 1), save, applyPreset };
}
