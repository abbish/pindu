import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/InlineError';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { AIProvider, CatalogProviderSummary } from '../../types';

/** 提供商表单的值（新建与编辑共用） */
export interface ProviderFormValues {
  name: string;
  displayName: string;
  baseUrl: string;
  /** 编辑时留空 = 保持原密钥 */
  apiKey: string;
  description: string;
  /** 映射的 pi 内置提供商；空 = 自定义端点 */
  piProvider: string;
  api: string;
}

export interface ProviderFormModalProps {
  isOpen: boolean;
  /** 编辑中的提供商；null 为新建 */
  provider: AIProvider | null;
  /** pi 内置提供商目录（sidecar 不可用时为空） */
  catalogProviders: CatalogProviderSummary[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: ProviderFormValues) => void;
  /** 保存失败的原因（显示在弹窗内，弹窗保持打开） */
  saveError?: { title: string; message: string } | null;
}

const emptyForm = (): ProviderFormValues => ({
  name: '',
  displayName: '',
  baseUrl: '',
  apiKey: '',
  description: '',
  piProvider: '',
  api: 'openai-completions',
});

/**
 * 提供商新建 / 编辑弹窗：选择 pi 内置提供商时自动带出名称与官方地址。
 */
export const ProviderFormModal: React.FC<ProviderFormModalProps> = ({
  isOpen,
  provider,
  catalogProviders,
  saving,
  onClose,
  onSave,
  saveError,
}) => {
  const [form, setForm] = useState<ProviderFormValues>(emptyForm());

  useEffect(() => {
    if (!isOpen) return;
    setForm(
      provider
        ? {
            name: provider.name,
            displayName: provider.displayName,
            baseUrl: provider.baseUrl,
            apiKey: '', // 后端不返回 API Key；留空表示保持不变
            description: provider.description || '',
            piProvider: provider.piProvider ?? '',
            api: provider.api || 'openai-completions',
          }
        : emptyForm()
    );
  }, [isOpen, provider]);

  const editing = provider !== null;
  const canSave = !saving && form.name && form.displayName && form.baseUrl && (editing || form.apiKey);

  const handlePiProviderChange = (id: string) => {
    const builtin = catalogProviders.find(c => c.id === id);
    setForm(prev => ({
      ...prev,
      piProvider: id,
      // 新建时带出名称与官方地址（地址仅用于展示与模型同步，调用以 pi 内置配置为准）
      name: !editing && !prev.name && builtin ? builtin.id : prev.name,
      displayName: !prev.displayName && builtin ? builtin.id : prev.displayName,
      baseUrl: builtin && !prev.baseUrl ? builtin.baseUrl : prev.baseUrl,
    }));
  };

  const NONE = '__none';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{editing ? `编辑提供商 · ${provider.displayName}` : '添加提供商'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="pf-pi">内置提供商</Label>
            <Select value={form.piProvider || NONE} onValueChange={(v) => handlePiProviderChange(v === NONE ? '' : v)}>
              <SelectTrigger id="pf-pi" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>自定义</SelectItem>
                {catalogProviders.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} · {c.modelCount} 个模型</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {catalogProviders.length === 0 && <p className="text-xs text-muted-foreground">暂时读不到内置提供商列表</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pf-name">名称</Label>
              <Input id="pf-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：openai" disabled={editing} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-display">显示名称</Label>
              <Input id="pf-display" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="例如：OpenAI" />
            </div>
          </div>
          {!form.piProvider && (
            <div className="space-y-1.5">
              <Label htmlFor="pf-api">接口类型</Label>
              <Select value={form.api} onValueChange={(v) => setForm({ ...form, api: v })}>
                <SelectTrigger id="pf-api" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-completions">OpenAI Chat Completions</SelectItem>
                  <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                  <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pf-url">API 地址</Label>
            <Input id="pf-url" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="例如：https://api.openai.com/v1" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-key">API 密钥</Label>
            <Input
              id="pf-key"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={
                editing
                  ? provider.hasApiKey
                    ? `已配置 ${provider.apiKeyPreview ?? ''}…，留空保持不变`
                    : 'API 密钥'
                  : 'API 密钥'
              }
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-desc">描述</Label>
            <Textarea id="pf-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>
        </div>
        {saveError && <InlineError title={saveError.title}>{saveError.message}</InlineError>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => onSave(form)} disabled={!canSave}>
            {saving && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
