import React, { useEffect, useMemo, useState } from 'react';
import { InlineError } from '@/components/InlineError';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { aiModelService } from '../../services/aiModelService';
import type { AIModelConfig, AIProvider, CatalogModel, Id, ModelGenerationSettings } from '../../types';
import {
  emptyGenerationForm,
  generationFormFromModel,
  parseGenerationForm,
  THINKING_LABELS,
  THINKING_LEVELS,
  type GenerationForm,
} from '../../utils/modelGeneration';

export interface ModelFormValues {
  providerId: Id;
  displayName: string;
  modelId: string;
  description: string;
  generation: ModelGenerationSettings;
}

export interface ModelFormModalProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 编辑中的模型；null 为新建 */
  model: AIModelConfig | null;
  /** 可选提供商（只列启用的） */
  providers: AIProvider[];
  /** 新建时预选的提供商（从某个提供商的模型列表里点「手动添加」） */
  defaultProviderId?: Id;
  /** 保存中 */
  saving: boolean;
  onClose: () => void;
  onSave: (values: ModelFormValues) => void;
  /** 保存失败的原因（显示在弹窗内，弹窗保持打开） */
  saveError?: { title: string; message: string } | null;
}

const formatTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}K`);

/**
 * 模型编辑弹窗：基本信息 + 生成参数（对齐 pi 的 maxTokens / samplingParams / 思考档 / 上下文 / 推理）。
 * 提供商映射了 pi 内置目录时，展示该模型在目录中的能力，并把思考档限制为模型支持的档位。
 */
export const ModelFormModal: React.FC<ModelFormModalProps> = ({ isOpen, model, providers, defaultProviderId, saving, onClose, onSave, saveError }) => {
  const [providerId, setProviderId] = useState<Id>(0);
  const [displayName, setDisplayName] = useState('');
  const [modelId, setModelId] = useState('');
  const [description, setDescription] = useState('');
  const [generation, setGeneration] = useState<GenerationForm>(emptyGenerationForm());
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setProviderId(model?.provider.id ?? defaultProviderId ?? 0);
    setDisplayName(model?.displayName ?? '');
    setModelId(model?.modelId ?? '');
    setDescription(model?.description ?? '');
    setGeneration(model ? generationFormFromModel(model) : emptyGenerationForm());
    setError(null);
  }, [isOpen, model, defaultProviderId]);

  const provider = providers.find(p => p.id === providerId);
  const piProvider = provider?.piProvider ?? null;

  useEffect(() => {
    if (!isOpen || !piProvider) {
      setCatalogModels([]);
      return;
    }
    let cancelled = false;
    aiModelService.getAgentCatalogModels(piProvider).then(result => {
      if (!cancelled) setCatalogModels(result.success ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, piProvider]);

  const catalogModel = useMemo(
    () => catalogModels.find(m => m.id === modelId.trim()),
    [catalogModels, modelId]
  );
  const thinkingOptions = catalogModel ? catalogModel.thinkingLevels : [...THINKING_LEVELS];
  /** 自定义端点、或不在 pi 目录中的模型，需要自己填上下文与是否推理 */
  const needsModelMeta = !catalogModel;

  const set = (patch: Partial<GenerationForm>) => setGeneration(prev => ({ ...prev, ...patch }));

  const handleModelIdChange = (value: string) => {
    setModelId(value);
    const match = catalogModels.find(m => m.id === value.trim());
    if (match && !displayName.trim()) setDisplayName(match.name);
  };

  const handleSave = () => {
    const parsed = parseGenerationForm(generation);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onSave({ providerId, displayName: displayName.trim(), modelId: modelId.trim(), description, generation: parsed.generation });
  };

  const hint = (text: React.ReactNode) => <p className="text-xs text-muted-foreground">{text}</p>;
  const DEFAULT = '__default';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{model ? '编辑模型' : '添加模型'}</DialogTitle>
          <DialogDescription>基本信息与生成参数；参数留空表示不发送，使用 pi 目录或服务端默认。</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="mf-provider">提供商 *</Label>
            <Select value={providerId ? String(providerId) : undefined} onValueChange={(v) => setProviderId(Number(v))} disabled={!!model}>
              <SelectTrigger id="mf-provider" className="w-full">
                <SelectValue placeholder="请选择提供商" />
              </SelectTrigger>
              <SelectContent>
                {providers.filter((p) => p.isActive || p.id === providerId).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mf-model-id">模型 ID *</Label>
              <Input
                id="mf-model-id"
                value={modelId}
                onChange={(e) => handleModelIdChange(e.target.value)}
                list="pi-catalog-models"
                placeholder={piProvider ? '可从 pi 目录中选择或直接输入' : '例如: deepseek-chat'}
                className="font-mono"
              />
              <datalist id="pi-catalog-models">
                {catalogModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-name">显示名称 *</Label>
              <Input id="mf-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="例如: Kimi K3" />
            </div>
          </div>

          {catalogModel && (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              pi 目录：上下文 {formatTokens(catalogModel.contextWindow)} · 最大输出 {formatTokens(catalogModel.maxTokens)}
              {catalogModel.reasoning ? ` · 推理模型（思考档 ${catalogModel.thinkingLevels.join(' / ') || '不可调'}）` : ' · 非推理模型'}
              {` · $${catalogModel.costInput} / $${catalogModel.costOutput} 每百万 token`}
            </p>
          )}
          {piProvider && modelId.trim() && !catalogModel && catalogModels.length > 0 &&
            hint('该模型不在 pi 目录中，将作为新模型追加，请在下方补充上下文窗口与是否推理模型。')}

          <div className="space-y-1.5">
            <Label htmlFor="mf-desc">描述</Label>
            <Textarea id="mf-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="模型描述" rows={2} />
          </div>

          <section className="space-y-3 rounded-xl border p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal className="size-4" />
              生成参数
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mf-thinking">思考档</Label>
                <Select value={generation.thinkingLevel || DEFAULT} onValueChange={(v) => set({ thinkingLevel: v === DEFAULT ? '' : v })}>
                  <SelectTrigger id="mf-thinking" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT}>任务默认（提词 / 对话为「低」）</SelectItem>
                    {THINKING_LEVELS.filter((l) => thinkingOptions.includes(l) || l === generation.thinkingLevel).map((level) => (
                      <SelectItem key={level} value={level}>{THINKING_LABELS[level]}（{level}）</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hint('思考越深越准确，但更慢、更贵；pi 会按模型能力自动收敛')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mf-max">最大输出 token</Label>
                <Input
                  id="mf-max"
                  type="number"
                  value={generation.maxTokens}
                  onChange={(e) => set({ maxTokens: e.target.value })}
                  min={1}
                  placeholder={catalogModel ? `目录默认 ${formatTokens(catalogModel.maxTokens)}` : '留空 = 默认'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mf-temp">温度</Label>
                <Input
                  id="mf-temp"
                  type="number"
                  value={generation.temperature}
                  onChange={(e) => set({ temperature: e.target.value })}
                  min={0}
                  max={2}
                  step={0.1}
                  placeholder="留空 = 服务端默认"
                />
                {hint('部分模型只接受固定值（如 Kimi K3 只允许 1），不确定时留空')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mf-extra">额外参数（JSON）</Label>
                <Textarea
                  id="mf-extra"
                  value={generation.extraParams}
                  onChange={(e) => set({ extraParams: e.target.value })}
                  placeholder={'{"top_p": 0.95}'}
                  rows={2}
                  className="font-mono text-xs"
                />
                {hint('作为采样参数原样发送（仅 OpenAI 兼容接口生效）')}
              </div>
              {needsModelMeta && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="mf-context">上下文窗口</Label>
                    <Input id="mf-context" type="number" value={generation.contextWindow} onChange={(e) => set({ contextWindow: e.target.value })} min={1} placeholder="例如 128000" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mf-reasoning">推理模型</Label>
                    <Select value={generation.reasoning || DEFAULT} onValueChange={(v) => set({ reasoning: v === DEFAULT ? '' : v })}>
                      <SelectTrigger id="mf-reasoning" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT}>未设置</SelectItem>
                        <SelectItem value="true">是（支持思考档）</SelectItem>
                        <SelectItem value="false">否</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          </section>

          {error && <InlineError title="生成参数有误">{error}</InlineError>}
        </div>

        {saveError && (
          <div className="px-6 pb-3">
            <InlineError title={saveError.title}>{saveError.message}</InlineError>
          </div>
        )}
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !providerId || !displayName.trim() || !modelId.trim()}>
            {saving && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
