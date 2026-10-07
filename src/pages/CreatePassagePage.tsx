import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ListChecks, Loader2, Plus, Search, Sparkles, X } from 'lucide-react';
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
import { InlineError } from '@/components/InlineError';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { PassagePlanEditor, type EditablePlanItem, type PlanItemStatus } from '@/components/PassagePlanEditor';
import { Stepper } from '@/components/Stepper/Stepper';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
import { studyService } from '@/services/studyService';
import { wordBookService } from '@/services/wordbookService';
import { getStatusDisplay } from '@/types/study';
import { PLAN_SCOPE_LABEL, PLAN_SCOPES } from '@/utils/passage';
import type { GeneratePassageRequest, PassageWordCandidate, PlanScopeCount, PlanWordScope } from '@/types/passage';
import type { StudyPlanWithProgress, UnifiedStudyPlanStatus, WordBook } from '@/types';
import type { NavigateFn, RouteParams } from '../navigation';

export interface CreatePassagePageProps {
  /** 预填（从单词本页 / 单词列表进入） */
  initial?: RouteParams['create-passage'];
  onNavigate?: NavigateFn;
}

const STEPS = ['词汇来源', '选择单词', '场景与篇幅', '内容规划'];
const MIN_WORDS = 1;
const SCENE_MAX = 200;
const AI_PICK_OPTIONS = [0, 3, 5, 8, 10, 12];
/** 候选词表格里的学习情况标签 */
const TAG_LABEL: Record<Exclude<PlanWordScope, 'learned'>, string> = { wrong: '错词', weak: '没记牢', recent: '新学', upcoming: '快复习', mastered: '已掌握' };
const LENGTHS = [
  { value: 'short', label: '短' },
  { value: 'standard', label: '标准' },
  { value: 'long', label: '长' },
] as const;
const segmentItem = 'h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm';
const isWord = (w: string) => /^[A-Za-z][A-Za-z'-]{1,29}$/.test(w);

/** 可多选的来源列表（单词本 / 学习计划）：搜索 + 勾选行 */
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

/**
 * 新建短文（多步表单页）：① 词汇来源（单词本、学习计划两类并列，可多选组合）② 选择单词（勾选必须出现的词、可手动输入，
 * 另可让 AI 从来源里按场景再挑几个）③ 场景与篇幅 → AI 写短文（20–60 秒）→ 打开短文详情。
 */
export const CreatePassagePage: React.FC<CreatePassagePageProps> = ({ initial, onNavigate }) => {
  const [step, setStep] = useState(initial?.wordIds?.length ? 1 : 0);
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
  const [aiPick, setAiPick] = useState(5);
  const [scene, setScene] = useState('');
  const [length, setLength] = useState<'short' | 'standard' | 'long'>('standard');
  /** 正在让 AI 规划 */
  const [planning, setPlanning] = useState(false);
  const [planItems, setPlanItems] = useState<EditablePlanItem[]>([]);
  const [planNote, setPlanNote] = useState('');
  /** 逐篇生成的状态（null = 还没开始生成） */
  const [statuses, setStatuses] = useState<PlanItemStatus[] | null>(null);
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
      const ids = new Set(r.data.map((c) => c.wordId));
      setRequired((prev) => new Set([...prev].filter((id) => ids.has(id))));
    });
    return () => {
      cancelled = true;
    };
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
    return (candidates ?? []).filter((c) => (!onlySelected || required.has(c.wordId)) && (!q || c.word.toLowerCase().includes(q) || c.meaning.includes(q)));
  }, [candidates, wordQuery, onlySelected, required]);

  const poolSize = (candidates?.length ?? 0) - required.size;
  const effectivePick = hasSources ? Math.min(aiPick, Math.max(poolSize, 0)) : 0;
  const total = required.size + extraWords.length + effectivePick;
  const totalError = total < MIN_WORDS ? '至少要有 1 个词：勾选必用词、输入单词，或让 AI 挑词' : null;
  const sceneHint = useMemo(() => {
    const descriptions = (books ?? []).filter((b) => bookIds.includes(b.id) && b.description?.trim()).map((b) => b.description.trim());
    return descriptions.length > 0 ? `留空则按单词本场景：${descriptions.join('；')}` : '例如：在机场遇到航班延误；周末和朋友去野餐';
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
      .split(/[\s,，、;；]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    const bad = words.filter((w) => !isWord(w));
    if (bad.length > 0) return setError({ title: '无法添加单词', message: `「${bad.join('、')}」不是英文单词` });
    const existing = new Set([...extraWords, ...(candidates ?? []).filter((c) => required.has(c.wordId)).map((c) => c.word)].map((w) => w.toLowerCase()));
    setExtraWords((prev) => [...prev, ...words.filter((w) => !existing.has(w.toLowerCase()))]);
    setExtraDraft('');
    setError(null);
  };

  const baseRequest = (): GeneratePassageRequest => ({
    bookIds,
    planIds,
    planScopes: scopes,
    requiredWordIds: [...required],
    extraWords,
    aiPick: effectivePick,
    topic: scene.trim() || null,
    length,
  });

  /** 让 AI 给出内容规划（写几篇、每篇的构思与用词） */
  const makePlan = async (feedback?: string) => {
    setPlanning(true);
    setError(null);
    const result = await passageService.planPassages(baseRequest(), feedback);
    setPlanning(false);
    if (!result.success) return setError({ title: '无法生成内容规划', message: result.error });
    setPlanItems(result.data.items.map((item) => ({ ...item, include: true })));
    setPlanNote(result.data.note);
    setStatuses(null);
    setStep(3);
  };

  /** 写规划里的第 i 篇 */
  const writeItem = async (i: number, items: EditablePlanItem[]) => {
    setStatuses((prev) => prev && prev.map((st, j) => (j === i ? { state: 'running' } : st)));
    const { include: _include, ...item } = items[i];
    const result = await passageService.generatePassage({ ...baseRequest(), planItem: item });
    setStatuses((prev) => prev && prev.map((st, j) => (j === i ? (result.success ? { state: 'done', passageId: result.data.id } : { state: 'failed', error: result.error }) : st)));
    return result.success ? result.data.id : null;
  };

  /** 按规划逐篇生成（只生成勾选的）；只生成一篇且成功时直接打开它 */
  const generateAll = async () => {
    const items = planItems;
    const chosen = items.map((it, i) => (it.include ? i : -1)).filter((i) => i >= 0);
    setStatuses(items.map((it) => (it.include ? { state: 'waiting' } : { state: 'skipped' })));
    setError(null);
    let lastId: number | null = null;
    for (const i of chosen) lastId = (await writeItem(i, items)) ?? lastId;
    if (chosen.length === 1 && lastId != null) onNavigate?.('passage-detail', { passageId: lastId });
  };

  const selectedSources = [
    ...(books ?? []).filter((b) => bookIds.includes(b.id)).map((b) => ({ key: `b${b.id}`, icon: <BookOpen />, name: b.title })),
    ...(plans ?? []).filter((p) => planIds.includes(p.id)).map((p) => ({ key: `p${p.id}`, icon: <ListChecks />, name: `${p.name} · ${scopes.map((s) => PLAN_SCOPE_LABEL[s]).join('、')}` })),
  ];
  const includedCount = planItems.filter((it) => it.include).length;
  const writing = statuses !== null && statuses.some((st) => st.state === 'running' || st.state === 'waiting');
  const requiredWords = [...(candidates ?? []).filter((c) => required.has(c.wordId)).map((c) => c.word), ...extraWords];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-7">
      <PageHeader title="新建短文" description="选好词汇来源和单词，AI 先规划写几篇、每篇讲什么故事，你确认或修改后再逐篇写。写好后可以自由阅读、听读，也可以再出阅读理解题。" />
      <Stepper steps={STEPS} current={step} />

      {planning ? (
        <Card className="items-center gap-3 px-6 py-12 text-center" role="status">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent">
            <Loader2 className="size-6 animate-spin text-primary" />
          </span>
          <div className="font-medium">AI 正在规划内容…</div>
          <p className="max-w-md text-sm text-muted-foreground">决定写几篇、每篇讲什么故事、用哪些词，通常需要 20–40 秒。</p>
        </Card>
      ) : (
        <>
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-4">
                <SourcePicker
                  title="单词本"
                  icon={<BookOpen />}
                  items={books?.map((b) => ({ id: b.id, name: b.title, meta: `${b.total_words} 词` })) ?? null}
                  selected={bookIds}
                  onToggle={toggle(setBookIds)}
                  empty="还没有带单词的单词本"
                />
                <SourcePicker
                  title="学习计划"
                  icon={<ListChecks />}
                  items={plans?.map((p) => ({ id: p.id, name: p.name, meta: getStatusDisplay(p.unified_status as UnifiedStudyPlanStatus).text })) ?? null}
                  selected={planIds}
                  onToggle={toggle(setPlanIds)}
                  empty="还没有已发布的学习计划"
                />
              </div>
              {planIds.length > 0 && (
                <Card className="gap-3 px-5 py-4">
                  <div>
                    <h2 className="font-semibold">从计划里取哪些词</h2>
                    <p className="text-sm text-muted-foreground">按你在所选计划里的学习情况取词，可以多选（取并集）；只取已经学过的词。</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label="计划的取词策略">
                    {PLAN_SCOPES.map((s) => {
                      const count = countOf(s.value);
                      const on = scopes.includes(s.value);
                      return (
                        <Label
                          key={s.value}
                          className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 font-normal transition-colors hover:bg-muted/50', on && 'border-primary/60 bg-accent/40')}
                        >
                          <Checkbox checked={on} onCheckedChange={() => toggleScope(s.value)} className="mt-0.5" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="font-medium">{s.label}</span>
                              <span className={cn('text-xs tabular-nums', count === 0 ? 'text-muted-foreground' : 'text-foreground')}>{count == null ? '…' : `${count} 个`}</span>
                            </span>
                            <span className="block text-xs text-muted-foreground">{s.description}</span>
                          </span>
                        </Label>
                      );
                    })}
                  </div>
                </Card>
              )}
              <p className="text-sm text-muted-foreground">单词本和学习计划可以组合；也可以都不选，下一步直接输入单词。</p>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Card className="gap-3 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">必须出现的词</h2>
                    <p className="text-sm text-muted-foreground">勾选的词一定会写进短文。</p>
                  </div>
                  {hasSources && (
                    <>
                      <div className="relative w-56">
                        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={wordQuery} onChange={(e) => setWordQuery(e.target.value)} placeholder="搜索单词或释义" aria-label="搜索单词" className="pl-8" />
                      </div>
                      <Label className="font-normal">
                        <Checkbox checked={onlySelected} onCheckedChange={(v) => setOnlySelected(v === true)} />
                        只看已选
                      </Label>
                    </>
                  )}
                </div>
                {!hasSources ? (
                  <p className="rounded-md bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">没有选择来源，在下面输入要用的单词</p>
                ) : candidates === null ? (
                  <Skeleton className="h-48 rounded-md" />
                ) : candidates.length === 0 ? (
                  <p className="rounded-md bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">所选来源里没有符合条件的单词</p>
                ) : (
                  <div className="max-h-80 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead>单词</TableHead>
                          <TableHead>释义</TableHead>
                          <TableHead>来源</TableHead>
                          <TableHead className="text-right">短文里用过</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleWords.map((c) => (
                          <TableRow key={c.wordId} data-state={required.has(c.wordId) ? 'selected' : undefined} onClick={() => toggleWord(c.wordId)}>
                            <TableCell>
                              <Checkbox checked={required.has(c.wordId)} onCheckedChange={() => toggleWord(c.wordId)} onClick={(e) => e.stopPropagation()} aria-label={`必须出现：${c.word}`} />
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
                )}
                <div className="flex items-center gap-2">
                  <Input
                    value={extraDraft}
                    onChange={(e) => setExtraDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && extraDraft.trim() && addExtra()}
                    placeholder="再输入几个英文单词，多个用空格或逗号分开"
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

              <Card className="flex-row items-center gap-4 px-5 py-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                  <Sparkles className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">让 AI 按场景再挑几个词</h2>
                  <p className="text-sm text-muted-foreground">
                    {hasSources ? `AI 根据场景，从所选来源里（不含已勾选的 ${required.size} 个）挑能自然融进故事的词；合适的不够就少挑。` : '先在第一步选择单词本或学习计划，AI 才能从中挑词。'}
                  </p>
                </div>
                <Select value={String(hasSources ? aiPick : 0)} onValueChange={(v) => setAiPick(Number(v))} disabled={!hasSources}>
                  <SelectTrigger className="w-28" aria-label="AI 挑选的词数">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_PICK_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n === 0 ? '不挑' : `${n} 个`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Card>

              <p className={cn('text-right text-sm tabular-nums', totalError ? 'text-destructive' : 'text-muted-foreground')}>
                {totalError ?? `必用 ${required.size + extraWords.length} 个${effectivePick > 0 ? `，AI 最多再挑 ${effectivePick} 个` : ''}`}
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
              <Card className="gap-5 px-5 py-4">
                <div className="space-y-2">
                  <Label htmlFor="cp-scene">场景描述（可选）</Label>
                  <Textarea id="cp-scene" value={scene} maxLength={SCENE_MAX} onChange={(e) => setScene(e.target.value)} placeholder={sceneHint} className="min-h-28 resize-none" />
                  <p className="text-xs text-muted-foreground">
                    AI 按这个场景写短文、选词义{effectivePick > 0 ? '、挑词' : ''}。{scene.trim().length} / {SCENE_MAX}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>篇幅</Label>
                    <p className="mt-1 text-xs text-muted-foreground">短：一个小片段；标准：一个完整的小故事；长：更多细节和情节。语言难度按「设置 → AI 助手」里的学习者</p>
                  </div>
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
                    <div>不使用来源</div>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">必须出现（{requiredWords.length}）</div>
                  <div className="flex flex-wrap gap-1">
                    {requiredWords.length > 0 ? (
                      requiredWords.map((w) => (
                        <span key={w} className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                          {w}
                        </span>
                      ))
                    ) : (
                      <span>无</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">AI 按场景再挑</span>
                  <span>{effectivePick > 0 ? `最多 ${effectivePick} 个` : '不挑'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">篇幅</span>
                  <span>{LENGTHS.find((l) => l.value === length)?.label}</span>
                </div>
              </Card>
            </div>
          )}

          {step === 3 && (
            <PassagePlanEditor
              items={planItems}
              note={planNote}
              onChange={setPlanItems}
              onReplan={(feedback) => makePlan(feedback)}
              statuses={statuses}
              onOpen={(passageId) => onNavigate?.('passage-detail', { passageId })}
              onRetry={(i) => writeItem(i, planItems)}
            />
          )}
        </>
      )}

      {error && <InlineError title={error.title}>{error.message}</InlineError>}

      {!planning && (
        <div className="flex items-center gap-2 border-t pt-4">
          {statuses === null ? (
            <Button variant="ghost" onClick={() => onNavigate?.('passages')}>
              取消
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">
              {writing ? `正在逐篇写短文，每篇约 30–60 秒；可以离开这个页面，写好的会出现在短文库里` : '写好了，可以逐篇打开，也可以去短文库查看'}
            </span>
          )}
          <div className="flex-1" />
          {step > 0 && statuses === null && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft />
              上一步
            </Button>
          )}
          {step < 2 && (
            <Button onClick={() => setStep((s) => s + 1)} disabled={(step === 0 && planIds.length > 0 && scopes.length === 0) || (step === 1 && totalError !== null)}>
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
