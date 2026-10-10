import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/InlineError';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TtsConfig, UpdateTtsConfigRequest } from '../../services/ttsService';

type AuthMode = 'apiKey' | 'appToken';

export interface TtsConfigModalProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 当前配置（脱敏） */
  config: TtsConfig;
  /** 正在保存 */
  saving: boolean;
  /** 关闭 */
  onClose: () => void;
  /** 保存（只包含有变化的字段） */
  onSave: (request: UpdateTtsConfigRequest) => void;
  /** 保存失败的原因（显示在弹窗内，弹窗保持打开） */
  saveError?: string | null;
}

/** 资源 ID 可选值；空字符串 = 按音色自动推断 */
const RESOURCE_OPTIONS = [
  { value: '', label: '自动' },
  { value: 'seed-tts-2.0', label: 'seed-tts-2.0 · *_uranus_bigtts 音色' },
  { value: 'seed-tts-1.0', label: 'seed-tts-1.0 · *_moon / *_mars_bigtts 音色' },
  { value: 'seed-icl-2.0', label: 'seed-icl-2.0 · S_ 开头的复刻音色' },
];

/**
 * 豆包语音连接弹窗：鉴权方式与资源 ID（不常改、含密钥）。音色、语速、朗读风格在设置页上直接改
 */
export const TtsConfigModal: React.FC<TtsConfigModalProps> = ({
  isOpen,
  config,
  saving,
  onClose,
  onSave,
  saveError,
}) => {
  const [authMode, setAuthMode] = useState<AuthMode>('apiKey');
  const [apiKey, setApiKey] = useState('');
  const [appId, setAppId] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [resourceId, setResourceId] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setAuthMode(!config.hasApiKey && config.hasAccessKey ? 'appToken' : 'apiKey');
    setApiKey('');
    setAppId(config.appId);
    setAccessKey('');
    setResourceId(config.resourceId);
  }, [isOpen, config]);

  const handleSave = () => {
    const request: UpdateTtsConfigRequest = {};
    if (authMode === 'apiKey') {
      if (apiKey.trim()) request.apiKey = apiKey.trim();
    } else {
      // 切换到旧控制台鉴权：清除 API Key（它的优先级更高）
      if (config.hasApiKey) request.apiKey = '';
      if (appId.trim() !== config.appId) request.appId = appId.trim();
      if (accessKey.trim()) request.accessKey = accessKey.trim();
    }
    if (resourceId !== config.resourceId) request.resourceId = resourceId;
    onSave(request);
  };

  const canSave =
    !saving &&
    (authMode === 'apiKey'
      ? config.hasApiKey || apiKey.trim().length > 0
      : appId.trim().length > 0 && (config.hasAccessKey || accessKey.trim().length > 0));

  const AUTO = '__auto';
  const section = (icon: React.ReactNode, title: string, body: React.ReactNode) => (
    <section className="space-y-3 rounded-xl border p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h4>
      {body}
    </section>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>豆包语音连接</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          {section(
            <KeyRound className="size-4" />,
            '鉴权',
            <>
              <RadioGroup value={authMode} onValueChange={(v) => setAuthMode(v as AuthMode)} className="flex gap-6">
                <Label className="flex items-center gap-2 font-normal">
                  <RadioGroupItem value="apiKey" />
                  API Key
                </Label>
                <Label className="flex items-center gap-2 font-normal">
                  <RadioGroupItem value="appToken" />
                  AppID + Access Token
                </Label>
              </RadioGroup>
              {authMode === 'apiKey' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="tts-key">API Key</Label>
                  <Input
                    id="tts-key"
                    type="password"
                    value={apiKey}
                    placeholder={config.hasApiKey ? `已配置 ${config.apiKeyPreview ?? ''}，留空保持不变` : 'API Key'}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">在火山引擎控制台「豆包语音 → API Key 管理」创建，需开通「语音合成大模型」</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tts-appid">AppID</Label>
                    <Input id="tts-appid" value={appId} placeholder="例如 1234567890" onChange={(e) => setAppId(e.target.value)} autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tts-token">Access Token</Label>
                    <Input
                      id="tts-token"
                      type="password"
                      value={accessKey}
                      placeholder={config.hasAccessKey ? `已配置 ${config.accessKeyPreview ?? ''}，留空保持不变` : 'Access Token'}
                      onChange={(e) => setAccessKey(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {section(
            <SlidersHorizontal className="size-4" />,
            '资源',
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tts-resource">资源 ID</Label>
                <Select value={resourceId || AUTO} onValueChange={(v) => setResourceId(v === AUTO ? '' : v)}>
                  <SelectTrigger id="tts-resource" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOURCE_OPTIONS.map((option) => (
                      <SelectItem key={option.value || AUTO} value={option.value || AUTO}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        {saveError && (
          <div className="px-6 pb-3">
            <InlineError title="无法保存语音合成配置">{saveError}</InlineError>
          </div>
        )}
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
