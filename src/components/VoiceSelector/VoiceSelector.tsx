import React from 'react';
import { Globe, Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TTSVoice {
  id: number;
  providerId: number;
  voiceId: string;
  voiceName: string;
  displayName: string;
  language: string;
  gender?: string;
  description?: string;
  modelId: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceSelectorProps {
  /** 语音列表 */
  voices: TTSVoice[];
  /** 当前选中的语音ID */
  selectedVoiceId?: string;
  /** 语音选择回调 */
  onVoiceSelect: (voiceId: string) => void;
  /** 试听语音回调 */
  onVoiceTest: (voiceId: string) => void;
  /** 是否正在试听 */
  testingVoiceId?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 标题 */
  title?: string;
  /** 描述 */
  description?: string;
}

/**
 * 语音选择器组件 - 卡片式选择器，类似单词本选择器
 */
export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voices,
  selectedVoiceId,
  onVoiceSelect,
  onVoiceTest,
  testingVoiceId,
  disabled = false,
  title = "选择默认语音",
  description = "选择一个语音作为默认的文本转语音引擎"
}) => {
  const handleVoiceSelect = (voiceId: string) => {
    if (!disabled) {
      onVoiceSelect(voiceId);
    }
  };

  const handleVoiceTest = (e: React.MouseEvent, voiceId: string) => {
    e.stopPropagation(); // 防止触发选择事件
    if (!disabled) {
      onVoiceTest(voiceId);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={title}>
        {voices.map((voice) => {
          const isSelected = selectedVoiceId === voice.voiceId;
          const isTesting = testingVoiceId === voice.voiceId;
          return (
            <div
              key={voice.voiceId}
              role="radio"
              aria-checked={isSelected}
              tabIndex={disabled ? -1 : 0}
              onClick={() => handleVoiceSelect(voice.voiceId)}
              onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && handleVoiceSelect(voice.voiceId)}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                isSelected && 'border-primary bg-accent/40',
                disabled && 'pointer-events-none opacity-60'
              )}
            >
              <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', isSelected && 'border-primary')}>
                {isSelected && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{voice.displayName}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0"
                    onClick={(e) => handleVoiceTest(e, voice.voiceId)}
                    disabled={disabled || isTesting}
                    title="试听语音"
                  >
                    {isTesting ? <Loader2 className="animate-spin" /> : <Play />}
                    {isTesting ? '试听中' : '试听'}
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Globe className="size-3" />
                    {voice.language === 'en' ? '英语' : voice.language}
                  </span>
                  {voice.gender && <span>{voice.gender === 'female' ? '女声' : '男声'}</span>}
                </div>
                {voice.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{voice.description}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
