import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, MoreHorizontal, Plus, Search, XCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { toUserMessage } from '@/api/errors';
import { PageError } from '@/components/PageError';
import { aiModelService } from '../../services/aiModelService';
import { SyncModelsModal } from './SyncModelsModal';
import { ModelFormModal, type ModelFormValues } from './ModelFormModal';
import { ProviderFormModal, type ProviderFormValues } from './ProviderFormModal';
import type { AIProvider, AIModelConfig, ApiResult, CatalogProviderSummary, Id } from '../../types';

/** 左栏的一项：已配置的提供商（数据库里有记录）或 pi 目录里还没配置的提供商 */
interface Entry {
  key: string;
  name: string;
  /** pi 提供商 id；自定义接口为 null */
  piId: string | null;
  baseUrl: string;
  api: string;
  /** pi 目录内的模型数 */
  catalogCount: number;
  provider: AIProvider | null;
  /** pi 对 API 密钥的说明；pi 不支持密钥鉴权时为 null */
  apiKeyLabel: string | null;
}

/** 单个模型的连通性测试结果（显示在模型行内） */
type TestState = { status: 'testing' } | { status: 'ok'; ms: number; message: string } | { status: 'fail'; message: string };

interface ConfirmState {
  isOpen: boolean;
  /** 问句：“删除模型「X」？” */
  title: string;
  /** 只讲后果 */
  message: string;
  /** 确认按钮上的动作 */
  confirmText: string;
  onConfirm: () => void;
}

/** 生成参数摘要（只列已设置的） */
const paramText = (m: AIModelConfig): string => {
  const parts: string[] = [];
  if (m.thinkingLevel) parts.push(`思考 ${m.thinkingLevel}`);
  if (m.temperature != null) parts.push(`温度 ${m.temperature}`);
  if (m.maxTokens != null) parts.push(`最大输出 ${m.maxTokens}`);
  if (m.extraParams && Object.keys(m.extraParams).length > 0) parts.push(`另有 ${Object.keys(m.extraParams).length} 个参数`);
  return parts.join(' · ');
};

/**
 * 设置「AI 模型」：我们是 pi 的配置外壳。
 * 总览（默认模型 + 已配置的提供商）→ 下钻到提供商详情（密钥、启用、模型）；「添加提供商」列出 pi 目录里未配置的。
 */
export const AIModelSettings: React.FC = () => {
  const toast = useToast();
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [models, setModels] = useState<AIModelConfig[]>([]);
  const [catalog, setCatalog] = useState<CatalogProviderSummary[]>([]);
  /** 读取提供商目录失败的原因（后端已转成用户能看懂的话） */
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** 当前视图：总览 → 添加提供商（目录）/ 提供商详情（下钻） */
  const [view, setView] = useState<'overview' | 'catalog' | 'provider'>('overview');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [editingKey, setEditingKey] = useState(false);

  const [customForm, setCustomForm] = useState<AIProvider | null>(null);
  const [modelForm, setModelForm] = useState<{ open: boolean; model: AIModelConfig | null }>({ open: false, model: null });
  const [syncProvider, setSyncProvider] = useState<AIProvider | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>({ isOpen: false, title: '', message: '', confirmText: '', onConfirm: () => {} });
  const [tests, setTests] = useState<Record<number, TestState>>({});

  const [loadError, setLoadError] = useState<string | null>(null);
  /** 弹窗里的保存失败：显示在弹窗内（ui-interaction-patterns §6.1） */
  const [formError, setFormError] = useState<{ title: string; message: string } | null>(null);

  const loadData = async (preferKey?: string) => {
    const [providersResult, modelsResult] = await Promise.all([aiModelService.getAllAIProviders(), aiModelService.getAllAIModels()]);
    setLoading(false);
    if (!providersResult.success || !modelsResult.success) {
      setLoadError(!providersResult.success ? providersResult.error : !modelsResult.success ? modelsResult.error : null);
      return;
    }
    setLoadError(null);
    setProviders(providersResult.data);
    setModels(modelsResult.data);
    if (preferKey) setSelectedKey(preferKey);
  };

  const loadCatalog = async () => {
    setCatalogLoading(true);
    const result = await aiModelService.getAgentCatalogProviders();
    setCatalogLoading(false);
    if (result.success) setCatalog(result.data);
    setCatalogError(result.success ? null : result.error);
  };

  useEffect(() => {
    loadData();
    loadCatalog();
  }, []);

  const defaultModel = models.find(m => m.isDefault) ?? null;
  const modelCount = (providerId: Id) => models.filter(m => m.provider.id === providerId).length;

  // 已配置（默认模型所在的在最前，其余按模型数、名称）| 未配置：只列只填密钥就能用的（需要区域、账户 ID 或登录授权的不支持，不显示）
  const { configured, unconfigured } = useMemo(() => {
    const byPi = new Map(catalog.map(c => [c.id, c]));
    const configuredEntries: Entry[] = providers.map(p => {
      const c = p.piProvider ? byPi.get(p.piProvider) : undefined;
      return {
        key: `db-${p.id}`,
        name: c?.name ?? p.displayName,
        piId: p.piProvider ?? null,
        baseUrl: c?.baseUrl ?? p.baseUrl,
        api: c?.api ?? p.api,
        catalogCount: c?.modelCount ?? 0,
        provider: p,
        apiKeyLabel: c?.apiKeyLabel ?? null,
      };
    });
    const mapped = new Set(providers.map(p => p.piProvider).filter(Boolean));
    const rest: Entry[] = catalog
      .filter(c => !mapped.has(c.id) && c.keyOnly)
      .map(c => ({
        key: `pi-${c.id}`,
        name: c.name,
        piId: c.id,
        baseUrl: c.baseUrl,
        api: c.api,
        catalogCount: c.modelCount,
        provider: null,
        apiKeyLabel: c.apiKeyLabel,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const defaultProviderId = defaultModel?.provider.id;
    configuredEntries.sort(
      (a, b) =>
        Number(b.provider!.id === defaultProviderId) - Number(a.provider!.id === defaultProviderId) ||
        modelCount(b.provider!.id) - modelCount(a.provider!.id) ||
        a.name.localeCompare(b.name, 'zh-CN')
    );
    return { configured: configuredEntries, unconfigured: rest };
  }, [providers, catalog, models]);

  const allEntries = [...configured, ...unconfigured];
  const selected = allEntries.find(e => e.key === selectedKey) ?? null;

  // 换提供商时收起密钥编辑、清空搜索
  useEffect(() => {
    setEditingKey(false);
    setKeyDraft('');
    setModelQuery('');
  }, [selected?.key]);

  const selectedModels = useMemo(() => {
    if (!selected?.provider) return [];
    const q = modelQuery.trim().toLowerCase();
    return models
      .filter(m => m.provider.id === selected.provider!.id)
      .filter(m => !q || m.displayName.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.isActive) - Number(a.isActive) || a.displayName.localeCompare(b.displayName));
  }, [models, selected, modelQuery]);

  const usableModels = models.filter(m => m.isActive && m.provider.isActive);

  /**
   * 执行一次写操作：成功后刷新；失败提示“无法 + 动作”与原因。
   * inForm：在弹窗里发起的保存，失败显示在弹窗内，弹窗保持打开。
   */
  const run = async (failTitle: string, action: () => Promise<ApiResult<unknown>>, after?: string, inForm = false) => {
    setSaving(true);
    if (inForm) setFormError(null);
    const result = await action();
    if (!result.success) {
      setSaving(false);
      if (inForm) setFormError({ title: failTitle, message: result.error });
      else toast.showError(failTitle, result.error);
      return false;
    }
    await loadData(after);
    setSaving(false);
    return true;
  };

  /** 未配置的 pi 提供商：填密钥即创建，然后打开模型同步 */
  const handleConnect = async (entry: Entry) => {
    if (!entry.piId || !keyDraft.trim()) return;
    setSaving(true);
    const result = await aiModelService.createAIProvider({
      name: entry.piId,
      displayName: entry.name,
      baseUrl: entry.baseUrl,
      apiKey: keyDraft.trim(),
      description: '',
      piProvider: entry.piId,
      api: entry.api,
    });
    if (!result.success) {
      setSaving(false);
      toast.showError('无法保存密钥', result.error);
      return;
    }
    setKeyDraft('');
    await loadData(`db-${result.data}`);
    toast.showSuccess('已保存密钥');
    const created = await aiModelService.getAllAIProviders();
    const provider = created.success ? created.data.find(p => p.id === result.data) : undefined;
    if (provider) setSyncProvider(provider);
    setSaving(false);
  };

  const handleSaveKey = async (provider: AIProvider) => {
    if (!keyDraft.trim()) return;
    const ok = await run('无法更新密钥', () => aiModelService.updateAIProvider(provider.id, { apiKey: keyDraft.trim() }));
    if (ok) {
      setEditingKey(false);
      setKeyDraft('');
      toast.showSuccess('已更新密钥');
    }
  };

  const handleRemoveProvider = (entry: Entry) =>
    setConfirm({
      isOpen: true,
      title: `移除「${entry.name}」？`,
      message: `它的密钥和 ${modelCount(entry.provider!.id)} 个模型会一起删除`,
      confirmText: '移除',
      onConfirm: () => {
        setConfirm(prev => ({ ...prev, isOpen: false }));
        run('无法移除提供商', () => aiModelService.deleteAIProvider(entry.provider!.id)).then(ok => {
          if (!ok) return;
          toast.showSuccess(`已移除「${entry.name}」`);
          setView('overview');
        });
      },
    });

  const handleDeleteModel = (m: AIModelConfig) =>
    setConfirm({
      isOpen: true,
      title: `删除模型「${m.displayName}」？`,
      message: '删除后不能恢复',
      confirmText: '删除',
      onConfirm: () => {
        setConfirm(prev => ({ ...prev, isOpen: false }));
        run('无法删除模型', () => aiModelService.deleteAIModel(m.id)).then(ok => ok && toast.showSuccess(`已删除「${m.displayName}」`));
      },
    });

  const handleSaveCustom = async (values: ProviderFormValues) => {
    if (!customForm) return;
    const ok = await run('无法保存提供商', () =>
      aiModelService.updateAIProvider(customForm.id, {
        displayName: values.displayName,
        baseUrl: values.baseUrl,
        apiKey: values.apiKey || undefined,
        description: values.description,
        piProvider: values.piProvider,
        api: values.api,
      }),
      undefined,
      true
    );
    if (ok) setCustomForm(null);
  };

  const handleSaveModel = async (values: ModelFormValues) => {
    const editing = modelForm.model;
    const ok = await run(editing ? '无法保存模型' : '无法添加模型', () =>
      editing
        ? aiModelService.updateAIModel(editing.id, {
            displayName: values.displayName,
            modelId: values.modelId,
            description: values.description,
            generation: values.generation,
          })
        : aiModelService.createAIModel({
            providerId: values.providerId,
            name: values.modelId, // 同一提供商下 name 唯一：用模型 ID
            displayName: values.displayName,
            modelId: values.modelId,
            description: values.description,
            generation: values.generation,
          }),
      undefined,
      true
    );
    if (ok) setModelForm({ open: false, model: null });
  };

  const handleTest = async (m: AIModelConfig) => {
    setTests(prev => ({ ...prev, [m.id]: { status: 'testing' } }));
    const result = await aiModelService.testAIModel(m.id);
    setTests(prev => ({
      ...prev,
      [m.id]:
        result.success && result.data?.success
          ? { status: 'ok', ms: result.data.responseTime, message: result.data.message }
          : {
              status: 'fail',
              // 测试结果里的错误是提供商原文：同样转成能处理的说法
              message: result.success ? toUserMessage(result.data?.error || '没有收到模型的回复', 'EXTERNAL_SERVICE_ERROR') : result.error,
            },
    }));
  };

  const panelTitle = 'AI 模型';

  if (loading) {
    return (
      <SettingsPanel title={panelTitle}>
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </SettingsPanel>
    );
  }

  const statusText = (e: Entry) => {
    const count = e.provider ? modelCount(e.provider.id) : 0;
    if (!e.provider) return `${e.catalogCount} 个模型`;
    if (!e.provider.isActive) return '已停用';
    if (!e.provider.hasApiKey) return '未填写密钥';
    return count > 0 ? `${count} 个模型` : '还没有添加模型';
  };

  const openProvider = (key: string) => {
    setSelectedKey(key);
    setView('provider');
  };

  const providerRow = (e: Entry) => (
    <SettingsRow key={e.key} label={e.name} description={statusText(e)} onClick={() => openProvider(e.key)}>
      {e.provider && defaultModel?.provider.id === e.provider.id && <Badge className="h-5">默认</Badge>}
      {e.provider && !e.provider.hasApiKey && <Badge variant="outline" className="h-5 border-transparent bg-warning-soft text-warning">缺密钥</Badge>}
    </SettingsRow>
  );

  const backToOverview = { label: panelTitle, onClick: () => setView('overview') };
  const dialogs = (
    <>
      <SyncModelsModal provider={syncProvider} onClose={() => setSyncProvider(null)} onAdded={() => loadData()} />
      <ProviderFormModal
        isOpen={customForm !== null}
        provider={customForm}
        catalogProviders={catalog}
        saving={saving}
        onClose={() => {
          setCustomForm(null);
          setFormError(null);
        }}
        onSave={handleSaveCustom}
        saveError={formError}
      />
      <ModelFormModal
        isOpen={modelForm.open}
        model={modelForm.model}
        providers={providers}
        defaultProviderId={selected?.provider?.id}
        saving={saving}
        onClose={() => {
          setModelForm({ open: false, model: null });
          setFormError(null);
        }}
        onSave={handleSaveModel}
        saveError={formError}
      />
      <AlertDialog open={confirm.isOpen} onOpenChange={(open) => !open && setConfirm((prev) => ({ ...prev, isOpen: false }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: 'destructive' })} onClick={confirm.onConfirm}>
              {confirm.confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  /* ── 添加提供商：pi 目录里还没配置的 ── */
  if (view === 'catalog') {
    const q = catalogQuery.trim().toLowerCase();
    const match = (e: Entry) => !q || e.name.toLowerCase().includes(q) || (e.piId ?? '').toLowerCase().includes(q);
    const keyOnlyList = unconfigured.filter(match);
    return (
      <SettingsPanel title="添加提供商" back={backToOverview}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="搜索提供商" aria-label="搜索提供商" className="pl-9" autoFocus />
        </div>
        {catalog.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p>{catalogLoading ? '正在读取提供商列表…' : catalogError ? `无法读取提供商列表：${catalogError}` : '没有可添加的提供商'}</p>
            {catalogError && !catalogLoading && (
              <Button variant="outline" size="sm" onClick={loadCatalog}>
                重试
              </Button>
            )}
          </div>
        ) : keyOnlyList.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">没有匹配的提供商</p>
        ) : (
          <>
            <SettingsSection title="填写 API 密钥即可使用">{keyOnlyList.map(providerRow)}</SettingsSection>
          </>
        )}
        {dialogs}
      </SettingsPanel>
    );
  }

  /* ── 提供商详情 ── */
  const provider = selected?.provider ?? null;
  if (view === 'provider' && selected) {
    return (
      <SettingsPanel
        title={selected.name}
        back={backToOverview}
        aside={
          provider && (
            <Badge variant="outline" className={cn('border-transparent', provider.isActive ? 'bg-success-soft text-success' : 'bg-secondary text-muted-foreground')}>
              {provider.isActive ? '已启用' : '已停用'}
            </Badge>
          )
        }
        description={selected.baseUrl ? <span className="font-mono text-xs select-text">{selected.baseUrl}</span> : undefined}
      >
        {!provider ? (
            <SettingsSection title="连接">
              <SettingsRow label="API 密钥" stacked>
                <Input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleConnect(selected)}
                  placeholder={selected.apiKeyLabel ?? 'API 密钥'}
                  autoComplete="off"
                  autoFocus
                  className="flex-1"
                />
                <Button onClick={() => handleConnect(selected)} disabled={saving || !keyDraft.trim()}>
                  {saving && <Loader2 className="animate-spin" />}
                  保存并选择模型
                </Button>
              </SettingsRow>
            </SettingsSection>
        ) : (
          <>
            <SettingsSection title="连接">
              <SettingsRow
                label="API 密钥"
                description={!editingKey && !provider.hasApiKey ? <span className="text-warning">未填写，模型无法使用</span> : undefined}
                stacked={editingKey}
              >
                {editingKey ? (
                  <>
                    <Input
                      type="password"
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSaveKey(provider)}
                      placeholder={selected.apiKeyLabel ? `新的 ${selected.apiKeyLabel}` : '新的 API 密钥'}
                      autoComplete="off"
                      autoFocus
                      className="flex-1"
                    />
                    <Button onClick={() => handleSaveKey(provider)} disabled={saving || !keyDraft.trim()}>
                      保存
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingKey(false);
                        setKeyDraft('');
                      }}
                    >
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    {provider.hasApiKey && <span className="font-mono text-xs text-muted-foreground">{provider.apiKeyPreview ?? ''}••••••••</span>}
                    <Button size="sm" variant="outline" onClick={() => setEditingKey(true)}>
                      {provider.hasApiKey ? '修改' : '填写'}
                    </Button>
                  </>
                )}
              </SettingsRow>
              <SettingsRow label="启用" htmlFor="provider-active">
                <Switch
                  id="provider-active"
                  checked={provider.isActive}
                  disabled={saving}
                  onCheckedChange={(checked) => run(checked ? '无法启用提供商' : '无法停用提供商', () => aiModelService.updateAIProvider(provider.id, { isActive: checked }))}
                />
              </SettingsRow>
              {!provider.piProvider && (
                <SettingsRow label="接口地址">
                  <Button size="sm" variant="outline" onClick={() => setCustomForm(provider)} disabled={saving}>
                    编辑接口…
                  </Button>
                </SettingsRow>
              )}
            </SettingsSection>

            <SettingsSection
              title={`模型（${modelCount(provider.id)}）`}
              actions={
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} placeholder="搜索模型" aria-label="搜索模型" className="h-8 w-44 pl-8" />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setSyncProvider(provider)}
                    disabled={saving || !provider.isActive}
                    title={provider.isActive ? undefined : '启用后才能选择模型'}
                  >
                    选择模型…
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setModelForm({ open: true, model: null })} disabled={saving}>
                    <Plus />
                    手动添加
                  </Button>
                </>
              }
            >
              {selectedModels.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {modelQuery ? '没有匹配的模型' : '还没有模型'}
                </p>
              ) : (
                selectedModels.map((m) => {
                  const test = tests[m.id];
                  const usable = m.isActive && provider.isActive;
                  return (
                    <div key={m.id} className={cn('flex items-center gap-3 px-4 py-3', !m.isActive && 'opacity-60')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {m.displayName}
                          {m.isDefault && <Badge className="h-5">默认</Badge>}
                          {!m.isActive && (
                            <Badge variant="secondary" className="h-5">
                              已停用
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          <span className="font-mono text-xs select-text">{m.modelId}</span>
                          {paramText(m) && <span> · {paramText(m)}</span>}
                        </div>
                        {test && test.status !== 'testing' && (
                          <div className={cn('mt-0.5 inline-flex items-center gap-1 text-xs', test.status === 'ok' ? 'text-success' : 'text-destructive')}>
                            {test.status === 'ok' ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                            {test.status === 'ok' ? `测试通过，用时 ${test.ms} ms` : `测试失败：${test.message}`}
                          </div>
                        )}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleTest(m)} disabled={test?.status === 'testing' || !usable}>
                        {test?.status === 'testing' && <Loader2 className="animate-spin" />}
                        {test?.status === 'testing' ? '测试中…' : '测试'}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="size-8" aria-label="更多操作" disabled={saving}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!m.isDefault && (
                            <DropdownMenuItem disabled={!usable} onSelect={() => run('无法设为默认模型', () => aiModelService.setDefaultAIModel(m.id))}>
                              设为默认
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => setModelForm({ open: true, model: m })}>编辑…</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => run(m.isActive ? '无法停用模型' : '无法启用模型', () => aiModelService.updateAIModel(m.id, { isActive: !m.isActive }))}>
                            {m.isActive ? '停用' : '启用'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => handleDeleteModel(m)}>
                            删除…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })
              )}
            </SettingsSection>

            <SettingsSection title="移除" tone="danger">
              <SettingsRow label="移除这个提供商">
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleRemoveProvider(selected)} disabled={saving}>
                  移除…
                </Button>
              </SettingsRow>
            </SettingsSection>
          </>
        )}
        {dialogs}
      </SettingsPanel>
    );
  }

  /* ── 总览：默认模型 + 已配置的提供商 ── */
  if (loadError) {
    return (
      <SettingsPanel title={panelTitle}>
        <PageError title="无法加载 AI 模型配置" message={loadError} onRetry={() => loadData()} />
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel title={panelTitle}>
      <SettingsSection title="默认模型">
        <SettingsRow label="默认模型">
          <Select value={defaultModel ? String(defaultModel.id) : undefined} onValueChange={(v) => run('无法设为默认模型', () => aiModelService.setDefaultAIModel(Number(v)))} disabled={saving}>
            <SelectTrigger className="w-64" aria-label="默认模型">
              <SelectValue placeholder="未设置" />
            </SelectTrigger>
            <SelectContent>
              {configured.map((entry) => {
                const options = usableModels.filter((m) => m.provider.id === entry.provider!.id);
                return options.length === 0 ? null : (
                  <SelectGroup key={entry.key}>
                    <SelectLabel>{entry.name}</SelectLabel>
                    {options.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.displayName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="提供商"
        actions={
          <Button size="sm" variant="outline" onClick={() => setView('catalog')}>
            <Plus />
            添加提供商
          </Button>
        }
      >
        {configured.length > 0 ? (
          configured.map(providerRow)
        ) : (
          <SettingsRow label="还没有配置提供商" description="添加后才能使用 AI 功能" />
        )}
      </SettingsSection>
      {dialogs}
    </SettingsPanel>
  );
};
