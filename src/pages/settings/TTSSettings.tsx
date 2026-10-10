import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2, Pencil } from 'lucide-react';
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
import { TtsStyleSection } from './TtsStyleSection';
import { VoiceSelector } from '@/components/VoiceSelector';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/** 试听文本：短句（含数字），按句子朗读的风格读，贴近练习与短文的实际用法 */
const PREVIEW_TEXT = 'The elephant is a very large animal. It can eat 150 kilograms of food a day.';

/**
 * 设置「语音合成」：豆包语音配置（只读设置行 + 编辑弹窗）、试听、缓存清理
 */
export const TTSSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [config, setConfig] = useState<TtsConfig | null>(null);
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [saving, setSaving] = useState(false);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheStats, setCacheStats] = useState<TtsCacheStats | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  /** 音色筛选：全部 / 女声 / 男声 */
  const [gender, setGender] = useState<'all' | 'female' | 'male'>('all');
  /** 用其他音色 ID（不在预置列表里） */
  const [customVoice, setCustomVoice] = useState('');
  const [showCustomVoice, setShowCustomVoice] = useState(false);

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

  /** silent：保存后的刷新不换成骨架屏（否则页面高度塌掉、滚动跳回顶部，子组件也会重新挂载） */
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    const [configResult, voicesResult] = await Promise.all([ttsService.getTtsConfig(), ttsService.getTTSVoices()]);
    if (configResult.success) setConfig(configResult.data);
    if (!silent) setLoadError(configResult.success ? null : configResult.error);
    if (voicesResult.success || !silent) setVoices(voicesResult.success ? voicesResult.data : []);
    setLoading(false);
  };

  /**
   * 试听：整页只有一个播放器。点新的试听先停掉正在播的；再点正在播的那个就停止。
   * key = 'style'（朗读风格的试听）或音色 ID
   */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewRun = useRef(0);
  const [preview, setPreview] = useState<{ key: string; state: 'loading' | 'playing' } | null>(null);
  const stopPreview = () => {
    previewRun.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    setPreview(null);
  };
  useEffect(() => () => stopPreview(), []);
  const togglePreview = async (key: string, text: string, voiceId?: string) => {
    if (preview?.key === key) return stopPreview();
    stopPreview();
    const run = previewRun.current;
    setPreview({ key, state: 'loading' });
    const result = await ttsService.textToSpeech({ text, voiceId, style: 'sentence', useCache: false });
    if (run !== previewRun.current) return;
    if (!result.success) {
      setPreview(null);
      return toast.showError('无法试听', result.error);
    }
    const audio = new Audio(result.data.audioUrl);
    audioRef.current = audio;
    audio.onended = () => run === previewRun.current && setPreview(null);
    setPreview({ key, state: 'playing' });
    audio.play().catch(() => {
      if (run !== previewRun.current) return;
      setPreview(null);
      toast.showError('无法播放试听', '音频没能开始播放，请再试一次');
    });
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
    await loadData(true);
  };

  /** 直接在页面上改的设置（音色、语速）：立即保存 */
  const quickSave = async (request: UpdateTtsConfigRequest, done: string) => {
    const result = await ttsService.updateTtsConfig(request);
    if (!result.success) return toast.showError('无法保存', result.error);
    toast.showSuccess(done);
    await loadData(true);
  };
  const chooseVoice = (voiceId: string) => {
    if (!config || voiceId === config.defaultVoiceId) return;
    const name = voices.find((v) => v.voiceId === voiceId)?.displayName ?? voiceId;
    void quickSave({ defaultVoiceId: voiceId }, `已换成 ${name}`);
  };

  const handleVoiceTest = (voiceId: string) => void togglePreview(voiceId, PREVIEW_TEXT, voiceId);

  // 清理缓存：olderThanDays = 30 只清很久没用的；0 = 全部清空
  const handleClearTTSCache = (olderThanDays: number) => {
    const all = olderThanDays === 0;
    const size = formatBytes(all ? cacheStats?.totalBytes : cacheStats?.staleBytes);
    setConfirmDialog({
      isOpen: true,
      title: all ? '清空全部语音缓存？' : `清理 ${olderThanDays} 天没用过的语音缓存？`,
      message: all
        ? `删除全部 ${cacheStats?.entries ?? 0} 条缓存，共 ${size}。之后播放时重新生成，会消耗语音合成额度。`
        : `删除 ${cacheStats?.staleEntries ?? 0} 条缓存，共 ${size}。`,
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
          <PageError title="无法加载语音合成配置" message={loadError} onRetry={() => loadData()} />
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

  /** 豆包语音连接（鉴权、资源、音质）：不常改、含密钥，在弹窗里编辑 */
  const connection = (
    <SettingsSection
      title="豆包语音连接"
      description={config.configured ? undefined : '填写火山引擎的 API Key 后即可使用'}
      actions={
        <Button variant={config.configured ? 'outline' : 'default'} size="sm" onClick={() => setShowEdit(true)} disabled={saving}>
          <Pencil />
          {config.configured ? '编辑…' : '设置连接'}
        </Button>
      }
    >
      <SettingsRow label="鉴权">
        <span className={cn('font-mono text-xs select-text', !config.hasApiKey && !config.hasAccessKey && 'text-warning')}>{authText}</span>
      </SettingsRow>
      <SettingsRow label="资源 ID">
        <span className="font-mono text-xs select-text">{config.resourceId ? config.effectiveResourceId : `自动 · ${config.effectiveResourceId}`}</span>
      </SettingsRow>
      <SettingsRow label="音质">
        <span className="text-sm tabular-nums">{config.sampleRate / 1000}kHz MP3</span>
      </SettingsRow>
    </SettingsSection>
  );

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
      {!config.configured && connection}

      <SettingsSection
        title="音色"
        description={config.configured ? '单词和句子朗读用的声音，点一下就换；▶ 试听' : '先完成下方的豆包语音连接，才能试听和使用'}
        actions={
          <ToggleGroup type="single" value={gender} onValueChange={(v) => v && setGender(v as typeof gender)} className="rounded-lg bg-muted p-0.5" aria-label="按性别筛选">
            {(['all', 'female', 'male'] as const).map((g) => (
              <ToggleGroupItem key={g} value={g} className="h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm">
                {g === 'all' ? '全部' : g === 'female' ? '女声' : '男声'}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      >
        <div className="space-y-3 px-4 py-3">
          <VoiceSelector
            voices={voices.filter((v) => gender === 'all' || v.gender === gender)}
            selectedVoiceId={config.defaultVoiceId}
            onVoiceSelect={chooseVoice}
            onVoiceTest={handleVoiceTest}
            testingVoiceId={preview?.state === 'loading' ? preview.key : undefined}
            playingVoiceId={preview?.state === 'playing' ? preview.key : undefined}
            disabled={!config.configured}
          />
          {!voices.some((v) => v.voiceId === config.defaultVoiceId) && (
            <p className="text-sm">
              正在用：<span className="font-mono text-xs">{config.defaultVoiceId}</span>
            </p>
          )}
          {showCustomVoice ? (
            <div className="flex gap-2">
              <Input value={customVoice} onChange={(e) => setCustomVoice(e.target.value)} placeholder="其他音色 ID，例如 en_female_xxx_uranus_bigtts" className="font-mono" aria-label="其他音色 ID" />
              <Button
                variant="outline"
                disabled={!customVoice.trim()}
                onClick={() => {
                  void quickSave({ defaultVoiceId: customVoice.trim() }, '已换成这个音色');
                  setShowCustomVoice(false);
                  setCustomVoice('');
                }}
              >
                使用
              </Button>
            </div>
          ) : (
            <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" onClick={() => setShowCustomVoice(true)} disabled={!config.configured}>
              使用其他音色 ID…
            </Button>
          )}
        </div>
      </SettingsSection>

      <TtsStyleSection
        resourceId={config.effectiveResourceId}
        canPreview={config.configured}
        previewState={preview?.key === 'style' ? preview.state : 'idle'}
        onTogglePreview={(text) => void togglePreview('style', text)}
        speechRate={config.speechRate}
        onSpeechRateCommit={(rate) => void quickSave({ speechRate: rate }, `语速改为 ${(1 + rate / 100).toFixed(1)}×`)}
      />

      {config.configured && connection}

      <SettingsSection title="缓存">
        <SettingsRow
          label="语音缓存"
          description={
            cacheStats
              ? cacheStats.entries > 0
                ? `${cacheStats.entries} 条 · ${cacheStats.staleDays} 天没播放过 ${cacheStats.staleEntries} 条`
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
        saving={saving}
        onClose={() => {
          setShowEdit(false);
          setSaveError(null);
        }}
        onSave={handleSave}
        saveError={saveError}
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
