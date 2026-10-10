import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronUp, ListChecks, PenLine, Plus, RotateCw, Search, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { InlineError } from '@/components/InlineError';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { PassagePlanEditor, type EditablePlanItem, type PlanItemStatus } from '@/components/PassagePlanEditor';
import { Stepper } from '@/components/Stepper/Stepper';
import { cn } from '@/lib/utils';
import { useMaterialSettings } from '@/hooks/useMaterialSettings';
import { passageService } from '@/services/passageService';
import { studyService } from '@/services/studyService';
import { wordBookService } from '@/services/wordbookService';
import { wordAnalysisService } from '@/services/wordAnalysisService';
import { toUserMessage } from '@/api/errors';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { AiWorking } from '@/components/AiWorking';
import { JobPanel } from '@/components/Jobs';
import { isJobActive } from '@/types/job';
import { getStatusDisplay } from '@/types/study';
import { PICK_DIFFICULTY_OPTIONS, PICK_FREQUENCY_OPTIONS, PICK_STATUS_OPTIONS, PLAN_SCOPE_LABEL, PLAN_SCOPES } from '@/utils/passage';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { GeneratePassageRequest, PassageItemStatus, PassageWordCandidate, PickDifficulty, PickFrequency, PickStatus, PlanScopeCount, PlanWordScope } from '@/types/passage';
import type { StudyPlanWithProgress, UnifiedStudyPlanStatus, WordBook } from '@/types';
import type { NavigateFn, RouteParams } from '../navigation';

export interface CreatePassagePageProps {
  /** 预填（从词汇本页 / 单词列表进入） */
  initial?: RouteParams['create-passage'];
  onNavigate?: NavigateFn;
}

const STEPS = ['生成方式', '选择单词', '场景与篇幅', '内容规划'];
/** 按描述生成：第一步由 AI 按要求选词（代替选来源），后面与基于单词的流程相同 */
const BRIEF_STEPS = ['写作要求', '选择单词', '要求与篇幅', '内容规划'];
const BRIEF_WORD_COUNTS = [10, 15, 20, 30];
/** 写作要求最多几个字（与后端 INSTRUCTION_MAX 一致） */
const INSTRUCTION_MAX = 500;

/** 生成方式：按描述直接生成，或基于词汇本 / 学习计划里的单词（三者并列，选一种） */
type SourceMode = 'brief' | 'books' | 'plans';
const SOURCE_MODES: { value: SourceMode; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'brief', label: '按描述生成', description: '写下主题和要求，由 AI 选词', icon: PenLine },
  { value: 'books', label: '基于词汇本', description: '从词汇本中选词', icon: BookOpen },
  { value: 'plans', label: '基于学习计划', description: '按学习进度选词', icon: ListChecks },
];
const MIN_WORDS = 1;
const SCENE_MAX = 200;
const AI_PICK_OPTIONS = [5, 8, 10, 15, 20];
/** 来源里的词超过这个数时默认让 AI 挑 */
const AI_MODE_THRESHOLD = 30;
const PICK_STATUSES = PICK_STATUS_OPTIONS;
const DIFFICULTIES = PICK_DIFFICULTY_OPTIONS;
const FREQUENCIES = PICK_FREQUENCY_OPTIONS;

type PickMode = 'ai' | 'manual';
/** AI 挑词的条件（默认值来自「设置 → 素材」） */
interface PickPrefs {
  count: number;
  difficulty: PickDifficulty | 'any';
  frequency: PickFrequency | 'any';
  statuses: PickStatus[];
}
const DEFAULT_PREFS: PickPrefs = { count: 10, difficulty: 'medium', frequency: 'common', statuses: [] };

const matchesStatuses = (filter: PickStatus[], c: PassageWordCandidate) => filter.length === 0 || filter.some((f) => c.statuses.includes(f));
/** 候选词表格里的学习情况标签 */
const TAG_LABEL: Record<Exclude<PlanWordScope, 'learned'>, string> = { wrong: '易错', weak: '薄弱', recent: '新学', upcoming: '待复习', mastered: '已掌握' };
const LENGTHS = [
  { value: 'short', label: '短' },
  { value: 'standard', label: '标准' },
  { value: 'long', label: '长' },
] as const;
const segmentItem = 'h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm';
/** 一个英文单词或 2–6 个词的词组（D45） */
const isWord = (w: string) => /^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,5}$/.test(w) && w.length <= 60;

/** 可多选的来源列表（词汇本 / 学习计划）：搜索 + 勾选行 */
const SourcePicker: React.FC<{
  title: string;
  icon: React.ReactNode;
  items: { id: number; name: string; meta: string }[] | null;
  selected: number[];
  onToggle: (id: number) => void;
  empty: string;
  footer?: React.ReactNode;
}> = ({ title, icon, items, selected, onToggle, empty, footer }) => {
  const [query, setQuery] = useState('');
  const visible = (items ?? []).filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Card className="gap-3 px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
        <h2 className="flex-1 font-semibold">{title}</h2>
        {selected.length > 0 && <Badge variant="secondary">已选 {selected.length}</Badge>}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`搜索${title}`} aria-label={`搜索${title}`} className="pl-8" />
      </div>
      <div className="h-64 overflow-y-auto rounded-md border">
        {items === null ? (
          <div className="flex flex-col gap-2 p-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{items.length === 0 ? empty : '没有匹配的结果'}</p>
        ) : (
          visible.map((i) => (
            <Label key={i.id} className="flex items-center gap-3 border-b px-3 py-2 font-normal last:border-b-0 hover:bg-muted/50">
              <Checkbox checked={selected.includes(i.id)} onCheckedChange={() => onToggle(i.id)} />
              <span className="min-w-0 flex-1 truncate">{i.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{i.meta}</span>
            </Label>
          ))
        )}
      </div>
      {footer}
    </Card>
  );
};

/** AI 挑词条件的一行：左侧标题，右侧控件 */
const PickRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-4">
    <Label className="w-20 shrink-0">{label}</Label>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{children}</div>
  </div>
);

/** 学习状态多选：「全部」与具体状态互斥（都不选即全部），每项带词数 */
const StatusFilter: React.FC<{ value: PickStatus[]; onChange: (value: PickStatus[]) => void; counts: Record<PickStatus, number>; total: number; label: string }> = ({ value, onChange, counts, total, label }) => (
  <ToggleGroup
    type="multiple"
    variant="outline"
    size="sm"
    value={value.length === 0 ? ['all'] : value}
    onValueChange={(v) => {
      // 点「全部」清空具体状态；点具体状态时去掉「全部」
      if (value.length > 0 && v.includes('all')) return onChange([]);
      onChange(v.filter((x) => x !== 'all') as PickStatus[]);
    }}
    aria-label={label}
  >
    <ToggleGroupItem value="all" className="gap-1.5 px-3 data-[state=on]:border-primary/60 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground">
      全部
      <span className="text-xs text-muted-foreground tabular-nums">{total}</span>
    </ToggleGroupItem>
    {PICK_STATUSES.map((st) => (
      <ToggleGroupItem key={st.value} value={st.value} className="gap-1.5 px-3 data-[state=on]:border-primary/60 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground">
        {st.label}
        <span className="text-xs text-muted-foreground tabular-nums">{counts[st.value]}</span>
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
);

/**
 * 新建短文。三种生成方式并列：
 * - 按描述生成：写下要求与篇幅，直接生成一篇（后台任务，写好后打开）；
 * - 基于词汇本 / 基于学习计划：② 选择单词（AI 按数量、难度、词频、选词范围挑选，可另指定单词；或手动选择）
 *   ③ 场景与篇幅 ④ 内容规划（AI 先规划写几篇、每篇的构思）→ 逐篇生成。
 */
export const CreatePassagePage: React.FC<CreatePassagePageProps> = ({ initial, onNavigate }) => {
  const [step, setStep] = useState(initial?.wordIds?.length ? 1 : 0);
  /** 生成方式：从词汇本 / 计划进入时按入口，否则默认按描述生成 */
  const [sourceMode, setSourceMode] = useState<SourceMode>(initial?.planIds?.length ? 'plans' : initial?.bookIds?.length || initial?.wordIds?.length ? 'books' : 'brief');
  /** 按描述生成：写作要求、要几个目标词、AI 选出的词（可勾掉） */
  const [instruction, setInstruction] = useState('');
  const [briefCount, setBriefCount] = useState(15);
  const [briefWords, setBriefWords] = useState<{ word: string; meaning: string; selected: boolean }[] | null>(null);
  /** AI 选的词对应的要求与数量：没改就不重新选 */
  const [briefFor, setBriefFor] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const suggestRun = useRef(0);
  const [books, setBooks] = useState<WordBook[] | null>(null);
  const [plans, setPlans] = useState<StudyPlanWithProgress[] | null>(null);
  const [bookIds, setBookIds] = useState<number[]>(initial?.bookIds ?? []);
  const [planIds, setPlanIds] = useState<number[]>(initial?.planIds ?? []);
  const [scopes, setScopes] = useState<PlanWordScope[]>(['wrong', 'weak']);
  const [scopeCounts, setScopeCounts] = useState<PlanScopeCount[] | null>(null);
  const [candidates, setCandidates] = useState<PassageWordCandidate[] | null>(null);
  const [required, setRequired] = useState<Set<number>>(new Set(initial?.wordIds ?? []));
  const [wordQuery, setWordQuery] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [extraWords, setExtraWords] = useState<string[]>([]);
  const [extraDraft, setExtraDraft] = useState('');
  const [prefs, setPrefs] = useState<PickPrefs>(DEFAULT_PREFS);
  /** 选词方式；用户没选过时按来源里的词数决定 */
  const [pickMode, setPickMode] = useState<PickMode>(initial?.wordIds?.length ? 'manual' : 'ai');
  const [modeChosen, setModeChosen] = useState(Boolean(initial?.wordIds?.length));
  /** AI 模式下是否展开候选词列表 */
  const [showList, setShowList] = useState(false);
  /** 列表的学习情况筛选（只影响显示） */
  const [tableStatuses, setTableStatuses] = useState<PickStatus[]>([]);
  const [scene, setScene] = useState('');
  const [length, setLength] = useState<'short' | 'standard' | 'long'>('standard');
  /** 正在让 AI 规划 */
  const [planning, setPlanning] = useState(false);
  /** 每次内容规划的序号：停止后迟到的结果丢弃 */
  const planRun = useRef(0);
  const [planItems, setPlanItems] = useState<EditablePlanItem[]>([]);
  const [planNote, setPlanNote] = useState('');
  /** 写短文的后台任务：每次提交写哪几篇（规划里的序号）；重写失败的篇目是新的一次 */
  const [runs, setRuns] = useState<{ jobId: string; indexes: number[] }[]>([]);
  const jobs = useJobs();
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    wordBookService.getAllWordBooks(false, 'normal').then((r) => setBooks(r.success ? r.data.filter((b) => b.total_words > 0) : []));
    studyService.getAllStudyPlans().then((r) => setPlans(r.success ? r.data.filter((p) => p.unified_status !== 'Deleted' && p.unified_status !== 'Draft') : []));
  }, []);

  const hasSources = bookIds.length + planIds.length > 0;

  // 来源变化时重新加载候选词；已勾选的必用词只保留仍在候选里的
  useEffect(() => {
    if (!hasSources) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setCandidates(null);
    passageService.getWordCandidates({ bookIds, planIds, planScopes: scopes }).then((r) => {
      if (cancelled) return;
      if (!r.success) {
        setError({ title: '无法加载候选词', message: r.error });
        setCandidates([]);
        return;
      }
      setCandidates(r.data);
      if (!modeChosen) setPickMode(r.data.length > AI_MODE_THRESHOLD ? 'ai' : 'manual');
      const ids = new Set(r.data.map((c) => c.wordId));
      setRequired((prev) => new Set([...prev].filter((id) => ids.has(id))));
    });
    return () => {
      cancelled = true;
    };
    // modeChosen 只在加载完成时读一次，切换方式不重新加载
  }, [bookIds, planIds, scopes, hasSources]);

  // 所选计划里每种取词策略能取到几个词
  useEffect(() => {
    if (planIds.length === 0) return setScopeCounts(null);
    let cancelled = false;
    passageService.getPlanScopeCounts(planIds).then((r) => !cancelled && setScopeCounts(r.success ? r.data : []));
    return () => {
      cancelled = true;
    };
  }, [planIds]);

  /** 「全部学过的词」与其它策略互斥；其它策略可多选 */
  const toggleScope = (scope: PlanWordScope) =>
    setScopes((prev) => {
      if (scope === 'learned') return prev.includes('learned') ? [] : ['learned'];
      const rest = prev.filter((s) => s !== 'learned');
      return rest.includes(scope) ? rest.filter((s) => s !== scope) : [...rest, scope];
    });
  const countOf = (scope: PlanWordScope) => scopeCounts?.find((c) => c.scope === scope)?.count;

  const visibleWords = useMemo(() => {
    const q = wordQuery.trim().toLowerCase();
    return (candidates ?? []).filter(
      (c) => (!onlySelected || required.has(c.wordId)) && matchesStatuses(tableStatuses, c) && (!q || c.word.toLowerCase().includes(q) || c.meaning.includes(q))
    );
  }, [candidates, wordQuery, onlySelected, required, tableStatuses]);
  const allVisibleSelected = visibleWords.length > 0 && visibleWords.every((c) => required.has(c.wordId));
  const someVisibleSelected = visibleWords.some((c) => required.has(c.wordId));
  /** 表头复选框：全选 / 取消筛选出的词 */
  const toggleVisible = () =>
    setRequired((prev) => {
      const next = new Set(prev);
      for (const c of visibleWords) {
        if (allVisibleSelected) next.delete(c.wordId);
        else next.add(c.wordId);
      }
      return next;
    });

  const statusCounts = useMemo(() => {
    const counts: Record<PickStatus, number> = { new: 0, learning: 0, wrong: 0, mastered: 0 };
    for (const c of candidates ?? []) for (const st of c.statuses) counts[st] += 1;
    return counts;
  }, [candidates]);
  const updatePrefs = (patch: Partial<PickPrefs>) => setPrefs((prev) => ({ ...prev, ...patch }));
  // 挑词条件与篇幅的默认值来自「设置 → 素材」
  const materialSettings = useMaterialSettings();
  useEffect(() => {
    if (!materialSettings) return;
    setPrefs((p) => ({
      ...p,
      count: AI_PICK_OPTIONS.includes(materialSettings.passagePickCount) ? materialSettings.passagePickCount : p.count,
      difficulty: materialSettings.passagePickDifficulty,
      frequency: materialSettings.passagePickFrequency,
    }));
    setLength(materialSettings.passageLength);
  }, [materialSettings]);
  const chooseMode = (mode: PickMode) => {
    setPickMode(mode);
    setModeChosen(true);
  };

  const aiMode = hasSources && pickMode === 'ai';
  /** AI 可挑的词：符合学习情况、不含一定要用的词 */
  const poolSize = aiMode ? (candidates ?? []).filter((c) => !required.has(c.wordId) && matchesStatuses(prefs.statuses, c)).length : 0;
  const effectivePick = aiMode ? Math.min(prefs.count, poolSize) : 0;
  const pickSummary = [
    `难度${DIFFICULTIES.find((d) => d.value === prefs.difficulty)?.label}`,
    prefs.frequency === 'any' ? '词频不限' : FREQUENCIES.find((f) => f.value === prefs.frequency)?.label,
    prefs.statuses.length > 0 ? PICK_STATUSES.filter((p) => prefs.statuses.includes(p.value)).map((p) => p.label).join('、') : '全部单词',
  ].join(' · ');
  /** 按描述生成时勾选的 AI 选词 */
  const briefSelected = sourceMode === 'brief' ? (briefWords ?? []).filter((w) => w.selected).map((w) => w.word) : [];
  const total = required.size + extraWords.length + effectivePick + briefSelected.length;
  const totalError = total < MIN_WORDS ? (aiMode ? '没有可用的单词：请放宽选词范围，或指定单词' : '请至少选择 1 个单词') : null;
  const sceneHint = useMemo(() => {
    const descriptions = (books ?? []).filter((b) => bookIds.includes(b.id) && b.description?.trim()).map((b) => b.description.trim());
    return descriptions.length > 0 ? `默认：${descriptions.join('；')}` : '例如：在机场遇到航班延误';
  }, [books, bookIds]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<number[]>>) => (id: number) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleWord = (id: number) =>
    setRequired((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const addExtra = () => {
    const words = extraDraft
      // 词组里有空格：多个词条用逗号、顿号、分号或换行分开
      .split(/[,，、;；\n]+/)
      .map((w) => w.trim().replace(/\s+/g, ' '))
      .map((w) => w.trim())
      .filter(Boolean);
    const bad = words.filter((w) => !isWord(w));
    if (bad.length > 0) return setError({ title: '无法添加单词', message: `「${bad.join('、')}」不是英文单词或词组` });
    const existing = new Set([...extraWords, ...briefSelected, ...(candidates ?? []).filter((c) => required.has(c.wordId)).map((c) => c.word)].map((w) => w.toLowerCase()));
    setExtraWords((prev) => [...prev, ...words.filter((w) => !existing.has(w.toLowerCase()))]);
    setExtraDraft('');
    setError(null);
  };

  const baseRequest = (): GeneratePassageRequest => ({
    bookIds,
    planIds,
    planScopes: scopes,
    requiredWordIds: [...required],
    extraWords: [...briefSelected, ...extraWords],
    aiPick: effectivePick,
    pickStatuses: effectivePick > 0 ? prefs.statuses : [],
    pickDifficulty: effectivePick > 0 && prefs.difficulty !== 'any' ? prefs.difficulty : null,
    pickFrequency: effectivePick > 0 && prefs.frequency !== 'any' ? prefs.frequency : null,
    topic: sourceMode === 'brief' ? null : scene.trim() || null,
    instruction: sourceMode === 'brief' ? instruction.trim() : null,
    length,
  });

  /** 让 AI 给出内容规划（写几篇、每篇的构思与用词） */
  const makePlan = async (feedback?: string) => {
    const run = ++planRun.current;
    setPlanning(true);
    setError(null);
    const result = await passageService.planPassages(baseRequest(), feedback);
    // 停止后迟到的结果不再采用
    if (run !== planRun.current) return;
    setPlanning(false);
    if (!result.success) return setError({ title: '无法生成内容规划', message: result.error });
    setPlanItems(result.data.items.map((item) => ({ ...item, include: true })));
    setPlanNote(result.data.note);
    setRuns([]);
    setStep(3);
  };

  /** 提交后台任务写这几篇（规划里的序号）；离开页面也会继续 */
  const write = async (indexes: number[]) => {
    setError(null);
    const items = indexes.map((i) => {
      const { include: _include, ...item } = planItems[i];
      return item;
    });
    const started = await passageService.startGeneration({ base: baseRequest(), items });
    if (!started.success) return setError({ title: '无法开始生成短文', message: started.error });
    setRuns((prev) => [...prev, { jobId: started.data, indexes }]);
  };
  const generateAll = () => write(planItems.map((it, i) => (it.include ? i : -1)).filter((i) => i >= 0));

  /** 按描述生成第一步：AI 按要求选出目标词（要求与数量没变时沿用上次的结果） */
  const suggestWords = async (force = false) => {
    const key = `${instruction.trim()}|${briefCount}`;
    if (!force && briefWords && briefFor === key) return setStep(1);
    const run = ++suggestRun.current;
    setSuggesting(true);
    setError(null);
    const result = await wordAnalysisService.generateWordsFromIntent(instruction.trim(), briefCount);
    if (run !== suggestRun.current) return;
    setSuggesting(false);
    if (!result.success) return setError({ title: '无法选词', message: result.error });
    setBriefWords(result.data.words.map((w) => ({ word: w.word, meaning: w.meaning ?? '', selected: true })));
    setBriefFor(key);
    setStep(1);
  };

  /** 换生成方式：只保留这种方式的来源 */
  const chooseSource = (mode: SourceMode) => {
    setSourceMode(mode);
    if (mode !== 'books') setBookIds([]);
    if (mode !== 'plans') setPlanIds([]);
    setRuns([]);
    setError(null);
  };

  /** 逐篇状态：从后台任务的 detail 读；后提交的覆盖先提交的（重写失败的篇目） */
  const statuses: PlanItemStatus[] | null = useMemo(() => {
    if (runs.length === 0) return null;
    const out: PlanItemStatus[] = planItems.map(() => ({ state: 'skipped' }));
    for (const run of runs) {
      const job = jobs.find((j) => j.id === run.jobId);
      const items = (job?.detail as { items?: PassageItemStatus[] } | null)?.items;
      run.indexes.forEach((idx, k) => {
        const item = items?.[k];
        if (item?.state === 'done' && item.passageId) out[idx] = { state: 'done', passageId: item.passageId };
        else if (item?.state === 'failed') out[idx] = { state: 'failed', error: toUserMessage(item.error ?? '') };
        else if (item?.state === 'running') out[idx] = { state: 'running' };
        else if (job && !isJobActive(job)) out[idx] = { state: 'failed', error: job.status === 'cancelled' ? '已停止' : '没有写成' };
        else out[idx] = { state: 'waiting' };
      });
    }
    return out;
  }, [runs, jobs, planItems]);

  // 只写一篇且写好了：还在这个页面时直接打开它
  useOnJobFinished((job) => {
    if (runs.length !== 1 || job.id !== runs[0].jobId || runs[0].indexes.length !== 1) return;
    const ids = (job.result as { passageIds?: number[] } | null)?.passageIds ?? [];
    if (ids.length === 1) onNavigate?.('passage-detail', { passageId: ids[0] });
  });

  const selectedSources = [
    ...(books ?? []).filter((b) => bookIds.includes(b.id)).map((b) => ({ key: `b${b.id}`, icon: <BookOpen />, name: b.title })),
    ...(plans ?? []).filter((p) => planIds.includes(p.id)).map((p) => ({ key: `p${p.id}`, icon: <ListChecks />, name: `${p.name} · ${scopes.map((s) => PLAN_SCOPE_LABEL[s]).join('、')}` })),
  ];
  const includedCount = planItems.filter((it) => it.include).length;
  const writing = statuses !== null && statuses.some((st) => st.state === 'running' || st.state === 'waiting');
  /** 正在写的那一批（最近提交的进行中任务） */
  const activeRunJob = [...runs].reverse().map((r) => jobs.find((j) => j.id === r.jobId)).find((j) => j && isJobActive(j));
  const requiredWords = [...(candidates ?? []).filter((c) => required.has(c.wordId)).map((c) => c.word), ...briefSelected, ...extraWords];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-7">
      <PageHeader title="新建短文" />
      <Stepper steps={sourceMode === 'brief' ? BRIEF_STEPS : STEPS} current={step} />

      {planning || suggesting ? (
        <Card className="px-6">
          <AiWorking title={suggesting ? 'AI 正在选词' : 'AI 正在规划内容'} />
        </Card>
      ) : (
        <>
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <RadioGroup value={sourceMode} onValueChange={(v) => chooseSource(v as SourceMode)} className="grid grid-cols-3 gap-3" aria-label="生成方式">
                {SOURCE_MODES.map(({ value, label, description, icon: Icon }) => (
                  <Label
                    key={value}
                    htmlFor={`source-${value}`}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/50"
                  >
                    <RadioGroupItem id={`source-${value}`} value={value} className="sr-only" />
                    <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block font-medium">{label}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>

              {sourceMode === 'brief' && (
                <Card className="gap-5 px-5 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="cp-instruction">写作要求</Label>
                    <Textarea
                      id="cp-instruction"
                      value={instruction}
                      maxLength={INSTRUCTION_MAX}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder="例如：几篇介绍恐龙的博物馆展板文字，语言专业、使用学术词汇"
                      className="min-h-32 resize-none"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <Label>目标词数量</Label>
                    <Select value={String(briefCount)} onValueChange={(v) => setBriefCount(Number(v))}>
                      <SelectTrigger className="w-28" aria-label="目标词数量">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BRIEF_WORD_COUNTS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n} 个
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </Card>
              )}

              {sourceMode === 'books' && (
                <SourcePicker
                  title="词汇本"
                  icon={<BookOpen />}
                  items={books?.map((b) => ({ id: b.id, name: b.title, meta: `${b.total_words} 词` })) ?? null}
                  selected={bookIds}
                  onToggle={toggle(setBookIds)}
                  empty="还没有包含单词的词汇本"
                />
              )}
              {sourceMode === 'plans' && (
                <SourcePicker
                  title="学习计划"
                  icon={<ListChecks />}
                  items={plans?.map((p) => ({ id: p.id, name: p.name, meta: getStatusDisplay(p.unified_status as UnifiedStudyPlanStatus).text })) ?? null}
                  selected={planIds}
                  onToggle={toggle(setPlanIds)}
                  empty="还没有学习计划"
                />
              )}
              {sourceMode === 'plans' && planIds.length > 0 && (
                <Card className="gap-3 px-5 py-4">
                  <h2 className="font-semibold">选词范围</h2>
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label="计划的取词策略">
                    {PLAN_SCOPES.map((s) => {
                      const count = countOf(s.value);
                      const on = scopes.includes(s.value);
                      return (
                        <Tooltip key={s.value}>
                          <TooltipTrigger asChild>
                            <Label
                              className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 font-normal transition-colors hover:bg-muted/50', on && 'border-primary/60 bg-accent/40')}
                            >
                              <Checkbox checked={on} onCheckedChange={() => toggleScope(s.value)} />
                              <span className="min-w-0 flex-1 font-medium">{s.label}</span>
                              <span className={cn('text-xs tabular-nums', count === 0 ? 'text-muted-foreground' : 'text-foreground')}>{count == null ? '…' : `${count} 个`}</span>
                            </Label>
                          </TooltipTrigger>
                          <TooltipContent>{s.description}</TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </Card>
              )}
            </div>
          )}

          {step === 1 && sourceMode === 'brief' && (
            <div className="flex flex-col gap-4">
              <Card className="gap-3 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">选择单词</h2>
                    <p className="text-sm text-muted-foreground">已选 {requiredWords.length} 个，都会出现在短文中</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => suggestWords(true)}>
                    <RotateCw />
                    换一批
                  </Button>
                </div>
                <div className="max-h-96 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={(briefWords ?? []).every((w) => w.selected) ? true : briefSelected.length > 0 ? 'indeterminate' : false}
                            onCheckedChange={() => {
                              const all = (briefWords ?? []).every((w) => w.selected);
                              setBriefWords((prev) => (prev ?? []).map((w) => ({ ...w, selected: !all })));
                            }}
                            aria-label="全选"
                          />
                        </TableHead>
                        <TableHead>单词</TableHead>
                        <TableHead>释义</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(briefWords ?? []).map((w, i) => (
                        <TableRow
                          key={w.word}
                          data-state={w.selected ? 'selected' : undefined}
                          onClick={() => setBriefWords((prev) => (prev ?? []).map((x, k) => (k === i ? { ...x, selected: !x.selected } : x)))}
                        >
                          <TableCell>
                            <Checkbox
                              checked={w.selected}
                              onCheckedChange={() => setBriefWords((prev) => (prev ?? []).map((x, k) => (k === i ? { ...x, selected: !x.selected } : x)))}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`选择 ${w.word}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{w.word}</TableCell>
                          <TableCell className="text-muted-foreground">{w.meaning}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={extraDraft}
                    onChange={(e) => setExtraDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && extraDraft.trim() && addExtra()}
                    placeholder="输入其他英文单词或词组，用逗号分隔"
                    aria-label="手动输入单词"
                    className="w-96"
                  />
                  <Button variant="outline" onClick={addExtra} disabled={!extraDraft.trim()}>
                    <Plus />
                    添加
                  </Button>
                  {extraWords.map((w) => (
                    <Badge key={w} variant="secondary" className="gap-1 pr-1">
                      {w}
                      <Button variant="ghost" size="icon" className="size-4 rounded-full" aria-label={`移除 ${w}`} onClick={() => setExtraWords((prev) => prev.filter((x) => x !== w))}>
                        <X className="size-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              </Card>
              {totalError && <p className="text-right text-sm text-destructive">{totalError}</p>}
            </div>
          )}

          {step === 1 && sourceMode !== 'brief' && (
            <div className="flex flex-col gap-4">
              {hasSources && (
                <ToggleGroup type="single" value={pickMode} onValueChange={(v) => v && chooseMode(v as PickMode)} className="self-start rounded-lg bg-muted p-0.5" aria-label="选词方式">
                  <ToggleGroupItem value="ai" className={segmentItem}>
                    <Sparkles />
                    AI 选词
                  </ToggleGroupItem>
                  <ToggleGroupItem value="manual" className={segmentItem}>
                    <ListChecks />
                    手动选词
                  </ToggleGroupItem>
                </ToggleGroup>
              )}

              {hasSources && pickMode === 'ai' && (
                <Card className="gap-4 px-5 py-4">
                  <PickRow label="数量">
                    <Select value={String(prefs.count)} onValueChange={(v) => updatePrefs({ count: Number(v) })}>
                      <SelectTrigger className="w-28" aria-label="AI 选词数量">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AI_PICK_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n} 个
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </PickRow>
                  <PickRow label="难度">
                    <ToggleGroup type="single" value={prefs.difficulty} onValueChange={(v) => v && updatePrefs({ difficulty: v as PickPrefs['difficulty'] })} className="rounded-lg bg-muted p-0.5" aria-label="难度">
                      {DIFFICULTIES.map((d) => (
                        <ToggleGroupItem key={d.value} value={d.value} className={segmentItem}>
                          {d.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </PickRow>
                  <PickRow label="词频">
                    <ToggleGroup type="single" value={prefs.frequency} onValueChange={(v) => v && updatePrefs({ frequency: v as PickPrefs['frequency'] })} className="rounded-lg bg-muted p-0.5" aria-label="词频">
                      {FREQUENCIES.map((f) => (
                        <ToggleGroupItem key={f.value} value={f.value} className={segmentItem}>
                          {f.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </PickRow>
                  <PickRow label="选词范围">
                    <StatusFilter value={prefs.statuses} onChange={(statuses) => updatePrefs({ statuses })} counts={statusCounts} total={candidates?.length ?? 0} label="选词范围" />
                    {candidates !== null && (
                      <span className={cn('text-sm tabular-nums', poolSize === 0 ? 'text-destructive' : 'text-muted-foreground')}>
                        {poolSize === 0 ? '没有符合条件的单词' : `符合条件 ${poolSize} 个`}
                      </span>
                    )}
                  </PickRow>
                </Card>
              )}

              <Card className="gap-3 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{pickMode === 'ai' ? '指定单词' : '选择单词'}</h2>
                    <p className="text-sm text-muted-foreground">
                      {pickMode === 'ai' ? '可选。指定的单词一定会出现在短文中' : `已选 ${requiredWords.length} 个，都会出现在短文中`}
                    </p>
                  </div>
                  {hasSources && pickMode === 'ai' && (
                    <Button variant="outline" size="sm" onClick={() => setShowList((v) => !v)} aria-expanded={showList}>
                      {showList ? <ChevronUp /> : <ChevronDown />}
                      {showList ? '收起列表' : '从列表选择'}
                    </Button>
                  )}
                </div>
                {pickMode === 'ai' && hasSources && requiredWords.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(candidates ?? [])
                      .filter((c) => required.has(c.wordId))
                      .map((c) => (
                        <Badge key={c.wordId} variant="secondary" className="gap-1 pr-1">
                          {c.word}
                          <Button variant="ghost" size="icon" className="size-4 rounded-full" aria-label={`移除 ${c.word}`} onClick={() => toggleWord(c.wordId)}>
                            <X className="size-3" />
                          </Button>
                        </Badge>
                      ))}
                  </div>
                )}
                {!hasSources ? (
                  <p className="rounded-md bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">没有选择来源，可在下方输入单词</p>
                ) : pickMode === 'ai' && !showList ? null : candidates === null ? (
                  <Skeleton className="h-48 rounded-md" />
                ) : candidates.length === 0 ? (
                  <p className="rounded-md bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">所选来源里没有符合条件的单词</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusFilter value={tableStatuses} onChange={setTableStatuses} counts={statusCounts} total={candidates?.length ?? 0} label="按学习状态筛选" />
                      <div className="flex-1" />
                      <div className="relative w-56">
                        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={wordQuery} onChange={(e) => setWordQuery(e.target.value)} placeholder="搜索单词或释义" aria-label="搜索单词" className="pl-8" />
                      </div>
                      <Label className="font-normal">
                        <Checkbox checked={onlySelected} onCheckedChange={(v) => setOnlySelected(v === true)} />
                        只看已选
                      </Label>
                    </div>
                    <div className="max-h-80 overflow-y-auto rounded-md border">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-card">
                          <TableRow>
                            <TableHead className="w-10">
                              <Checkbox
                                checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                                onCheckedChange={toggleVisible}
                                disabled={visibleWords.length === 0}
                                aria-label={allVisibleSelected ? '取消选择筛选出的词' : '全选筛选出的词'}
                              />
                            </TableHead>
                            <TableHead>单词</TableHead>
                            <TableHead>释义</TableHead>
                            <TableHead>来源</TableHead>
                            <TableHead className="text-right">已用于短文</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleWords.map((c) => (
                            <TableRow key={c.wordId} data-state={required.has(c.wordId) ? 'selected' : undefined} onClick={() => toggleWord(c.wordId)}>
                              <TableCell>
                                <Checkbox checked={required.has(c.wordId)} onCheckedChange={() => toggleWord(c.wordId)} onClick={(e) => e.stopPropagation()} aria-label={`选择 ${c.word}`} />
                              </TableCell>
                              <TableCell className="font-medium">
                                {c.word}
                                {c.tags.map((t) => (
                                  <Badge key={t} variant={t === 'wrong' ? 'default' : 'secondary'} className={cn('ml-1.5 font-normal', t === 'wrong' && 'bg-warning-soft text-warning')}>
                                    {TAG_LABEL[t]}
                                  </Badge>
                                ))}
                              </TableCell>
                              <TableCell className="max-w-48 truncate text-muted-foreground">{c.meaning}</TableCell>
                              <TableCell className="max-w-40 truncate text-muted-foreground">{c.source}</TableCell>
                              <TableCell className="text-right text-muted-foreground tabular-nums">{c.usage > 0 ? `${c.usage} 次` : '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {visibleWords.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的单词</p>}
                    </div>
                  </>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={extraDraft}
                    onChange={(e) => setExtraDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && extraDraft.trim() && addExtra()}
                    placeholder="输入其他英文单词或词组，用逗号分隔"
                    aria-label="手动输入单词"
                    className="w-96"
                  />
                  <Button variant="outline" onClick={addExtra} disabled={!extraDraft.trim()}>
                    <Plus />
                    添加
                  </Button>
                  {extraWords.map((w) => (
                    <Badge key={w} variant="secondary" className="gap-1 pr-1">
                      {w}
                      <Button variant="ghost" size="icon" className="size-4 rounded-full" aria-label={`移除 ${w}`} onClick={() => setExtraWords((prev) => prev.filter((x) => x !== w))}>
                        <X className="size-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              </Card>

              {totalError && <p className="text-right text-sm text-destructive">{totalError}</p>}
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
              <Card className="gap-5 px-5 py-4">
                {sourceMode === 'brief' ? (
                  <div className="space-y-2">
                    <Label htmlFor="cp-instruction-2">写作要求</Label>
                    <Textarea id="cp-instruction-2" value={instruction} maxLength={INSTRUCTION_MAX} onChange={(e) => setInstruction(e.target.value)} className="min-h-28 resize-none" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="cp-scene">场景</Label>
                    <Textarea id="cp-scene" value={scene} maxLength={SCENE_MAX} onChange={(e) => setScene(e.target.value)} placeholder={sceneHint} className="min-h-28 resize-none" />
                  </div>
                )}
                <div className="flex items-center justify-between gap-4">
                  <Label>篇幅</Label>
                  <ToggleGroup type="single" value={length} onValueChange={(v) => v && setLength(v as typeof length)} className="rounded-lg bg-muted p-0.5" aria-label="篇幅">
                    {LENGTHS.map((l) => (
                      <ToggleGroupItem key={l.value} value={l.value} className={segmentItem}>
                        {l.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </Card>
              <Card className="gap-3 px-5 py-4 text-sm">
                <h2 className="font-semibold">确认</h2>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">来源</div>
                  {selectedSources.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {selectedSources.map((s) => (
                        <Badge key={s.key} variant="outline" className="font-normal">
                          {s.icon}
                          {s.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <div>{sourceMode === 'brief' ? '按描述生成' : '未选择'}</div>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">指定单词（{requiredWords.length}）</div>
                  <div className="flex flex-wrap gap-1">
                    {requiredWords.length > 0 ? (
                      requiredWords.map((w) => (
                        <span key={w} className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                          {w}
                        </span>
                      ))
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">AI 选词</span>
                  <span>{effectivePick > 0 ? `最多 ${effectivePick} 个` : '不选'}</span>
                </div>
                {effectivePick > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="shrink-0 text-muted-foreground">条件</span>
                    <span className="text-right">{pickSummary}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">篇幅</span>
                  <span>{LENGTHS.find((l) => l.value === length)?.label}</span>
                </div>
              </Card>
            </div>
          )}

          {step === 3 && activeRunJob && (
            <JobPanel job={activeRunJob} title="AI 正在生成短文" actions={{ stop: true, onBackground: () => onNavigate?.('passages') }} />
          )}
          {step === 3 && (
            <PassagePlanEditor
              items={planItems}
              note={planNote}
              onChange={setPlanItems}
              onReplan={(feedback) => makePlan(feedback)}
              statuses={statuses}
              onOpen={(passageId) => onNavigate?.('passage-detail', { passageId })}
              onRetry={(i) => write([i])}
            />
          )}
        </>
      )}

      {error && <InlineError title={error.title}>{error.message}</InlineError>}

      {(planning || suggesting) && (
        <div className="flex items-center gap-2 border-t pt-4">
          <Button
            variant="outline"
            onClick={() => {
              planRun.current += 1;
              suggestRun.current += 1;
              setPlanning(false);
              setSuggesting(false);
            }}
          >
            停止
          </Button>
        </div>
      )}
      {!planning && !suggesting && (
        <div className="flex items-center gap-2 border-t pt-4">
          {statuses === null && (
            <Button variant="ghost" onClick={() => onNavigate?.('passages')}>
              取消
            </Button>
          )}
          <div className="flex-1" />
          {step > 0 && statuses === null && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft />
              上一步
            </Button>
          )}
          {step < 2 && (
            <Button
              onClick={() => (step === 0 && sourceMode === 'brief' ? suggestWords() : setStep((s) => s + 1))}
              disabled={
                (step === 0 && (sourceMode === 'brief' ? !instruction.trim() : !hasSources)) ||
                (step === 0 && planIds.length > 0 && scopes.length === 0) ||
                (step === 1 && totalError !== null)
              }
            >
              下一步
              <ArrowRight />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={() => makePlan()} disabled={totalError !== null}>
              <Sparkles />
              生成内容规划
            </Button>
          )}
          {step === 3 && statuses === null && (
            <Button onClick={generateAll} disabled={includedCount === 0}>
              <Sparkles />
              {includedCount > 1 ? `生成 ${includedCount} 篇短文` : '生成短文'}
            </Button>
          )}
          {step === 3 && statuses !== null && !writing && (
            <Button onClick={() => onNavigate?.('passages')}>前往短文库</Button>
          )}
        </div>
      )}
    </div>
  );
};
