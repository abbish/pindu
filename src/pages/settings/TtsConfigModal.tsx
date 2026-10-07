import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, SlidersHorizontal, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/InlineError';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { VoiceSelector } from '../../components/VoiceSelector';
import type { TTSVoice, TtsConfig, UpdateTtsConfigRequest } from '../../services/ttsService';

type AuthMode = 'apiKey' | 'appToken';

export interface TtsConfigModalProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 当前配置（脱敏） */
  config: TtsConfig;
  /** 预置音色 */
  voices: TTSVoice[];
  /** 正在保存 */
  saving: boolean;
  /** 正在试听的音色 */
  testingVoiceId?: string;
  /** 关闭 */
  onClose: () => void;
  /** 保存（只包含有变化的字段） */
  onSave: (request: UpdateTtsConfigRequest) => void;
  /** 保存失败的原因（显示在弹窗内，弹窗保持打开） */
  saveError?: string | null;
  /** 试听某个音色（使用已保存的语速与资源设置） */
  onVoiceTest: (voiceId: string) => void;
}

/** 资源 ID 可选值；空字符串 = 按音色自动推断 */
const RESOURCE_OPTIONS = [
  { value: '', label: '自动（按音色推断，推荐）' },
  { value: 'seed-tts-2.0', label: 'seed-tts-2.0（语音合成 2.0，*_uranus_bigtts 音色）' },
  { value: 'seed-tts-1.0', label: 'seed-tts-1.0（语音合成 1.0，*_moon / *_mars_bigtts 音色）' },
  { value: 'seed-icl-2.0', label: 'seed-icl-2.0（声音复刻 2.0，S_ 开头音色）' },
];

/** 语速 [-50, 100] → 倍速文案 */
const rateLabel = (rate: number) => `${(1 + rate / 100).toFixed(1)}×`;

/**
 * 豆包语音合成配置弹窗：鉴权方式、音色（预置或自定义 ID）、资源 ID、语速
 */
export const TtsConfigModal: React.FC<TtsConfigModalProps> = ({
  isOpen,
  config,
  voices,
  saving,
  testingVoiceId,
  onClose,
  onSave,
  onVoiceTest,
  saveError,
}) => {
  const [authMode, setAuthMode] = useState<AuthMode>('apiKey');
  const [apiKey, setApiKey] = useState('');
  const [appId, setAppId] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [customVoiceId, setCustomVoiceId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [speechRate, setSpeechRate] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const isPreset = voices.some(v => v.voiceId === config.defaultVoiceId);
    setAuthMode(!config.hasApiKey && config.hasAccessKey ? 'appToken' : 'apiKey');
    setApiKey('');
    setAppId(config.appId);
    setAccessKey('');
    setVoiceId(isPreset ? config.defaultVoiceId : '');
    setCustomVoiceId(isPreset ? '' : config.defaultVoiceId);
    setResourceId(config.resourceId);
    setSpeechRate(config.speechRate);
  }, [isOpen, config, voices]);

  const selectedVoiceId = customVoiceId.trim() || voiceId;

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
    if (selectedVoiceId && selectedVoiceId !== config.defaultVoiceId) {
      request.defaultVoiceId = selectedVoiceId;
    }
    if (resourceId !== config.resourceId) request.resourceId = resourceId;
    if (speechRate !== config.speechRate) request.speechRate = speechRate;
    onSave(request);
  };

  const canSave =
    !saving &&
    selectedVoiceId.length > 0 &&
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
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>编辑豆包语音合成配置</DialogTitle>
          <DialogDescription>鉴权方式、默认音色与合成参数；密钥留空表示保持不变。</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          {section(
            <KeyRound className="size-4" />,
            '鉴权',
            <>
              <RadioGroup value={authMode} onValueChange={(v) => setAuthMode(v as AuthMode)} className="flex gap-6">
                <Label className="flex items-center gap-2 font-normal">
                  <RadioGroupItem value="apiKey" />
                  API Key（新版控制台，推荐）
                </Label>
                <Label className="flex items-center gap-2 font-normal">
                  <RadioGroupItem value="appToken" />
                  AppID + Access Token（旧版控制台）
                </Label>
              </RadioGroup>
              {authMode === 'apiKey' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="tts-key">API Key</Label>
                  <Input
                    id="tts-key"
                    type="password"
                    value={apiKey}
                    placeholder={config.hasApiKey ? `已配置 ${config.apiKeyPreview ?? ''}，留空保持不变` : '请输入 API Key'}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">在火山引擎控制台「豆包语音 → API Key 管理」创建，并确认已开通「语音合成大模型」</p>
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
                      placeholder={config.hasAccessKey ? `已配置 ${config.accessKeyPreview ?? ''}，留空保持不变` : '请输入 Access Token'}
                      onChange={(e) => setAccessKey(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {section(
            <Users className="size-4" />,
            '默认音色',
            <>
              <VoiceSelector
                voices={voices}
                selectedVoiceId={customVoiceId.trim() ? undefined : voiceId}
                onVoiceSelect={(id) => {
                  setVoiceId(id);
                  setCustomVoiceId('');
                }}
                onVoiceTest={onVoiceTest}
                testingVoiceId={testingVoiceId}
                disabled={saving}
                title="预置英文音色"
                description="试听使用已保存的语速与资源设置"
              />
              <div className="space-y-1.5">
                <Label htmlFor="tts-custom-voice">自定义音色 ID</Label>
                <Input
                  id="tts-custom-voice"
                  value={customVoiceId}
                  placeholder="填写控制台音色列表中的音色 ID，例如 en_female_xxx_uranus_bigtts；填写后优先使用"
                  onChange={(e) => setCustomVoiceId(e.target.value)}
                  autoComplete="off"
                  className="font-mono"
                />
              </div>
            </>
          )}

          {section(
            <SlidersHorizontal className="size-4" />,
            '合成参数',
            <>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <Label>语速</Label>
                  <span className="text-sm font-medium tabular-nums">{rateLabel(speechRate)}</span>
                </div>
                <Slider min={-50} max={100} step={10} value={[speechRate]} onValueChange={([v]) => setSpeechRate(v)} aria-label="语速" />
                <p className="text-xs text-muted-foreground">单词跟读建议 0.8×–1.0×</p>
              </div>
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
                <p className="text-xs text-muted-foreground">音色与资源 ID 不匹配会报错 55000000，一般保持「自动」即可</p>
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
            保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
