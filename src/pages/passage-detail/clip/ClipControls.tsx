import React from 'react';
import { Download, Settings2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { TranslationMode } from '@/components/PassageReader';
import type { PassageSentence } from '@/types/passage';
import type { BlankLevel } from '@/utils/dictation';

export type Subtitles = 'both' | 'en' | 'zh' | 'none';

/** 句子在短片里的时间（没有时间的句子按 0） */
export const startOf = (s: PassageSentence | undefined) => s?.startMs ?? 0;
export const endOf = (s: PassageSentence | undefined) => s?.endMs ?? startOf(s);

/** 练习条件（记在本机，下次打开沿用） */
export interface ClipPrefs {
  /** 画面上的字幕 */
  subtitles: Subtitles;
  /** 遮住画面只听声音：盲听、精听默认遮住（画面里常印着台词） */
  cover: Record<CoverMode, boolean>;
  /** 精听挖空多少 */
  blankLevel: BlankLevel;
  /** 逐句跟读：读完自动下一句 */
  autoNext: boolean;
  /** 跟读：原声读到的词加底色放大 */
  wordFocus: boolean;
  /** 影子跟读：正在读的句子正常显示，同一段的其他句子变淡 */
  sentenceFocus: boolean;
  /** 跟读卡片上的译文：显示（all）/ 不显示（off） */
  translation: TranslationMode;
  /** 理解：每句播完自动暂停（播放器控制条上的开关） */
  pauseEach: boolean;
  /** 逐句跟读：每句原声播几遍再跟读 */
  shadowRepeat: number;
  /** 跟读的练法：逐句（听一句说一句，逐音评分）/ 影子跟读（和原声同时说，整段录） */
  speakMode: SpeakMode;
}

export type SpeakMode = 'repeat' | 'shadow';
export type CoverMode = 'blind' | 'dictate';

export const PREFS_KEY = 'passage.clipStudy.v1';
const DEFAULT_PREFS: ClipPrefs = { subtitles: 'both', cover: { blind: true, dictate: true }, blankLevel: 'few', autoNext: false, wordFocus: true, sentenceFocus: true, translation: 'all', pauseEach: false, shadowRepeat: 1, speakMode: 'repeat' };

export function loadPrefs(): ClipPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ClipPrefs>) };
    if (saved.speakMode !== 'repeat' && saved.speakMode !== 'shadow') saved.speakMode = 'repeat';
    saved.cover = { ...DEFAULT_PREFS.cover, ...saved.cover };
    return saved;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** 跟读的练习设置（在卡片控制条上）：逐词高亮；逐句跟读另有原声遍数、读完自动下一句，影子跟读另有聚焦当前句 */
export const PrefsPopover: React.FC<{ prefs: ClipPrefs; onChange: (patch: Partial<ClipPrefs>) => void }> = ({ prefs, onChange }) => (
  <Popover>
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="练习设置">
            <Settings2 />
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>练习设置</TooltipContent>
    </Tooltip>
    <PopoverContent align="end" className="w-72 space-y-4">
      {prefs.speakMode === 'repeat' && (
        <Row label="每句原声播放">
          <Select value={String(prefs.shadowRepeat)} onValueChange={(v) => onChange({ shadowRepeat: Number(v) })}>
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} 遍
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      )}
      {prefs.speakMode === 'repeat' && (
        <Row label="读完自动下一句" htmlFor="cs-auto-next">
          <Switch id="cs-auto-next" checked={prefs.autoNext} onCheckedChange={(autoNext) => onChange({ autoNext })} />
        </Row>
      )}
      {prefs.speakMode === 'shadow' && (
        <Row label="聚焦当前句" htmlFor="cs-sentence-focus">
          <Switch id="cs-sentence-focus" checked={prefs.sentenceFocus} onCheckedChange={(sentenceFocus) => onChange({ sentenceFocus })} />
        </Row>
      )}
      <Row label="逐词高亮" htmlFor="cs-word-focus">
        <Switch id="cs-word-focus" checked={prefs.wordFocus} onCheckedChange={(wordFocus) => onChange({ wordFocus })} />
      </Row>
    </PopoverContent>
  </Popover>
);

const Row: React.FC<{ label: string; htmlFor?: string; children: React.ReactNode }> = ({ label, htmlFor, children }) => (
  <div className="flex items-center justify-between gap-3">
    <Label htmlFor={htmlFor} className="font-normal">
      {label}
    </Label>
    {children}
  </div>
);

/** 跟读要先下载评估模型（没下载时也能跟读、听自己的录音，只是没有评分） */
export const ModelNotice: React.FC<{ downloading: boolean; onDownload: () => void }> = ({ downloading, onDownload }) => (
  <div className="mb-3 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
    <span className="min-w-0 flex-1">{downloading ? '正在下载评估模型…' : '跟读评分要先下载评估模型'}</span>
    {!downloading && (
      <Button variant="outline" size="sm" className="h-7" onClick={onDownload}>
        <Download />
        下载
      </Button>
    )}
  </div>
);
