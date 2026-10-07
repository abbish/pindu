import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CircleCheck, FileText, FileUp, Loader2, MapPin, RotateCw, Sparkles } from 'lucide-react';
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
import { Stepper } from '@/components/Stepper/Stepper';
import { MaterialInput } from '@/components/MaterialInput';
import { WordGrid, type ExtractedWord } from '@/components/WordGrid';
import { wordAnalysisService } from '@/services/wordAnalysisService';
import { wordBookService } from '@/services/wordbookService';
import { cn } from '@/lib/utils';
import { standardizePartOfSpeech } from '@/utils/partOfSpeech';
import type { WordExtractionMode } from '@/types';
import type { PhonicsWord } from '@/types/ai-model';
import type { BatchAnalysisProgress, WordExtractionResult } from '@/types/word-analysis';
import { BatchAnalysisPanel } from './BatchAnalysisPanel';
import { InlineError } from '@/components/InlineError';

/** 单词从哪来：AI 按描述生成 / 从文本或文件提取 */
export type AddWordsSource = 'ai' | 'text';

/**
 * 阶段：source 填来源 → fetching 生成或提取中 → select 选词 → analyzing 拼读分析 → review 有失败 / 已停止时检查后保存。
 * 全部成功时分析完直接保存，不再多一步“选择”。
 */
type Phase = 'source' | 'fetching' | 'select' | 'analyzing' | 'review';
const STEPS = ['获取单词', '选择单词', '分析并保存'];
const STEP_OF: Record<Phase, number> = { source: 0, fetching: 0, select: 1, analyzing: 2, review: 2 };

const COUNT_OPTIONS = [10, 20, 30, 50];
const INTENT_MAX = 500;
/** 单词本描述上限（与后端 validate_description 一致） */
const SCENE_MAX = 500;
const MAX_TEXT = 5000;
const LONG_TEXT = 3000;
const INTENT_EXAMPLES = ['准备一场 TED 环境主题演讲', '三年级动物主题单元', '去英国旅行时机场和酒店会用到的词', '雅思写作常用的教育类词汇'];

export interface AddWordsDialogProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭 */
  onClose: () => void;
  /** 目标单词本（用于避开 / 标记已有单词） */
  bookId: number;
  /** 单词本名称（显示在标题里） */
  bookTitle?: string;
  /** 单词本描述 = 单词本场景：生成、提取、拼读分析、例句、讲解都会参考它来选词义和场景 */
  bookDescription?: string;
  /** 在弹窗里修改了单词本场景（描述）后通知页面刷新 */
  onSceneSaved?: (description: string) => void;
  /** 打开时选中的来源 */
  initialSource?: AddWordsSource;
  /** 保存分析好的单词；失败时抛错（弹窗保留结果，可直接重试保存） */
  onSaveWords: (words: ExtractedWord[]) => Promise<void>;
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
      // 已在单词本中的词默认不选：避免用新分析覆盖手动改过的内容
      selected: !isExisting,
      existing: isExisting,
    };
  });

const toAnalyzed = (word: PhonicsWord, existing: boolean): ExtractedWord => ({
  id: `a-${word.word.toLowerCase()}`,
  word: word.word,
  meaning: word.chinese_translation,
  partOfSpeech: standardizePartOfSpeech(word.pos_abbreviation) as ExtractedWord['partOfSpeech'],
  frequency: word.frequency || 1,
  selected: true,
  existing,
  phonics: {
    ipa: word.ipa,
    syllables: word.syllables,
    phonics_rule: word.phonics_rule,
    analysis_explanation: word.analysis_explanation,
    pos_abbreviation: word.pos_abbreviation,
    pos_english: word.pos_english,
    pos_chinese: word.pos_chinese,
    frequency: word.frequency,
    examples: word.examples ?? [],
  },
});

/** “无法 + 动作：原因” */
/** 「无法…：原因」；原因可以是服务层的 result.error 或异常 */
const errorText = (err: unknown, title: string) => {
  const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  return `${title}：${reason || '请再试一次'}`;
};

/**
 * 添加单词（单词本详情页唯一入口）：
 * 1 获取单词 —— AI 按描述生成，或从我的材料（粘贴 / 文件）提取（模型按「设置 → AI 助手」）；
 * 2 选择单词 —— 已在单词本中的词标“已存在”且默认不选；
 * 3 分析并保存 —— 批量拼读分析，全部成功自动保存；有失败或中途停止时保留已完成的结果，可重试失败的词再保存。
 * 保存成功前结果一直保留；关闭时有未保存的结果会先确认。
 */
export const AddWordsDialog: React.FC<AddWordsDialogProps> = ({
  isOpen,
  onClose,
  bookId,
  bookTitle,
  bookDescription = '',
  onSceneSaved,
  initialSource = 'ai',
  onSaveWords,
}) => {
  const [phase, setPhase] = useState<Phase>('source');
  const [source, setSource] = useState<AddWordsSource>(initialSource);
  const [intent, setIntent] = useState('');
  const [count, setCount] = useState(20);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<WordExtractionMode>('focus');
  const [candidates, setCandidates] = useState<ExtractedWord[]>([]);
  const [analyzed, setAnalyzed] = useState<ExtractedWord[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [stopped, setStopped] = useState(false);
  const [progress, setProgress] = useState<BatchAnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  /** 单词本场景（描述）：弹窗内可编辑，保存后同步给页面 */
  const [scene, setScene] = useState(bookDescription.trim());
  const [sceneDraft, setSceneDraft] = useState<string | null>(null);
  const [sceneSaving, setSceneSaving] = useState(false);
  /** 场景为空时，把这次的描述同时设为单词本场景 */
  const [useIntentAsScene, setUseIntentAsScene] = useState(true);

  /** 每次生成 / 提取 / 分析的序号：关闭或重来后，迟到的旧结果不再写回 */
  const runRef = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** 分析回调里读取最新的“已停止”状态 */
  const stoppedRef = useRef(stopped);
  stoppedRef.current = stopped;

  const reset = () => {
    runRef.current += 1;
    setPhase('source');
    setCandidates([]);
    setAnalyzed([]);
    setFailed([]);
    setStopped(false);
    setProgress(null);
    setError(null);
    setSaving(false);
  };

  // 每次打开从第一步开始，来源按入口；描述与文本保留，方便改一改再试；单词本场景取打开时的描述
  useEffect(() => {
    if (!isOpen) return;
    reset();
    setSource(initialSource);
    setScene(bookDescription.trim());
    setSceneDraft(null);
    setUseIntentAsScene(true);
    // 只在打开时读取描述：弹窗里保存场景后页面会更新描述，不能因此重置正在进行的步骤
  }, [isOpen, initialSource]);

  // 卸载时若仍在分析则通知后端停止
  useEffect(
    () => () => {
      runRef.current += 1;
      if (phaseRef.current === 'analyzing') wordAnalysisService.cancelBatchAnalysis();
    },
    []
  );

  const hasUnsavedWork = phase === 'fetching' || phase === 'analyzing' || phase === 'review' || (phase === 'select' && candidates.length > 0);

  const close = () => {
    if (phaseRef.current === 'analyzing') wordAnalysisService.cancelBatchAnalysis();
    reset();
    setConfirmClose(false);
    onClose();
  };
  const requestClose = () => {
    if (saving) return;
    if (hasUnsavedWork) setConfirmClose(true);
    else close();
  };

  // ── 1 获取单词 ──
  const textLength = text.trim().length;
  const intentLength = intent.trim().length;
  const canFetch = source === 'ai' ? intentLength > 0 && intentLength <= INTENT_MAX : textLength > 0 && textLength <= MAX_TEXT;

  /** 保存单词本场景（描述）；成功返回 true */
  const saveScene = async (value: string) => {
    setSceneSaving(true);
    const result = await wordBookService.updateWordBook(bookId, { description: value });
    setSceneSaving(false);
    if (!result.success) {
      setError(`无法保存单词本场景：${result.error}`);
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
      // 场景为空且勾选了“同时设为单词本场景”：先保存，后端生成时会读取它
      if (source === 'ai' && !scene && useIntentAsScene) {
        const saved = await saveScene(intent.trim().slice(0, SCENE_MAX));
        if (!saved || run !== runRef.current) {
          if (run === runRef.current) setPhase('source');
          return;
        }
      }
      const fetched =
        source === 'ai'
          ? await wordAnalysisService.generateWordsFromIntent(intent.trim(), count, bookId)
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
        setError(source === 'ai' ? '没有生成新的单词，换个描述再试试' : '没有找到可学习的单词，试试“全部单词”或换一段文本');
        return;
      }
      setCandidates(next);
      setPhase('select');
    } catch (err) {
      if (run !== runRef.current) return;
      setPhase('source');
      setError(errorText(err, source === 'ai' ? '无法生成单词' : '无法提取单词'));
    }
  };

  // ── 3 分析并保存 ──
  const save = async (words: ExtractedWord[]) => {
    if (words.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await onSaveWords(words);
      reset();
      onClose();
    } catch (err) {
      // 保存失败：结果保留，可以直接再点保存
      setPhase('review');
      setError(`${errorText(err, '无法保存单词')}。分析结果已保留，可以直接重试保存`);
    } finally {
      setSaving(false);
    }
  };

  /** 分析 `words`（首次或重试失败的词），结果与已有结果合并 */
  const analyze = async (words: string[]) => {
    if (words.length === 0) return;
    const run = ++runRef.current;
    const live = () => run === runRef.current;
    const existingSet = new Set(candidates.filter((c) => c.existing).map((c) => c.word.toLowerCase()));
    setError(null);
    setProgress(null);
    setStopped(false);
    setPhase('analyzing');
    try {
      // 生成 / 提取时定好的释义随单词传给拼读分析，保证释义和例句沿用同一个意思
      const meaningOf = new Map(candidates.map((c) => [c.word.toLowerCase(), c.meaning]));
      const analysis = await wordAnalysisService.analyzeExtractedWords(
        words,
        { bookId, meanings: words.map((w) => meaningOf.get(w.toLowerCase()) ?? '') },
        (p) => live() && setProgress(p)
      );
      if (!live()) return;
      if (!analysis.success) {
        setProgress(null);
        setPhase(analyzed.length > 0 ? 'review' : 'select');
        setError(errorText(analysis.error, '无法完成拼读分析'));
        return;
      }
      const result = analysis.data;
      const done = new Map(analyzed.map((w) => [w.word.toLowerCase(), w]));
      for (const w of result.words) done.set(w.word.toLowerCase(), toAnalyzed(w, existingSet.has(w.word.toLowerCase())));
      const merged = [...done.values()];
      const missing = words.filter((w) => !done.has(w.toLowerCase()));
      setAnalyzed(merged);
      setFailed(missing);
      setProgress(null);
      if (missing.length === 0 && !stoppedRef.current) {
        await save(merged);
      } else {
        setPhase('review');
      }
    } catch (err) {
      if (!live()) return;
      setProgress(null);
      setPhase(analyzed.length > 0 ? 'review' : 'select');
      setError(errorText(err, '无法完成拼读分析'));
    }
  };
  const selected = candidates.filter((c) => c.selected);
  const selectedExisting = selected.filter((c) => c.existing).length;
  const existingCount = candidates.filter((c) => c.existing).length;
  const analyzedSelected = analyzed.filter((w) => w.selected);
  const busy = phase === 'fetching';

  /** 停止分析：进行中的批次跑完后返回已完成的部分 */
  const stopAnalysis = async () => {
    setStopped(true);
    const result = await wordAnalysisService.cancelBatchAnalysis();
    if (!result.success) {
      setStopped(false);
      setError(errorText(result.error, '无法停止分析'));
    }
  };

  const segmentItem = 'h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm';

  /** 来源选择卡片（单选） */
  const sourceCard = (value: AddWordsSource, Icon: React.ComponentType<{ className?: string }>, title: string, hint: string) => (
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
        'flex items-start gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60',
        source === value ? 'border-primary bg-accent/40 ring-1 ring-primary/30' : 'hover:bg-muted/50'
      )}
    >
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', source === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );

  /** 单词本场景：一行小卡片（描述摘要 + 编辑）；编辑时展开为文本框 */
  const sceneCard = () => {
    if (sceneDraft !== null) {
      const tooLong = sceneDraft.trim().length > SCENE_MAX;
      return (
        <div className="space-y-2 rounded-lg border p-3">
          <Label htmlFor="aw-scene">单词本场景</Label>
          <Textarea
            id="aw-scene"
            value={sceneDraft}
            onChange={(e) => setSceneDraft(e.target.value)}
            placeholder="例如：出国旅行常用词，覆盖机场、海关、酒店、问路、点餐"
            className="min-h-20 resize-none"
            aria-invalid={tooLong}
            autoFocus
          />
          <div className="flex items-center justify-between gap-2">
            <p className={cn('text-xs', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
              {sceneDraft.trim().length} / {SCENE_MAX}，保存为单词本描述
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
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-medium">单词本场景</span>
          <span className={cn('ml-2 text-xs', scene ? 'text-foreground' : 'text-muted-foreground')} title={scene || undefined}>
            {scene || '未设置：AI 会按单词最常用的意思选择释义和例句'}
          </span>
          {scene && <p className="truncate text-xs text-muted-foreground">生成、释义、例句和讲解都会按这个场景理解单词</p>}
        </div>
        <Button variant="ghost" size="sm" className="h-7 shrink-0" disabled={busy} onClick={() => setSceneDraft(scene)}>
          {scene ? '编辑' : '设置'}
        </Button>
      </div>
    );
  };

  /** 居中的状态块（生成中 / 保存中） */
  const centered = (title: string, detail?: React.ReactNode) => (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center" role="status">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent">
        <Loader2 className="size-6 animate-spin text-primary" />
      </span>
      <div className="font-medium">{title}</div>
      {detail && <div className="max-w-md text-sm text-muted-foreground">{detail}</div>}
    </div>
  );

  const body = () => {
    if (phase === 'fetching') {
      return centered(
        source === 'ai' ? 'AI 正在挑选单词…' : 'AI 正在从文本中提取单词…',
        source === 'ai' ? (
          <>
            “{intent.trim()}”
            <br />
            通常需要 10–40 秒
          </>
        ) : (
          '通常需要 10–30 秒，文本越长越慢'
        )
      );
    }
    if (saving) return centered(`正在保存 ${phase === 'review' ? analyzedSelected.length : analyzed.length} 个单词…`);

    switch (phase) {
      case 'source':
        return (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="单词来源">
              {sourceCard('ai', Sparkles, 'AI 生成', '描述学习目的或场景，AI 挑选合适的单词')}
              {sourceCard('text', FileUp, '从我的材料提取', '粘贴课文、文章或单词表，也可以导入 Word、PDF、字幕等文件')}
            </div>
            {sceneCard()}

            {source === 'ai' ? (
              <div className="flex flex-col gap-5">
                <div className="space-y-2">
                  <Label htmlFor="aw-intent">{scene ? '这次想补充什么？' : '描述你想要的单词'}</Label>
                  <div className="relative">
                    <Textarea
                      id="aw-intent"
                      value={intent}
                      onChange={(e) => setIntent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canFetch) fetchWords();
                      }}
                      placeholder={scene ? '例如：海关、酒店入住（会放在单词本场景里理解）' : '例如：帮我准备一场 TED 环境主题演讲需要的单词，听众是大学生'}
                      maxLength={INTENT_MAX}
                      className="min-h-36 resize-none pb-7"
                      autoFocus
                    />
                    <span className="pointer-events-none absolute right-3 bottom-2 text-xs text-muted-foreground tabular-nums">
                      {intentLength} / {INTENT_MAX}
                    </span>
                  </div>
                  {!scene && (
                    <label className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={useIntentAsScene} onCheckedChange={(v) => setUseIntentAsScene(v === true)} className="mt-px" />
                      <span>同时设为单词本场景：之后补充单词、生成例句和讲解都会参考它，避免词义跑偏</span>
                    </label>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {INTENT_EXAMPLES.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => setIntent(example)}
                        className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>单词数量</Label>
                    <p className="mt-1 text-xs text-muted-foreground">会自动避开单词本里已有的词</p>
                  </div>
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
                <div className="space-y-1">
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
                  {textLength <= MAX_TEXT && textLength > LONG_TEXT && <p className="text-xs text-muted-foreground">文本较长，提取会慢一些；分段添加更稳定</p>}
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>提取范围</Label>
                    <p className="mt-1 text-xs text-muted-foreground">“值得学的词”会略过 a、the、is 这类简单词</p>
                  </div>
                  <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as WordExtractionMode)} className="rounded-lg bg-muted p-0.5" aria-label="提取范围">
                    <ToggleGroupItem value="focus" className={segmentItem}>
                      值得学的词
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
                <span>
                  {existingCount} 个词已在单词本中，默认不选；勾选后会用新的分析覆盖原有内容
                  {selectedExisting > 0 && `（已勾选 ${selectedExisting} 个）`}
                </span>
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
        return <BatchAnalysisPanel progress={progress} stopping={stopped} />;

      case 'review':
        return (
          <div className="flex flex-col gap-3">
            <div className={cn('flex items-start gap-3 rounded-lg border p-3', failed.length > 0 ? 'border-warning/40 bg-warning-soft/50' : 'bg-muted/40')}>
              {failed.length > 0 ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" /> : <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" />}
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  {stopped ? '已停止分析' : '分析完成'}：{analyzed.length} 个单词可以保存
                  {failed.length > 0 && `，${failed.length} 个没有完成`}
                </div>
                {failed.length > 0 && (
                  <div className="mt-0.5 text-muted-foreground">
                    {failed.slice(0, 10).join('、')}
                    {failed.length > 10 ? ' 等' : ''}——可以重新分析，或只保存已完成的
                  </div>
                )}
              </div>
            </div>
            <WordGrid
              words={analyzed}
              showFrequency={false}
              onWordToggle={(id) => setAnalyzed((prev) => prev.map((w) => (w.id === id ? { ...w, selected: !w.selected } : w)))}
              onSelectAll={(all) => setAnalyzed((prev) => prev.map((w) => ({ ...w, selected: all })))}
            />
          </div>
        );
    }
  };

  const footer = () => {
    switch (phase) {
      case 'source':
      case 'fetching':
        return (
          <>
            <span className="mr-auto text-xs text-muted-foreground">模型：「设置 → AI 助手」中的“提取 / 生成单词”</span>
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
              {source === 'ai' ? '修改描述' : '修改文本'}
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
            <span className="mr-auto text-xs text-muted-foreground">分析完会自动保存；停止后可以只保存已完成的</span>
            <Button variant="outline" onClick={stopAnalysis} disabled={stopped || saving}>
              {stopped && <Loader2 className="animate-spin" />}
              {stopped ? '正在停止…' : '停止分析'}
            </Button>
          </>
        );
      case 'review':
        return (
          <>
            {failed.length > 0 && (
              <Button variant="ghost" className="mr-auto" onClick={() => analyze(failed)} disabled={saving}>
                <RotateCw />
                重新分析 {failed.length} 个
              </Button>
            )}
            <Button variant="outline" onClick={requestClose} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => save(analyzedSelected)} disabled={saving || analyzedSelected.length === 0}>
              {saving && <Loader2 className="animate-spin" />}
              保存 {analyzedSelected.length} 个单词
            </Button>
          </>
        );
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && requestClose()}>
        <DialogContent
          className="flex h-[min(680px,88vh)] flex-col gap-0 p-0 sm:max-w-3xl"
          onInteractOutside={(e) => hasUnsavedWork && e.preventDefault()}
        >
          <DialogHeader className="gap-4 border-b px-6 pt-5 pb-4">
            <div>
              <DialogTitle>添加单词</DialogTitle>
              <DialogDescription className="mt-1">{bookTitle ? `添加到「${bookTitle}」，` : ''}选好后自动完成拼读分析并保存</DialogDescription>
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
              {phase === 'analyzing' ? '正在进行的分析会停止，' : ''}已经生成或分析的单词不会保存。
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
