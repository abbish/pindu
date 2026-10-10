import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CircleCheck, FileText, FileUp, Info, Loader2, MapPin, RotateCw, Sparkles } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Stepper } from '@/components/Stepper/Stepper';
import { MaterialInput } from '@/components/MaterialInput';
import { WordGrid, type ExtractedWord } from '@/components/WordGrid';
import { useMaterialSettings } from '@/hooks/useMaterialSettings';
import { useToast } from '@/components/Toast/ToastContainer';
import { jobErrorText } from '@/components/Jobs';
import { jobsNow, useJob } from '@/hooks/useJobs';
import { activeJobFor } from '@/components/Jobs';
import { jobService } from '@/services/jobService';
import { wordAnalysisService } from '@/services/wordAnalysisService';
import { wordBookService } from '@/services/wordbookService';
import { cn } from '@/lib/utils';
import { SuggestionChips, mergeSuggestions } from '@/components/SuggestionChips';
import { standardizePartOfSpeech } from '@/utils/partOfSpeech';
import type { WordExtractionMode } from '@/types';
import type { WordAnalysisOutcome, WordExtractionResult } from '@/types/word-analysis';
import { BatchAnalysisPanel } from './BatchAnalysisPanel';
import { AiWorking } from '@/components/AiWorking';
import { InlineError } from '@/components/InlineError';

/** 单词从哪来：AI 按描述生成 / 从文本或文件提取 */
export type AddWordsSource = 'ai' | 'text';

/**
 * 阶段：source 填来源 → fetching 生成或提取中 → select 选词 → analyzing 分析并加入词汇本（后台任务）→
 * review 有没完成的词（失败 / 已停止）时显示结果，可以重新分析这些词。全部成功时直接关闭。
 */
type Phase = 'source' | 'fetching' | 'select' | 'analyzing' | 'review';
const STEPS = ['获取单词', '选择单词', '分析并保存'];
const STEP_OF: Record<Phase, number> = { source: 0, fetching: 0, select: 1, analyzing: 2, review: 2 };

const COUNT_OPTIONS = [10, 20, 30, 50];
const INTENT_MAX = 500;
/** 词汇本描述上限（与后端 validate_description 一致） */
const SCENE_MAX = 500;
const MAX_TEXT = 5000;
/** AI 按场景给的词汇需求建议：本次打开应用期间按「词汇本 + 场景」保留，重开弹窗不再等 */
const topicStore = new Map<string, string[]>();

export interface AddWordsDialogProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭 */
  onClose: () => void;
  /** 目标词汇本（用于避开 / 标记已有单词） */
  bookId: number;
  /** 词汇本名称（显示在标题里） */
  bookTitle?: string;
  /** 词汇本描述 = 词汇本场景：生成、提取、拼读分析、例句、讲解都会参考它来选词义和场景 */
  bookDescription?: string;
  /** 在弹窗里修改了词汇本场景（描述）后通知页面刷新 */
  onSceneSaved?: (description: string) => void;
  /** 打开时选中的来源 */
  initialSource?: AddWordsSource;
}

const toCandidates = (result: WordExtractionResult, existing: Set<string>): ExtractedWord[] =>
  result.words.map((w, i) => {
    const isExisting = existing.has(w.word.toLowerCase());
    return {
      id: `c${i}`,
      word: w.word,
      meaning: w.meaning || '',
      partOfSpeech: standardizePartOfSpeech(w.partOfSpeech || 'n.') as ExtractedWord['partOfSpeech'],
      frequency: w.frequency,
      // 已在词汇本中的词默认不选：避免用新分析覆盖手动改过的内容
      selected: !isExisting,
      existing: isExisting,
    };
  });

/** “无法 + 动作：原因” */
/** 「无法…：原因」；原因可以是服务层的 result.error 或异常 */
const errorText = (err: unknown, title: string) => {
  const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  return `${title}：${reason || '请再试一次'}`;
};

/**
 * 添加单词（词汇本详情页唯一入口）：
 * 1 获取单词 —— AI 按描述生成，或从我的材料（粘贴 / 文件）提取（模型按「设置 → AI 助手」）；
 * 2 选择单词 —— 已在词汇本中的词标“已存在”且默认不选；
 * 3 分析并保存 —— 后台任务：分批拼读分析，成功的词直接加入词汇本；关掉弹窗也会继续（进度在顶栏任务按钮里）。
 *   有失败或中途停止时显示没完成的词，可以重新分析。
 * 关闭时还有生成 / 选好但没开始分析的单词会先确认。
 */
export const AddWordsDialog: React.FC<AddWordsDialogProps> = ({
  isOpen,
  onClose,
  bookId,
  bookTitle,
  bookDescription = '',
  onSceneSaved,
  initialSource = 'ai',
}) => {
  const [phase, setPhase] = useState<Phase>('source');
  const [source, setSource] = useState<AddWordsSource>(initialSource);
  const [intent, setIntent] = useState('');
  const [count, setCount] = useState(20);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<WordExtractionMode>('focus');
  const [candidates, setCandidates] = useState<ExtractedWord[]>([]);
  /** 生成 / 提取时 AI 给的标签，分析保存时给词汇本加上 */
  const [aiTags, setAiTags] = useState<string[]>([]);
  /** 分析任务 id 与结果 */
  const [jobId, setJobId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<WordAnalysisOutcome | null>(null);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = useJob(jobId);
  const toast = useToast();
  const [confirmClose, setConfirmClose] = useState(false);
  /** 词汇本场景（描述）：弹窗内可编辑，保存后同步给页面 */
  const [scene, setScene] = useState(bookDescription.trim());
  const [sceneDraft, setSceneDraft] = useState<string | null>(null);
  const [sceneSaving, setSceneSaving] = useState(false);
  /** 场景为空时，把这次的描述同时设为词汇本场景 */
  const [useIntentAsScene, setUseIntentAsScene] = useState(true);
  /** 按场景给的词汇需求建议（null = 正在想）与选中的几条（可多选，和自己写的需求一起用） */
  const [topics, setTopics] = useState<string[] | null>(null);
  const [pickedTopics, setPickedTopics] = useState<string[]>([]);
  /** 建议没给出来的原因（显示出来，可以重试） */
  const [topicError, setTopicError] = useState<string | null>(null);
  const topicKey = `${bookId}:${scene}`;
  const loadTopics = async (refresh: boolean) => {
    const key = topicKey;
    const kept = topicStore.get(key);
    setTopicError(null);
    if (kept && !refresh) return setTopics(kept);
    // 换一批：已选的留下，告诉 AI 给过哪些，新的一批接在后面
    const shown = topics ?? [];
    setTopics(null);
    const r = await wordAnalysisService.suggestVocabTopics(bookId, refresh ? shown : []);
    if (key !== topicKeyRef.current) return;
    if (r.success) {
      const merged = mergeSuggestions(pickedTopics, r.data);
      topicStore.set(key, merged);
      setTopics(merged);
    } else {
      setTopics(shown);
      setTopicError(r.error);
    }
  };
  const topicKeyRef = useRef(topicKey);
  topicKeyRef.current = topicKey;
  useEffect(() => {
    if (!isOpen || source !== 'ai' || !scene) return;
    void loadTopics(false);
    // 换词汇本或改了场景时重新给建议
  }, [isOpen, source, topicKey]);
  // 生成数量与提取方式的默认值来自「设置 → 素材」
  const materialSettings = useMaterialSettings();
  useEffect(() => {
    if (!materialSettings) return;
    setCount(materialSettings.wordAiCount);
    setMode(materialSettings.wordExtractMode);
  }, [materialSettings]);

  /** 每次生成 / 提取 / 分析的序号：关闭或重来后，迟到的旧结果不再写回 */
  const runRef = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const reset = () => {
    runRef.current += 1;
    setPhase('source');
    setCandidates([]);
    setJobId(null);
    setOutcome(null);
    setStopped(false);
    setError(null);
  };

  // 每次打开从第一步开始，来源按入口；描述与文本保留，方便改一改再试；词汇本场景取打开时的描述
  useEffect(() => {
    if (!isOpen) return;
    reset();
    // 这本词汇本还有分析在跑（之前「在后台继续」了）：直接回到进度
    const running = activeJobFor(jobsNow(), ['word_analysis'], 'id', bookId);
    if (running) {
      setJobId(running.id);
      setPhase('analyzing');
    }
    setSource(initialSource);
    setPickedTopics([]);
    setScene(bookDescription.trim());
    setSceneDraft(null);
    setUseIntentAsScene(true);
    // 只在打开时读取描述：弹窗里保存场景后页面会更新描述，不能因此重置正在进行的步骤
  }, [isOpen, initialSource]);

  // 卸载时只丢弃迟到的生成 / 提取结果；分析是后台任务，关掉弹窗也继续
  useEffect(
    () => () => {
      runRef.current += 1;
    },
    []
  );

  // 分析任务结束：全部成功直接关闭；有没完成的词时显示结果
  useEffect(() => {
    if (!job || job.status === 'queued' || job.status === 'running' || phaseRef.current !== 'analyzing') return;
    const result = job.result as WordAnalysisOutcome | null;
    setJobId(null);
    if (job.status === 'failed' || !result) {
      setPhase('select');
      setError(job.status === 'failed' ? `无法完成拼读分析：${jobErrorText(job)}` : null);
      return;
    }
    const added = result.addedCount + result.updatedCount;
    if (added > 0) {
      toast.showSuccess(result.updatedCount > 0 ? `已添加 ${result.addedCount} 个单词，更新 ${result.updatedCount} 个` : `已添加 ${result.addedCount} 个单词`);
    }
    if (result.failed.length === 0) {
      reset();
      onClose();
      return;
    }
    setOutcome(result);
    setPhase('review');
  }, [job]);

  const hasUnsavedWork = phase === 'fetching' || (phase === 'select' && candidates.length > 0);

  const close = () => {
    reset();
    setConfirmClose(false);
    onClose();
  };
  const requestClose = () => {
    if (hasUnsavedWork) setConfirmClose(true);
    else close();
  };

  // ── 1 获取单词 ──
  const textLength = text.trim().length;
  /** 发给 AI 的词汇需求：选中的建议 + 自己写的 */
  const fullIntent = [...pickedTopics, intent.trim()].filter(Boolean).join('；');
  const intentLength = fullIntent.length;
  // 有场景描述时词汇需求可以不填（按场景生成）
  const canFetch = source === 'ai' ? (intentLength > 0 || Boolean(scene)) && intentLength <= INTENT_MAX : textLength > 0 && textLength <= MAX_TEXT;

  /** 保存词汇本场景（描述）；成功返回 true */
  const saveScene = async (value: string) => {
    setSceneSaving(true);
    const result = await wordBookService.updateWordBook(bookId, { description: value });
    setSceneSaving(false);
    if (!result.success) {
      setError(`无法保存场景描述：${result.error}`);
      return false;
    }
    setScene(value);
    setSceneDraft(null);
    onSceneSaved?.(value);
    return true;
  };

  const fetchWords = async () => {
    if (!canFetch) return;
    const run = ++runRef.current;
    setError(null);
    setPhase('fetching');
    try {
      // 场景为空且勾选了“同时设为词汇本场景”：先保存，后端生成时会读取它
      if (source === 'ai' && !scene && useIntentAsScene) {
        const saved = await saveScene(fullIntent.slice(0, SCENE_MAX));
        if (!saved || run !== runRef.current) {
          if (run === runRef.current) setPhase('source');
          return;
        }
      }
      const fetched =
        source === 'ai'
          ? await wordAnalysisService.generateWordsFromIntent(fullIntent, count, bookId)
          : await wordAnalysisService.extractWordsFromText(text, mode, bookId);
      if (run !== runRef.current) return;
      if (!fetched.success) {
        setPhase('source');
        setError(errorText(fetched.error, source === 'ai' ? '无法生成单词' : '无法提取单词'));
        return;
      }
      const result = fetched.data;
      const existingResult = await wordBookService.findExistingWords(
        bookId,
        result.words.map((w) => w.word)
      );
      if (run !== runRef.current) return;
      const existing = new Set(existingResult.success ? existingResult.data : []);
      const next = toCandidates(result, existing);
      if (next.length === 0) {
        setPhase('source');
        setError(source === 'ai' ? '未生成新单词，请调整描述后重试' : '未找到可学习的单词，请改用“全部单词”或更换文本');
        return;
      }
      setCandidates(next);
      setAiTags(result.tags ?? []);
      setPhase('select');
    } catch (err) {
      if (run !== runRef.current) return;
      setPhase('source');
      setError(errorText(err, source === 'ai' ? '无法生成单词' : '无法提取单词'));
    }
  };

  // ── 3 分析并保存（后台任务） ──
  /** 分析 `words`（首次或重新分析没完成的词），成功的词由后端直接加入词汇本 */
  const analyze = async (words: string[]) => {
    if (words.length === 0) return;
    setError(null);
    setStopped(false);
    setOutcome(null);
    // 生成 / 提取时定好的释义随单词传给拼读分析，保证释义和例句沿用同一个意思
    const meaningOf = new Map(candidates.map((c) => [c.word.toLowerCase(), c.meaning]));
    const started = await wordAnalysisService.startWordAnalysis({
      bookId,
      words,
      meanings: words.map((w) => meaningOf.get(w.toLowerCase()) ?? ''),
      tags: aiTags,
    });
    if (!started.success) {
      setError(errorText(started.error, '无法开始拼读分析'));
      return;
    }
    setJobId(started.data);
    setPhase('analyzing');
  };
  const selected = candidates.filter((c) => c.selected);
  const existingCount = candidates.filter((c) => c.existing).length;
  const busy = phase === 'fetching';

  /** 停止分析：进行中的批次跑完，已完成的词照样加入词汇本 */
  const stopAnalysis = async () => {
    if (!jobId) return;
    setStopped(true);
    const result = await jobService.cancel(jobId);
    if (!result.success) {
      setStopped(false);
      setError(errorText(result.error, '无法停止分析'));
    }
  };

  const segmentItem = 'h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm';

  /** 来源选择卡片（单选） */
  const sourceCard = (value: AddWordsSource, Icon: React.ComponentType<{ className?: string }>, title: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={source === value}
      disabled={busy}
      onClick={() => {
        setSource(value);
        setError(null);
      }}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60',
        source === value ? 'border-primary bg-accent/40 ring-1 ring-primary/30' : 'hover:bg-muted/50'
      )}
    >
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', source === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 text-sm font-medium">{title}</span>
    </button>
  );

  /** 词汇本场景：一行小卡片（描述摘要 + 编辑）；编辑时展开为文本框 */
  const sceneCard = () => {
    if (sceneDraft !== null) {
      const tooLong = sceneDraft.trim().length > SCENE_MAX;
      return (
        <div className="space-y-2 rounded-lg border p-3">
          <Label htmlFor="aw-scene">场景描述</Label>
          <Textarea
            id="aw-scene"
            value={sceneDraft}
            onChange={(e) => setSceneDraft(e.target.value)}
            placeholder="例如：出国旅行常用词"
            className="min-h-20 resize-none"
            aria-invalid={tooLong}
            autoFocus
          />
          <div className="flex items-center justify-between gap-2">
            <p className={cn('text-xs tabular-nums', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
              {sceneDraft.trim().length} / {SCENE_MAX}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSceneDraft(null)} disabled={sceneSaving}>
                取消
              </Button>
              <Button size="sm" onClick={() => saveScene(sceneDraft.trim())} disabled={sceneSaving || tooLong || sceneDraft.trim() === scene}>
                {sceneSaving && <Loader2 className="animate-spin" />}
                保存
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
        <MapPin className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <span className="shrink-0 font-medium">场景描述</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3.5 shrink-0 text-muted-foreground" aria-label="场景描述的作用" />
            </TooltipTrigger>
            <TooltipContent>AI 生成单词、释义、例句和讲解时参考此场景</TooltipContent>
          </Tooltip>
          <span className={cn('ml-1 truncate text-xs', scene ? 'text-foreground' : 'text-muted-foreground')} title={scene || undefined}>
            {scene || '未设置'}
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 shrink-0" disabled={busy} onClick={() => setSceneDraft(scene)}>
          {scene ? '编辑' : '设置'}
        </Button>
      </div>
    );
  };

  const body = () => {
    if (phase === 'fetching') {
      return <AiWorking title={source === 'ai' ? 'AI 正在生成单词' : 'AI 正在提取单词'} />;
    }

    switch (phase) {
      case 'source':
        return (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="单词来源">
              {sourceCard('ai', Sparkles, 'AI 生成')}
              {sourceCard('text', FileUp, '从文本提取')}
            </div>
            {sceneCard()}

            {source === 'ai' ? (
              <div className="flex flex-col gap-5">
                <div className="space-y-2">
                  <Label htmlFor="aw-intent">
                    词汇需求{scene && <span className="font-normal text-muted-foreground">（可不填）</span>}
                  </Label>
                  <div className="relative">
                    <Textarea
                      id="aw-intent"
                      value={intent}
                      onChange={(e) => setIntent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canFetch) fetchWords();
                      }}
                      placeholder={scene ? '不填就按场景描述生成；想要更具体的，选下面的建议（可多选）或自己写' : '例如：TED 环境主题演讲，听众是大学生'}
                      maxLength={INTENT_MAX}
                      className="min-h-36 resize-none pb-7"
                      autoFocus
                    />
                    <span className="pointer-events-none absolute right-3 bottom-2 text-xs text-muted-foreground tabular-nums">
                      {intentLength} / {INTENT_MAX}
                    </span>
                  </div>
                  {!scene && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={useIntentAsScene} onCheckedChange={(v) => setUseIntentAsScene(v === true)} />
                      <span>同时设为场景描述</span>
                    </label>
                  )}
                  {scene && (
                    <div aria-label="按场景的建议">
                      <SuggestionChips
                        items={topics}
                        selected={pickedTopics}
                        onToggle={(t) => setPickedTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
                        onMore={() => void loadTopics(true)}
                        error={topicError}
                        loadingText="AI 正在按场景想建议…"
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-4">
                  <Label>单词数量</Label>
                  <ToggleGroup type="single" value={String(count)} onValueChange={(v) => v && setCount(Number(v))} className="rounded-lg bg-muted p-0.5" aria-label="单词数量">
                    {COUNT_OPTIONS.map((n) => (
                      <ToggleGroupItem key={n} value={String(n)} className={segmentItem}>
                        约 {n} 个
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <MaterialInput
                  label="英文材料"
                  text={text}
                  onTextChange={setText}
                  sourceLabel={fileName}
                  onSourceLabelChange={setFileName}
                  placeholder="粘贴课文、文章或单词表…"
                  maxChars={MAX_TEXT}
                  privacyNote
                  autoFocus
                />
                <div className="flex items-center justify-between gap-4">
                  <Label>提取范围</Label>
                  <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as WordExtractionMode)} className="rounded-lg bg-muted p-0.5" aria-label="提取范围">
                    <ToggleGroupItem value="focus" className={segmentItem}>
                      重点词
                    </ToggleGroupItem>
                    <ToggleGroupItem value="all" className={segmentItem}>
                      全部单词
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>
            )}
          </div>
        );

      case 'select':
        return (
          <div className="flex flex-col gap-3">
            {existingCount > 0 && (
              <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{existingCount} 个词已在词汇本里，勾选会覆盖原有内容</span>
              </p>
            )}
            <WordGrid
              words={candidates}
              showFrequency={source === 'text'}
              onWordToggle={(id) => setCandidates((prev) => prev.map((w) => (w.id === id ? { ...w, selected: !w.selected } : w)))}
              onSelectAll={(all) => setCandidates((prev) => prev.map((w) => ({ ...w, selected: all })))}
              onSelectByPartOfSpeech={(pos, on) => setCandidates((prev) => prev.map((w) => (w.partOfSpeech === pos ? { ...w, selected: on } : w)))}
            />
          </div>
        );

      case 'analyzing':
        return <BatchAnalysisPanel job={job} />;

      case 'review': {
        const failed = outcome?.failed ?? [];
        const added = (outcome?.addedCount ?? 0) + (outcome?.updatedCount ?? 0);
        return (
          <div className="flex flex-col gap-3">
            <div className={cn('flex items-start gap-3 rounded-lg border p-3', failed.length > 0 ? 'border-warning/40 bg-warning-soft/50' : 'bg-muted/40')}>
              {failed.length > 0 ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" /> : <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" />}
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  {added > 0 ? `已加入词汇本 ${added} 个` : '没有单词加入词汇本'}，{failed.length} 个没有完成
                </div>
              </div>
            </div>
            <ul className="divide-y rounded-lg border text-sm">
              {failed.map((w) => (
                <li key={w.word} className="flex items-baseline gap-3 px-3 py-2">
                  <span className="font-medium">{w.word}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground" title={w.error ?? undefined}>
                    {w.error}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      }
    }
  };

  const footer = () => {
    switch (phase) {
      case 'source':
      case 'fetching':
        return (
          <>
            {busy ? (
              <Button
                variant="outline"
                onClick={() => {
                  runRef.current += 1;
                  setPhase('source');
                }}
              >
                停止
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={requestClose}>
                  取消
                </Button>
                <Button onClick={fetchWords} disabled={!canFetch}>
                  {source === 'ai' ? <Sparkles /> : <FileText />}
                  {source === 'ai' ? '生成单词' : '提取单词'}
                </Button>
              </>
            )}
          </>
        );
      case 'select':
        return (
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setPhase('source')}>
              <ArrowLeft />
              上一步
            </Button>
            <Button variant="outline" onClick={requestClose}>
              取消
            </Button>
            <Button onClick={() => analyze(selected.map((c) => c.word))} disabled={selected.length === 0}>
              分析并保存 {selected.length} 个单词
            </Button>
          </>
        );
      case 'analyzing':
        return (
          <>
            <Button variant="outline" className="mr-auto" onClick={stopAnalysis} disabled={stopped}>
              停止
            </Button>
            <Button onClick={close}>在后台继续</Button>
          </>
        );
      case 'review': {
        const failed = outcome?.failed ?? [];
        return (
          <>
            {failed.length > 0 && (
              <Button variant="ghost" className="mr-auto" onClick={() => analyze(failed.map((w) => w.word))}>
                <RotateCw />
                重新分析 {failed.length} 个
              </Button>
            )}
            <Button onClick={close}>完成</Button>
          </>
        );
      }
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && requestClose()}>
        <DialogContent
          className="flex h-[min(680px,88vh)] flex-col gap-0 p-0 sm:max-w-3xl"
          {...(bookTitle ? {} : { 'aria-describedby': undefined })}
          onInteractOutside={(e) => hasUnsavedWork && e.preventDefault()}
        >
          <DialogHeader className="gap-4 border-b px-6 pt-5 pb-4">
            <div>
              <DialogTitle>添加单词</DialogTitle>
              {bookTitle && <DialogDescription className="mt-1">添加到「{bookTitle}」</DialogDescription>}
            </div>
            <Stepper steps={STEPS} current={STEP_OF[phase]} />
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {body()}
            {error && (
              <InlineError className="mt-4">{error}</InlineError>
            )}
          </div>

          <DialogFooter className="items-center gap-2 border-t bg-muted/30 px-6 py-3">{footer()}</DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃这次添加？</AlertDialogTitle>
            <AlertDialogDescription>
              已经生成或选好的单词不会保存。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续添加</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={close}>
              放弃
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
