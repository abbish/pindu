import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { aiModelService } from '../../services/aiModelService';
import type { AIProvider, RemoteModelInfo } from '../../types';
import { InlineError } from '@/components/InlineError';

export interface SyncModelsModalProps {
  /** 要同步的提供商；null 时不显示 */
  provider: AIProvider | null;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 有模型添加成功后回调（用于刷新列表） */
  onAdded: () => void;
}

/** 新添加模型的默认输出上限；温度不预设（各模型可接受的温度不同，如 Kimi K3 只允许 1），需要时在「编辑模型」中设置 */
const DEFAULT_MAX_TOKENS = 16000;

/**
 * 「同步模型列表」弹窗：读取提供商 `/models`，勾选后批量添加为本地模型
 */
export const SyncModelsModal: React.FC<SyncModelsModalProps> = ({ provider, onClose, onAdded }) => {
  const [remoteModels, setRemoteModels] = useState<RemoteModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!provider) return;
    setRemoteModels([]);
    setSelected(new Set());
    setKeyword('');
    setError(null);
    setLoading(true);
    aiModelService.listProviderRemoteModels(provider.id).then(result => {
      if (result.success) {
        setRemoteModels(result.data);
      } else {
        setError(result.error);
      }
      setLoading(false);
    });
  }, [provider]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return remoteModels;
    return remoteModels.filter(m =>
      m.id.toLowerCase().includes(k) || (m.name ?? '').toLowerCase().includes(k)
    );
  }, [remoteModels, keyword]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAdd = async () => {
    if (!provider || selected.size === 0) return;
    setAdding(true);
    const failures: string[] = [];
    let added = 0;
    for (const model of remoteModels.filter(m => selected.has(m.id))) {
      const result = await aiModelService.createAIModel({
        providerId: provider.id,
        name: model.id,
        displayName: model.name || model.id,
        modelId: model.id,
        description: model.contextLength ? `上下文 ${model.contextLength.toLocaleString()} tokens` : undefined,
        // 目录中的模型由 pi 提供上限与能力；目录外的模型给一个保守的输出上限
        generation: model.inCatalog ? {} : { maxTokens: DEFAULT_MAX_TOKENS, contextWindow: model.contextLength ?? null },
      });
      if (result.success) {
        added += 1;
      } else {
        failures.push(`${model.id}：${result.error}`);
      }
    }
    setAdding(false);
    if (added > 0) {
      toast.showSuccess(`已添加 ${added} 个模型`);
      onAdded();
    }
    if (failures.length > 0) {
      // 留在弹窗里，方便调整后重试
      toast.showError(`有 ${failures.length} 个模型没能添加`, failures.length === 1 ? failures[0] : `${failures[0]} 等`);
      return;
    }
    onClose();
  };

  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && !adding && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>同步模型列表 · {provider?.displayName ?? ''}</DialogTitle>
          <DialogDescription>勾选要添加的模型</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
          {loading && (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 正在读取模型列表…
            </div>
          )}
          {error && (
            <InlineError title="无法读取模型列表">{error}</InlineError>
          )}
          {!loading && !error && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={`搜索 ${remoteModels.length} 个模型`}
                  aria-label="搜索模型"
                  className="pl-8"
                />
              </div>
              <ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border">
                {filtered.map((model) => (
                  <li key={model.id}>
                    <label className={cn('flex cursor-default items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50', model.alreadyAdded && 'opacity-60')}>
                      <Checkbox
                        checked={model.alreadyAdded || selected.has(model.id)}
                        disabled={model.alreadyAdded || adding}
                        onCheckedChange={() => toggle(model.id)}
                        aria-label={`选择 ${model.id}`}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-mono select-text">{model.id}</span>
                        {model.name && model.name !== model.id && <span className="ml-2 text-muted-foreground">{model.name}</span>}
                      </span>
                      <span className="flex shrink-0 flex-wrap justify-end gap-1">
                        {model.inCatalog && <Badge variant="secondary">pi 目录</Badge>}
                        {model.thinkingLevels && model.thinkingLevels.length > 0 && <Badge variant="outline">思考 {model.thinkingLevels.join('/')}</Badge>}
                        {model.contextLength && <Badge variant="outline">{Math.round(model.contextLength / 1000)}K</Badge>}
                        {model.costInput != null && model.costOutput != null && (
                          <Badge variant="outline">${model.costInput}/${model.costOutput}</Badge>
                        )}
                        {model.alreadyAdded && <Badge>已添加</Badge>}
                      </span>
                    </label>
                  </li>
                ))}
                {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的模型</li>}
              </ul>
            </>
          )}
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={onClose} disabled={adding}>
            取消
          </Button>
          <Button onClick={handleAdd} disabled={adding || selected.size === 0}>
            {adding && <Loader2 className="animate-spin" />}
            添加所选（{selected.size}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
