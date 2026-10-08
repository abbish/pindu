import React, { useState, useEffect } from 'react';
import { CheckCircle2, CircleAlert, Loader2, Pencil, Play } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { PageError } from '@/components/PageError';
import { cn } from '@/lib/utils';
import { ttsService, type TTSVoice, type TtsCacheStats, type TtsConfig, type UpdateTtsConfigRequest } from '../../services/ttsService';
import { formatBytes } from '@/utils/fileSize';
import { TtsConfigModal } from './TtsConfigModal';

/** 试听文本：单词 + 短句，贴近练习页的实际用法 */
const PREVIEW_TEXT = 'Elephant. The elephant is a very large animal.';

/**
 * 设置「语音合成」：豆包语音配置（只读设置行 + 编辑弹窗）、试听、缓存清理
 */
export const TTSSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [config, setConfig] = useState<TtsConfig | null>(null);
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [defaultVoice, setDefaultVoice] = useState<TTSVoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheStats, setCacheStats] = useState<TtsCacheStats | null>(null);
  const [testingVoiceId, setTestingVoiceId] = useState<string | undefined>();
  const [showEdit, setShowEdit] = useState(false);

  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'warning'
  });

  const toast = useToast();

  useEffect(() => {
    loadData();
    loadCacheStats();
  }, []);

  const loadCacheStats = async () => {
    const result = await ttsService.getCacheStats();
    if (result.success) setCacheStats(result.data);
  };

  const loadData = async () => {
    setLoading(true);
    const [configResult, voicesResult, defaultVoiceResult] = await Promise.all([
      ttsService.getTtsConfig(),
      ttsService.getTTSVoices(),
      ttsService.getDefaultTTSVoice()
    ]);
    if (configResult.success) setConfig(configResult.data);
    setLoadError(configResult.success ? null : configResult.error);
    setVoices(voicesResult.success ? voicesResult.data : []);
    setDefaultVoice(defaultVoiceResult.success ? defaultVoiceResult.data : null);
    setLoading(false);
  };

  const playAudio = (audioUrl: string) => {
    new Audio(audioUrl).play().catch(() => toast.showError('无法播放试听', '音频没能开始播放，请再试一次'));
  };

  const handleSave = async (request: UpdateTtsConfigRequest) => {
    if (Object.keys(request).length === 0) {
      setShowEdit(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const result = await ttsService.updateTtsConfig(request);
    setSaving(false);
    if (!result.success) {
      setSaveError(result.error);
      return;
    }
    toast.showSuccess('已保存语音合成配置');
    setShowEdit(false);
    await loadData();
  };

  // 用当前保存的配置试听默认音色（不走缓存，确保反映最新配置）
  const handlePreview = async () => {
    setPreviewing(true);
    const result = await ttsService.textToSpeech({ text: PREVIEW_TEXT, useCache: false });
    setPreviewing(false);
    if (result.success) {
      playAudio(result.data.audioUrl);
    } else {
      toast.showError('无法试听', result.error);
    }
  };

  // 弹窗内试听指定音色
  const handleVoiceTest = async (voiceId: string) => {
    setTestingVoiceId(voiceId);
    const result = await ttsService.textToSpeech({ text: PREVIEW_TEXT, voiceId, useCache: false });
    setTestingVoiceId(undefined);
    if (result.success) {
      playAudio(result.data.audioUrl);
    } else {
      toast.showError('无法试听', result.error);
    }
  };

  // 清理缓存：olderThanDays = 30 只清很久没用的；0 = 全部清空
  const handleClearTTSCache = (olderThanDays: number) => {
    const all = olderThanDays === 0;
    const size = formatBytes(all ? cacheStats?.totalBytes : cacheStats?.staleBytes);
    setConfirmDialog({
      isOpen: true,
      title: all ? '清空全部语音缓存？' : `清理 ${olderThanDays} 天没用过的语音缓存？`,
      message: all
        ? `将删除全部 ${cacheStats?.entries ?? 0} 条缓存（${size}）。之后每个单词、例句第一次播放时都要重新生成，需要联网并消耗语音合成额度。`
        : `将删除 ${cacheStats?.staleEntries ?? 0} 条超过 ${olderThanDays} 天没播放过的缓存（${size}）。下次播放时会重新生成。`,
      type: all ? 'danger' : 'warning',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        setCacheLoading(true);
        const result = await ttsService.clearTTSCache(olderThanDays);
        setCacheLoading(false);
        if (result.success) {
          toast.showSuccess(`已清理 ${result.data} 条语音缓存`);
        } else {
          toast.showError('无法清理语音缓存', result.error);
        }
        await loadCacheStats();
      },
    });
  };

  const title = '语音合成';

  if (loading || !config) {
    return (
      <SettingsPanel title={title}>
        {!loading && loadError ? (
          <PageError title="无法加载语音合成配置" message={loadError} onRetry={loadData} />
        ) : (
          <>
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </>
        )}
      </SettingsPanel>
    );
  }

  const authText = config.hasApiKey
    ? `API Key ${config.apiKeyPreview ?? ''}••••`
    : config.hasAccessKey
      ? `AppID ${config.appId || '未填写'} · Access Token ${config.accessKeyPreview ?? ''}••••`
      : '未设置';

  return (
    <SettingsPanel
      title={title}
      aside={
        config.configured ? (
          <Badge variant="outline" className="border-transparent bg-success-soft text-success">
            <CheckCircle2 /> 已配置
          </Badge>
        ) : (
          <Badge variant="outline" className="border-transparent bg-warning-soft text-warning">
            <CircleAlert /> 未配置
          </Badge>
        )
      }
    >
      <SettingsSection
        title="豆包语音"
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowEdit(true)} disabled={saving}>
            <Pencil />
            编辑配置…
          </Button>
        }
      >
        <SettingsRow label="鉴权">
          <span className={cn('font-mono text-xs select-text', !config.hasApiKey && !config.hasAccessKey && 'text-warning')}>{authText}</span>
        </SettingsRow>
        <SettingsRow label="默认音色">
          <span className="text-sm">{defaultVoice ? defaultVoice.displayName : config.defaultVoiceId}</span>
        </SettingsRow>
        <SettingsRow label="资源 ID" description={config.resourceId ? undefined : '按音色自动推断'}>
          <span className="font-mono text-xs select-text">{config.effectiveResourceId}</span>
        </SettingsRow>
        <SettingsRow label="语速与音质">
          <span className="text-sm tabular-nums">
            {(1 + config.speechRate / 100).toFixed(1)}× · {config.sampleRate / 1000}kHz MP3
          </span>
        </SettingsRow>
        <SettingsRow label="试听">
          <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewing || !config.configured}>
            {previewing ? <Loader2 className="animate-spin" /> : <Play />}
            试听
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="缓存">
        <SettingsRow
          label="语音缓存"
          description={
            cacheStats
              ? cacheStats.entries > 0
                ? `共 ${cacheStats.entries} 条，其中 ${cacheStats.staleDays} 天没播放过的 ${cacheStats.staleEntries} 条（${formatBytes(cacheStats.staleBytes)}）`
                : '还没有缓存'
              : undefined
          }
        >
          <div className="flex items-center gap-2">
            {cacheStats && (
              <span className="text-sm font-medium tabular-nums">{formatBytes(cacheStats.totalBytes)}</span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleClearTTSCache(cacheStats?.staleDays ?? 30)}
              disabled={cacheLoading || !cacheStats || cacheStats.staleEntries === 0}
            >
              {cacheLoading && <Loader2 className="animate-spin" />}
              清理 {cacheStats?.staleDays ?? 30} 天没用的
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => handleClearTTSCache(0)}
              disabled={cacheLoading || !cacheStats || cacheStats.entries === 0}
            >
              全部清空…
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>

      <TtsConfigModal
        isOpen={showEdit}
        config={config}
        voices={voices}
        saving={saving}
        testingVoiceId={testingVoiceId}
        onClose={() => {
          setShowEdit(false);
          setSaveError(null);
        }}
        onSave={handleSave}
        saveError={saveError}
        onVoiceTest={handleVoiceTest}
      />

      <AlertDialog open={confirmDialog.isOpen} onOpenChange={(open) => !open && setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDialog.onConfirm}>清理缓存</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPanel>
  );
};
