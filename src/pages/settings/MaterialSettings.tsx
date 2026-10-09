import React, { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { PageError } from '@/components/PageError';
import { useToast } from '@/components/Toast/ToastContainer';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { PASSAGE_INTERVAL_OPTIONS, intervalLabel } from '@/components/PlanPassagePicker';
import { setCachedMaterialSettings } from '@/hooks/useMaterialSettings';
import { tagService } from '@/services/tagService';
import { videoService } from '@/services/videoService';
import { DAILY_NEW_WORDS_OPTIONS } from '@/utils/planParams';
import { PICK_DIFFICULTY_OPTIONS, PICK_FREQUENCY_OPTIONS } from '@/utils/passage';
import type { MaterialSettings as Settings } from '@/types/material';
import type { MediaToolsStatus } from '@/types/video';

type Option<T extends string | number> = { value: T; label: string };

const WORD_COUNTS: Option<number>[] = [10, 20, 30, 50].map((n) => ({ value: n, label: `${n} 个` }));
const EXTRACT_MODES: Option<Settings['wordExtractMode']>[] = [
  { value: 'focus', label: '重点词' },
  { value: 'all', label: '全部单词' },
];
const LENGTHS: Option<Settings['passageLength']>[] = [
  { value: 'short', label: '短' },
  { value: 'standard', label: '标准' },
  { value: 'long', label: '长' },
];
const PICK_COUNTS: Option<number>[] = [5, 8, 10, 15, 20].map((n) => ({ value: n, label: `${n} 个` }));
const PICK_DIFFICULTIES = PICK_DIFFICULTY_OPTIONS as Option<Settings['passagePickDifficulty']>[];
const PICK_FREQUENCIES = PICK_FREQUENCY_OPTIONS as Option<Settings['passagePickFrequency']>[];
const IMPORT_LENGTHS: Option<number>[] = [
  { value: 150, label: '短（约 150 词）' },
  { value: 300, label: '标准（约 300 词）' },
  { value: 450, label: '长（约 450 词）' },
];
const QUESTION_DIFFICULTIES: Option<Settings['questionDifficulty']>[] = [
  { value: 'auto', label: '按短文水平' },
  { value: 'basic', label: '基础' },
  { value: 'standard', label: '标准' },
  { value: 'advanced', label: '提高' },
];
const INTERVALS: Option<number>[] = PASSAGE_INTERVAL_OPTIONS.map((d) => ({ value: d, label: intervalLabel(d) }));

/** 下拉选择一行 */
function Choice<T extends string | number>({ value, options, onChange, label, width = 'w-36' }: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; width?: string }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange((typeof value === 'number' ? Number(v) : v) as T)}>
      <SelectTrigger className={width} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * 设置「素材」：单词本、短文、视频、学习计划里各种处理参数的默认值（各页面打开时以它为默认，当次仍可修改）；
 * 视频组件（ffmpeg，自带的不可用时才显示）。改了立即保存。
 */
export const MaterialSettings: React.FC = () => {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaToolsStatus | null>(null);
  /** 每段时长的输入（离开输入框再保存） */
  const [seconds, setSeconds] = useState({ min: '', max: '' });

  const load = async () => {
    const r = await tagService.getMaterialSettings();
    if (r.success) {
      setSettings(r.data);
      setSeconds({ min: String(r.data.videoMinSeconds), max: String(r.data.videoMaxSeconds) });
      setError(null);
    } else setError(r.error);
  };

  useEffect(() => {
    void load();
    videoService.getMediaToolsStatus().then((r) => r.success && setMedia(r.data));
  }, []);

  const update = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    const r = await tagService.saveMaterialSettings(next);
    if (r.success) {
      setSettings(r.data);
      setCachedMaterialSettings(r.data);
      setSeconds({ min: String(r.data.videoMinSeconds), max: String(r.data.videoMaxSeconds) });
    } else {
      toast.showError('无法保存设置', r.error);
      void load();
    }
  };

  const pickMediaDir = async () => {
    const dir = await openFileDialog({ directory: true, multiple: false, title: '选择 ffmpeg 和 ffprobe 所在的文件夹' });
    if (typeof dir !== 'string') return;
    const result = await videoService.setFfmpegDir(dir);
    if (result.success) setMedia(result.data);
    else toast.showError('无法使用这个文件夹', result.error);
  };
  const resetMediaDir = async () => {
    const result = await videoService.setFfmpegDir(null);
    if (result.success) setMedia(result.data);
    else toast.showError('无法改用自带的视频组件', result.error);
  };

  if (error) {
    return (
      <SettingsPanel title="素材默认值">
        <PageError title="无法读取设置" message={error} onRetry={load} />
      </SettingsPanel>
    );
  }
  if (!settings) return <SettingsPanel title="素材默认值">{null}</SettingsPanel>;
  const s = settings;

  return (
    <SettingsPanel title="素材默认值">
      <SettingsSection title="单词本">
        <SettingsRow label="AI 生成单词">
          <Choice label="AI 生成单词的数量" value={s.wordAiCount} options={WORD_COUNTS} onChange={(wordAiCount) => update({ wordAiCount })} />
        </SettingsRow>
        <SettingsRow label="从材料提取">
          <Choice label="从材料提取单词" value={s.wordExtractMode} options={EXTRACT_MODES} onChange={(wordExtractMode) => update({ wordExtractMode })} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="短文">
        <SettingsRow label="篇幅">
          <Choice label="AI 写短文的篇幅" value={s.passageLength} options={LENGTHS} onChange={(passageLength) => update({ passageLength })} />
        </SettingsRow>
        <SettingsRow label="AI 选词数量">
          <Choice label="AI 选词数量" value={s.passagePickCount} options={PICK_COUNTS} onChange={(passagePickCount) => update({ passagePickCount })} />
        </SettingsRow>
        <SettingsRow label="选词难度">
          <Choice label="选词难度" value={s.passagePickDifficulty} options={PICK_DIFFICULTIES} onChange={(passagePickDifficulty) => update({ passagePickDifficulty })} />
        </SettingsRow>
        <SettingsRow label="选词词频">
          <Choice label="选词词频" value={s.passagePickFrequency} options={PICK_FREQUENCIES} onChange={(passagePickFrequency) => update({ passagePickFrequency })} />
        </SettingsRow>
        <SettingsRow label="导入分篇长度">
          <Choice label="导入分篇长度" value={s.importTargetWords} options={IMPORT_LENGTHS} width="w-44" onChange={(importTargetWords) => update({ importTargetWords })} />
        </SettingsRow>
        <SettingsRow label="导入时 AI 识别重点词" htmlFor="ms-keywords">
          <Switch id="ms-keywords" checked={s.importKeyWords} onCheckedChange={(importKeyWords) => update({ importKeyWords })} />
        </SettingsRow>
        <SettingsRow label="阅读理解题难度">
          <Choice label="阅读理解题难度" value={s.questionDifficulty} options={QUESTION_DIFFICULTIES} onChange={(questionDifficulty) => update({ questionDifficulty })} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="视频">
        <SettingsRow label="导入时整理字幕" htmlFor="ms-prepare">
          <Switch id="ms-prepare" checked={s.videoAutoPrepare} onCheckedChange={(videoAutoPrepare) => update({ videoAutoPrepare })} />
        </SettingsRow>
        <SettingsRow label="每段时长（秒）">
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              className="w-20"
              aria-label="每段至少（秒）"
              min={5}
              max={900}
              value={seconds.min}
              onChange={(e) => setSeconds((v) => ({ ...v, min: e.target.value }))}
              onBlur={() => Number(seconds.min) !== s.videoMinSeconds && update({ videoMinSeconds: Number(seconds.min) || s.videoMinSeconds })}
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="number"
              className="w-20"
              aria-label="每段最多（秒）"
              min={5}
              max={900}
              value={seconds.max}
              onChange={(e) => setSeconds((v) => ({ ...v, max: e.target.value }))}
              onBlur={() => Number(seconds.max) !== s.videoMaxSeconds && update({ videoMaxSeconds: Number(seconds.max) || s.videoMaxSeconds })}
            />
          </div>
        </SettingsRow>
        {/* 自带的能用时不显示；不可用或改用了别的 ffmpeg 时才需要 */}
        {media && !(media.available && media.builtIn) && (
          <SettingsRow label="视频组件" description={media.available ? (media.dir ?? undefined) : '没有找到'}>
            <div className="flex gap-2">
              {media.available && (
                <Button variant="ghost" size="sm" onClick={resetMediaDir}>
                  使用内置组件
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={pickMediaDir}>
                <FolderOpen />
                选择文件夹
              </Button>
            </div>
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title="学习计划">
        <SettingsRow label="每天新词数">
          <Choice label="每天新词数" value={s.planDailyNewWords} options={DAILY_NEW_WORDS_OPTIONS} onChange={(planDailyNewWords) => update({ planDailyNewWords })} />
        </SettingsRow>
        <SettingsRow label="短文间隔">
          <Choice label="短文间隔" value={s.planPassageIntervalDays} options={INTERVALS} onChange={(planPassageIntervalDays) => update({ planPassageIntervalDays })} />
        </SettingsRow>
        <SettingsRow label="AI 排学习顺序" htmlFor="ms-ai-order">
          <Switch id="ms-ai-order" checked={s.planAiOrder} onCheckedChange={(planAiOrder) => update({ planAiOrder })} />
        </SettingsRow>
      </SettingsSection>
    </SettingsPanel>
  );
};
