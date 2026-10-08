import React, { useCallback, useEffect, useState } from 'react';
import { Info, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { InlineError } from '@/components/InlineError';
import { WordBookIcon } from '@/components/WordBookIcon/WordBookIcon';
import { WordBookSelector, type WordBookOption } from '@/components/WordBookSelector';
import { studyService } from '@/services/studyService';
import { passageService } from '@/services/passageService';
import { wordBookService } from '@/services/wordbookService';
import { formatDate } from '@/utils/datetime';
import { DAILY_NEW_WORDS_OPTIONS, DEFAULT_DAILY_NEW_WORDS } from '@/utils/planParams';
import type { PlanPaceResult, PracticeContent, StudyPlanWithProgress, UnifiedStudyPlanStatus } from '@/types';
import type { PlanPassage, PlanPassageCandidate } from '@/types/passage';
import {
  PASSAGE_INTERVAL_OPTIONS,
  PlanPassagePicker,
  intervalLabel,
  toPassageInputs,
  type PlanPassageDraft,
} from '@/components/PlanPassagePicker';

export interface PlanSettingsViewProps {
  /** 计划 */
  plan: StudyPlanWithProgress;
  /** 计划改动后刷新整页数据 */
  onChanged: () => Promise<void> | void;
  /** 删除计划（走页面统一的确认） */
  onDelete: () => void;
}

const EDITABLE: UnifiedStudyPlanStatus[] = ['Draft', 'Pending', 'Active', 'Paused'];

/** 计划里的短文 → 编辑态（题组从候选里取；已完成的锁定） */
const toDraft = (p: PlanPassage, candidates: Map<number, PlanPassageCandidate>): PlanPassageDraft => ({
  passageId: p.passageId,
  title: p.title,
  level: p.level,
  wordCount: p.wordCount,
  sets: candidates.get(p.passageId)?.sets ?? [],
  setId: p.setId,
  mode: p.mode,
  locked: p.status === 'completed',
  completedAt: p.completedAt,
});

const inputsKey = (items: PlanPassageDraft[]) => JSON.stringify(toPassageInputs(items));

const paceSummary = (r: PlanPaceResult) =>
  r.remainingNewWords === 0
    ? '没有还没学的新词'
    : `还没学的 ${r.remainingNewWords} 个新词 ${r.learningDays} 天学完${r.endDate ? `，预计 ${formatDate(r.endDate)} 结束` : ''}`;

/**
 * 计划「设置」页签（就地生效，不再转草稿；authoring-flows-redesign B5）：
 * 名称与描述；每天新词数（只重排还没练过的新词日，已学的单词、复习与练习记录不变）；单词本（列出 + 追加）；
 * 短文（练习内容、间隔、顺序与题组，整体保存，已完成的锁定；C4）；删除。
 */
export const PlanSettingsView: React.FC<PlanSettingsViewProps> = ({ plan, onChanged, onDelete }) => {
  const toast = useToast();
  const editable = EDITABLE.includes(plan.unified_status as UnifiedStudyPlanStatus);
  const started = plan.unified_status === 'Active' || plan.unified_status === 'Paused';

  // 名称与描述
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? '');
  const [savingInfo, setSavingInfo] = useState(false);
  useEffect(() => {
    setName(plan.name);
    setDescription(plan.description ?? '');
  }, [plan.name, plan.description]);
  const infoDirty = name.trim() !== plan.name || description.trim() !== (plan.description ?? '');

  const nameMissing = !name.trim();

  const saveInfo = async () => {
    if (nameMissing) return;
    setSavingInfo(true);
    const result = await studyService.updateStudyPlanBasicInfo(plan.id, { name: name.trim(), description: description.trim() });
    setSavingInfo(false);
    if (!result.success) {
      toast.showError('无法保存计划信息', result.error);
      return;
    }
    toast.showSuccess('已保存计划信息');
    await onChanged();
  };

  // 每天新词数
  const currentPace = plan.daily_new_words || DEFAULT_DAILY_NEW_WORDS;
  const [pace, setPace] = useState(currentPace);
  const [savingPace, setSavingPace] = useState(false);
  useEffect(() => setPace(currentPace), [currentPace]);

  const applyPace = async () => {
    setSavingPace(true);
    const result = await studyService.replanStudyPlanPace(plan.id, pace);
    setSavingPace(false);
    if (!result.success) {
      toast.showError('无法调整学习节奏', result.error);
      return;
    }
    toast.showSuccess(`已改为每天 ${pace} 个新词`, paceSummary(result.data));
    await onChanged();
  };

  // 单词本
  const [books, setBooks] = useState<WordBookOption[]>([]);
  const [planBookIds, setPlanBookIds] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<number[]>([]);
  const [savingBooks, setSavingBooks] = useState(false);
  const [addBooksError, setAddBooksError] = useState<string | null>(null);

  const loadBooks = async () => {
    const [all, inPlan] = await Promise.all([wordBookService.getAllWordBooks(), studyService.getStudyPlanWordBooks(plan.id)]);
    if (all.success) {
      setBooks(
        all.data
          .filter((b) => b.status === 'normal' && b.total_words > 0)
          .map((b) => ({ id: b.id, name: b.title, description: b.description, wordCount: b.total_words, icon: b.icon, color: b.icon_color }))
      );
    }
    if (inPlan.success) setPlanBookIds(inPlan.data);
  };
  useEffect(() => {
    loadBooks();
  }, [plan.id, plan.total_words]);

  const planBooks = books.filter((b) => planBookIds.includes(b.id));
  const addableBooks = books.filter((b) => !planBookIds.includes(b.id));

  const addBooks = async () => {
    if (toAdd.length === 0) return;
    setSavingBooks(true);
    setAddBooksError(null);
    const result = await studyService.addWordBooksToPlan(plan.id, toAdd);
    setSavingBooks(false);
    if (!result.success) {
      setAddBooksError(result.error);
      return;
    }
    toast.showSuccess(`已追加 ${result.data.addedWords} 个新词`, paceSummary(result.data));
    setAdding(false);
    setToAdd([]);
    await onChanged();
  };

  // 练习内容与短文（完整顺序整体保存；已完成的短文锁定）
  const hasWords = plan.total_words > 0;
  const [content, setContent] = useState<PracticeContent>(plan.practice_content);
  const [interval, setIntervalDays] = useState(plan.passage_interval_days);
  const [passageDrafts, setPassageDrafts] = useState<PlanPassageDraft[]>([]);
  const [savedKey, setSavedKey] = useState('[]');
  const [passageCandidates, setPassageCandidates] = useState<PlanPassageCandidate[] | null>(null);
  const [savingPassages, setSavingPassages] = useState(false);

  const loadPassages = useCallback(async () => {
    const [items, cands] = await Promise.all([passageService.getPlanPassages(plan.id), passageService.getPlanPassageCandidates({ planId: plan.id })]);
    const byId = new Map((cands.success ? cands.data : []).map((c) => [c.passage.id, c]));
    setPassageCandidates(cands.success ? cands.data : []);
    if (!cands.success) toast.showError('无法加载短文库', cands.error);
    if (items.success) {
      const drafts = items.data.map((p) => toDraft(p, byId));
      setPassageDrafts(drafts);
      setSavedKey(inputsKey(drafts));
    } else {
      toast.showError('无法加载计划里的短文', items.error);
    }
  }, [plan.id, toast]);

  useEffect(() => {
    setContent(plan.practice_content);
    setIntervalDays(plan.passage_interval_days);
    loadPassages();
  }, [plan.practice_content, plan.passage_interval_days, plan.total_passages, plan.completed_passages, loadPassages]);

  const hasCompletedPassages = passageDrafts.some((d) => d.locked);
  const passagesOn = content !== 'words';
  const passagesDirty =
    content !== plan.practice_content || (passagesOn && (interval !== plan.passage_interval_days || inputsKey(passageDrafts) !== savedKey));
  const passagesMissing = passagesOn && passageDrafts.length === 0;

  const resetPassages = () => {
    setContent(plan.practice_content);
    setIntervalDays(plan.passage_interval_days);
    loadPassages();
  };

  const applyPassages = async () => {
    if (passagesMissing) return;
    setSavingPassages(true);
    const result = await passageService.setPlanPassages({
      planId: plan.id,
      practiceContent: content,
      passages: passagesOn ? toPassageInputs(passageDrafts) : [],
      intervalDays: interval,
    });
    setSavingPassages(false);
    if (!result.success) {
      toast.showError('无法保存短文安排', result.error);
      return;
    }
    toast.showSuccess(passagesOn ? '已更新短文安排' : '已改为只练单词', passagesOn ? `${passageDrafts.length} 篇，${intervalLabel(interval)}` : undefined);
    await onChanged();
  };

  return (
    <div className="flex w-full flex-col gap-8">
      {!editable && (
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          计划已结束，重新学习后才能修改
        </p>
      )}

      <SettingsSection title="基本信息">
        <SettingsRow label="计划名称" htmlFor="ps-name" columns>
          <Input id="ps-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-invalid={nameMissing} />
          {nameMissing && <p className="text-sm text-destructive">请填写计划名称</p>}
        </SettingsRow>
        <SettingsRow label="描述" htmlFor="ps-desc" columns>
          <Textarea id="ps-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="学习目标或备注" className="min-h-16 resize-none" />
        </SettingsRow>
        {infoDirty && (
          <div className="flex justify-end gap-2 px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setName(plan.name);
                setDescription(plan.description ?? '');
              }}
              disabled={savingInfo}
            >
              还原
            </Button>
            <Button size="sm" onClick={saveInfo} disabled={savingInfo || nameMissing}>
              {savingInfo && <Loader2 className="animate-spin" />}
              保存
            </Button>
          </div>
        )}
      </SettingsSection>

      {hasWords && (
        <SettingsSection title="学习节奏">
          <SettingsRow label="每天学几个新词" columns>
            <ToggleGroup
              type="single"
              value={String(pace)}
              onValueChange={(v) => v && setPace(Number(v))}
              className="w-full max-w-xl rounded-lg bg-muted p-0.5"
              disabled={!editable || savingPace}
              aria-label="每天新词数"
            >
              {DAILY_NEW_WORDS_OPTIONS.map((o) => (
                <ToggleGroupItem key={o.value} value={String(o.value)} className="h-8 flex-1 rounded-md data-[state=on]:bg-background data-[state=on]:shadow-sm">
                  {o.value}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingsRow>
          {pace !== currentPace && (
            <div className="flex items-center gap-3 bg-accent/30 px-4 py-3">
              <p className="flex-1 text-sm">
                每天 {currentPace} 个 → <strong>{pace}</strong> 个，没学的新词{started ? '从今天起' : ''}重新排日程
              </p>
              <Button variant="ghost" size="sm" onClick={() => setPace(currentPace)} disabled={savingPace}>
                取消
              </Button>
              <Button size="sm" onClick={applyPace} disabled={savingPace}>
                {savingPace && <Loader2 className="animate-spin" />}
                应用
              </Button>
            </div>
          )}
        </SettingsSection>
      )}

      <SettingsSection
        title="单词本"
        actions={
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={!editable || addableBooks.length === 0}>
            <Plus />
            追加单词本
          </Button>
        }
      >
        {!hasWords ? (
          <SettingsRow label="还没有单词本" />
        ) : planBooks.length === 0 ? (
          <SettingsRow label="没有找到计划的单词本" description="单词本可能已被删除" />
        ) : (
          planBooks.map((b) => <SettingsRow key={b.id} icon={<WordBookIcon icon={b.icon} color={b.color} />} label={b.name} description={`${b.wordCount} 个单词`} />)
        )}
      </SettingsSection>

      <SettingsSection
        title="短文"
      >
        {hasWords && (
          <SettingsRow label="练习内容" description={hasCompletedPassages ? '已完成过短文，不能改回只练单词' : undefined} columns>
            <ToggleGroup
              type="single"
              value={content}
              onValueChange={(v) => v && setContent(v as PracticeContent)}
              className="rounded-lg bg-muted p-0.5"
              disabled={!editable || savingPassages}
              aria-label="练习内容"
            >
              <ToggleGroupItem value="words" disabled={hasCompletedPassages} className="h-8 rounded-md px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm">
                只练单词
              </ToggleGroupItem>
              <ToggleGroupItem value="both" className="h-8 rounded-md px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm">
                单词 + 短文
              </ToggleGroupItem>
            </ToggleGroup>
          </SettingsRow>
        )}
        {passagesOn && (
          <>
            <SettingsRow label="多久一篇" columns>
              <ToggleGroup
                type="single"
                value={String(interval)}
                onValueChange={(v) => v && setIntervalDays(Number(v))}
                className="rounded-lg bg-muted p-0.5"
                disabled={!editable || savingPassages}
                aria-label="短文间隔"
              >
                {Array.from(new Set([...PASSAGE_INTERVAL_OPTIONS, plan.passage_interval_days]))
                  .sort((a, b) => a - b)
                  .map((d) => (
                    <ToggleGroupItem key={d} value={String(d)} className="h-8 rounded-md px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm">
                      {d === 1 ? '每天' : `${d} 天`}
                    </ToggleGroupItem>
                  ))}
              </ToggleGroup>
            </SettingsRow>
            <SettingsRow label="短文顺序" columns>
              <PlanPassagePicker
                items={passageDrafts}
                onChange={setPassageDrafts}
                candidates={passageCandidates}
                overlapLabel="计划单词"
                alignEnd
                disabled={!editable || savingPassages}
              />
              {passagesMissing && <p className="text-sm text-destructive">至少要有一篇短文{hasWords ? '，或改回只练单词' : ''}</p>}
            </SettingsRow>
          </>
        )}
        {passagesDirty && (
          <div className="flex items-center gap-3 bg-accent/30 px-4 py-3">
            <p className="flex-1 text-sm">{started ? '应用后，没完成的短文会重新排期' : '短文安排有改动'}</p>
            <Button variant="ghost" size="sm" onClick={resetPassages} disabled={savingPassages}>
              还原
            </Button>
            <Button size="sm" onClick={applyPassages} disabled={savingPassages || passagesMissing}>
              {savingPassages && <Loader2 className="animate-spin" />}
              应用
            </Button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="删除" tone="danger">
        <SettingsRow label="删除这个计划" description="计划和全部练习记录会被删除，不能恢复；单词本不受影响">
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 />
            删除…
          </Button>
        </SettingsRow>
      </SettingsSection>

      <Dialog
        open={adding}
        onOpenChange={(open) => {
          if (open || savingBooks) return;
          setAdding(false);
          setAddBooksError(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>追加单词本</DialogTitle>
            <DialogDescription>新单词按每天 {currentPace} 个排在没学的新词后面</DialogDescription>
          </DialogHeader>
          <WordBookSelector books={addableBooks} selectedBooks={toAdd} onSelectionChange={setToAdd} />
          {addBooksError && <InlineError title="无法追加单词本">{addBooksError}</InlineError>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)} disabled={savingBooks}>
              取消
            </Button>
            <Button onClick={addBooks} disabled={savingBooks || toAdd.length === 0}>
              {savingBooks && <Loader2 className="animate-spin" />}
              追加 {toAdd.length > 0 ? `${toAdd.length} 本` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
