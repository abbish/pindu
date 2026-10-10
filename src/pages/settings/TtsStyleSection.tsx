import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { ttsService, type TtsPreferences, type TtsStylePreset } from '@/services/ttsService';

/** 句子朗读风格的预设（与后端 services/tts.rs::sentence_instruction 对应） */
const PRESETS: { value: TtsStylePreset; label: string; description: string }[] = [
  { value: 'teacher', label: '老师示范', description: '清晰平稳、语速稍慢，适合跟读' },
  { value: 'natural', label: '自然口语', description: '像日常对话一样自然连读' },
  { value: 'story', label: '讲故事', description: '温和、有表现力，适合短文' },
  { value: 'news', label: '新闻播报', description: '正式、平稳、字字清楚' },
  { value: 'custom', label: '自定义', description: '自己写想要的语气' },
];
const CUSTOM_MAX = 200;
/** 试听：带数字和日期，听得出是否按英语读、语气是否合适 */
const STYLE_PREVIEW = 'On May 3rd, Emma bought 2 tickets for 15 dollars. She was so excited about the trip!';
/** 支持朗读风格（语音指令）的资源 */
const STYLE_RESOURCES = ['seed-tts-2.0', 'seed-icl-2.0'];

export interface TtsStyleSectionProps {
  /** 当前默认音色对应的资源 ID（1.0 音色不支持风格） */
  resourceId: string;
  /** 已配置好鉴权，可以试听 */
  canPreview: boolean;
  /** 试听状态（整页共用一个播放器） */
  previewState: 'idle' | 'loading' | 'playing';
  /** 开始 / 停止试听 */
  onTogglePreview: (text: string) => void;
  /** 语速 [-50, 100]（存在豆包配置里） */
  speechRate: number;
  onSpeechRateCommit: (rate: number) => void;
}

/**
 * 「设置 → 语音合成 → 朗读风格」：句子的语气预设（或自定义）、音调、音量；改了立即保存，可以直接试听。
 * 单词发音始终是平稳的示范语气，不受风格影响。
 */
export const TtsStyleSection: React.FC<TtsStyleSectionProps> = ({ resourceId, canPreview, previewState, onTogglePreview, speechRate, onSpeechRateCommit }) => {
  const [rate, setRate] = useState(speechRate ?? 0);
  useEffect(() => setRate(speechRate ?? 0), [speechRate]);
  const toast = useToast();
  const [prefs, setPrefs] = useState<TtsPreferences | null>(null);
  const [customDraft, setCustomDraft] = useState('');
  /** 最近保存成功的值（保存失败时退回） */
  const savedRef = useRef<TtsPreferences | null>(null);

  useEffect(() => {
    ttsService.getPreferences().then((r) => {
      if (!r.success) return toast.showError('无法读取朗读风格', r.error);
      savedRef.current = r.data;
      setPrefs(r.data);
      setCustomDraft(r.data.customInstruction);
    });
  }, []);

  const save = async (next: TtsPreferences) => {
    setPrefs(next);
    const r = await ttsService.updatePreferences(next);
    if (!r.success) {
      toast.showError('无法保存朗读风格', r.error);
      setPrefs(savedRef.current);
      return false;
    }
    savedRef.current = r.data;
    setPrefs(r.data);
    return true;
  };

  if (!prefs) {
    return (
      <SettingsSection title="朗读风格">
        <Skeleton className="h-40 w-full" />
      </SettingsSection>
    );
  }

  const supportsStyle = STYLE_RESOURCES.includes(resourceId);
  const chooseStyle = (style: TtsStylePreset) => {
    // 自定义还没写要求：先切过去写，写完失焦时保存
    if (style === 'custom' && !customDraft.trim()) return setPrefs({ ...prefs, style });
    void save({ ...prefs, style, customInstruction: customDraft.trim() });
  };

  return (
    <SettingsSection
      title="朗读风格"
      description={supportsStyle ? '句子朗读的语气；单词发音始终是平稳的示范语气' : '当前音色不支持朗读风格，换用 2.0 音色才会生效；音调和音量照样有效'}
      actions={
        <Button variant="outline" size="sm" onClick={() => onTogglePreview(STYLE_PREVIEW)} disabled={!canPreview}>
          {previewState === 'loading' ? <Loader2 className="animate-spin" /> : previewState === 'playing' ? <Square className="fill-current" /> : <Play />}
          {previewState === 'idle' ? '试听' : previewState === 'loading' ? '合成中…' : '停止'}
        </Button>
      }
    >
      <div className="px-4 py-3">
        <RadioGroup value={prefs.style} onValueChange={(v) => chooseStyle(v as TtsStylePreset)} className="grid grid-cols-5 gap-2 max-md:grid-cols-2" aria-label="朗读风格">
          {PRESETS.map((p) => (
            <Label
              key={p.value}
              htmlFor={`tts-style-${p.value}`}
              className="flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border p-3 font-normal transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/50"
            >
              <RadioGroupItem id={`tts-style-${p.value}`} value={p.value} className="sr-only" />
              <span className="text-sm font-medium">{p.label}</span>
              <span className="text-xs text-muted-foreground">{p.description}</span>
            </Label>
          ))}
        </RadioGroup>
        {prefs.style === 'custom' && (
          <div className="mt-3 space-y-1.5">
            <Textarea
              value={customDraft}
              maxLength={CUSTOM_MAX}
              onChange={(e) => setCustomDraft(e.target.value)}
              onBlur={() => {
                if (customDraft.trim() && customDraft.trim() !== prefs.customInstruction) void save({ ...prefs, style: 'custom', customInstruction: customDraft.trim() });
              }}
              placeholder="例如：Read slowly and warmly, like a parent reading a bedtime story.（用英文写效果更稳定）"
              className="min-h-20 resize-none"
              aria-label="自定义朗读风格"
            />
            <p className="text-xs text-muted-foreground">
              {customDraft.trim().length} / {CUSTOM_MAX}
              {!customDraft.trim() && ' · 写好后自动保存'}
            </p>
          </div>
        )}
      </div>
      <SettingsRow label="语速" description={`${(1 + rate / 100).toFixed(1)}×`}>
        <Slider
          className="w-56"
          min={-50}
          max={100}
          step={10}
          value={[rate]}
          onValueChange={([v]) => setRate(v)}
          onValueCommit={([v]) => onSpeechRateCommit(v)}
          aria-label="语速"
        />
      </SettingsRow>
      <SettingsRow label="音调" description={prefs.pitch === 0 ? '音色本来的音调' : prefs.pitch > 0 ? `升高 ${prefs.pitch}` : `降低 ${-prefs.pitch}`}>
        <Slider
          className="w-56"
          min={-12}
          max={12}
          step={1}
          value={[prefs.pitch]}
          onValueChange={([v]) => setPrefs({ ...prefs, pitch: v })}
          onValueCommit={([v]) => void save({ ...prefs, pitch: v })}
          aria-label="音调"
        />
      </SettingsRow>
      <SettingsRow label="音量" description={`${100 + prefs.loudness}%`}>
        <Slider
          className="w-56"
          min={-50}
          max={100}
          step={10}
          value={[prefs.loudness]}
          onValueChange={([v]) => setPrefs({ ...prefs, loudness: v })}
          onValueCommit={([v]) => void save({ ...prefs, loudness: v })}
          aria-label="音量"
        />
      </SettingsRow>
    </SettingsSection>
  );
};
