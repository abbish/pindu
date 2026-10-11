import React, { useEffect, useRef, useState } from 'react';
import { Loader2, SlidersHorizontal, WandSparkles } from 'lucide-react';
import { AiWorking } from '@/components/AiWorking';
import { InlineError } from '@/components/InlineError';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useMaterialSettings } from '@/hooks/useMaterialSettings';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
import type { Passage, PickDifficulty, PickFrequency, PickStatus, TargetWordPick } from '@/types/passage';
import { PICK_DIFFICULTY_OPTIONS, PICK_FREQUENCY_OPTIONS, PICK_STATUS_OPTIONS } from '@/utils/passage';

/** 与新建短文「AI 选词」相同的数量选项 */
const COUNTS = [5, 8, 10, 15, 20];
const INSTRUCTION_MAX = 200;
const segmentItem = 'h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm';

/** 挑词条件（默认值来自「设置 → 素材」，与新建短文一致） */
interface Conditions {
  count: number;
  difficulty: PickDifficulty | 'any';
  frequency: PickFrequency | 'any';
  statuses: PickStatus[];
  instruction: string;
}

interface PickRow extends TargetWordPick {
  /** 现在就在词汇里 */
  current: boolean;
}

export interface RepickTargetWordsDialogProps {
  passage: Passage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存后的短文 */
  onSaved: (passage: Passage) => void;
}

/** 条件的一行：左侧标题，右侧控件 */
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-4">
    <Label className="w-16 shrink-0">{label}</Label>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{children}</div>
  </div>
);

/**
 * 重新挑选词汇：先设条件（数量 / 难度 / 词频 / 选词范围，与新建短文的「AI 选词」一致，另可写补充要求），
 * 再由 AI 从原文里挑；结果和现有词汇合成一张勾选表——建议的默认勾上，现有但没被建议的默认不勾；确认后整体替换。
 */
export const RepickTargetWordsDialog: React.FC<RepickTargetWordsDialogProps> = ({ passage, open, onOpenChange, onSaved }) => {
  const settings = useMaterialSettings();
  const [conditions, setConditions] = useState<Conditions>({ count: 10, difficulty: 'medium', frequency: 'common', statuses: [], instruction: '' });
  const [step, setStep] = useState<'form' | 'picking' | 'result'>('form');
  const [rows, setRows] = useState<PickRow[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 最近一次挑选的编号：关掉或改条件后，之前的结果不再写回 */
  const request = useRef(0);
  /** 来自词汇本 / 计划的短文才有「选词范围」（按学习情况筛词汇本里的词） */
  const hasSources = passage.sources.some((s) => s.kind === 'book' || s.kind === 'plan');

  useEffect(() => {
    if (!settings) return;
    setConditions((c) => ({
      ...c,
      count: COUNTS.includes(settings.passagePickCount) ? settings.passagePickCount : c.count,
      difficulty: settings.passagePickDifficulty,
      frequency: settings.passagePickFrequency,
    }));
  }, [settings]);

  // 每次打开从条件开始（保留上次填的条件）
  useEffect(() => {
    if (open) {
      setStep('form');
      setError(null);
    } else request.current++;
  }, [open]);

  const update = (patch: Partial<Conditions>) => setConditions((c) => ({ ...c, ...patch }));

  const pick = async () => {
    const id = ++request.current;
    setStep('picking');
    setError(null);
    const result = await passageService.suggestTargetWords({
      passageId: passage.id,
      count: conditions.count,
      difficulty: conditions.difficulty === 'any' ? undefined : conditions.difficulty,
      frequency: conditions.frequency === 'any' ? undefined : conditions.frequency,
      statuses: hasSources ? conditions.statuses : [],
      instruction: conditions.instruction.trim() || undefined,
    });
    if (id !== request.current) return;
    if (!result.success) {
      setError(result.error);
      setStep('form');
      return;
    }
    const key = (w: string) => w.toLowerCase();
    const suggested = new Set(result.data.map((s) => key(s.word)));
    const current = new Set(passage.targetWords.map((t) => key(t.word)));
    setRows([
      ...result.data.map((s) => ({ word: s.word, forms: s.forms, meaning: s.meaning, current: current.has(key(s.word)) })),
      ...passage.targetWords.filter((t) => !suggested.has(key(t.word))).map((t) => ({ word: t.word, forms: t.forms, meaning: t.meaning, current: true })),
    ]);
    setChecked(suggested);
    setStep('result');
  };

  const toggle = (word: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      const k = word.toLowerCase();
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    const words = rows.filter((r) => checked.has(r.word.toLowerCase())).map(({ word, forms, meaning }) => ({ word, forms, meaning }));
    const result = await passageService.setTargetWords(passage.id, words);
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onSaved(result.data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle>重新挑选词汇</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          {error && <InlineError title={step === 'result' ? '无法保存词汇' : '没能挑出词汇'}>{error}</InlineError>}

          {step === 'form' && (
            <>
              <Field label="数量">
                <Select value={String(conditions.count)} onValueChange={(v) => update({ count: Number(v) })}>
                  <SelectTrigger className="w-28" aria-label="数量">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        最多 {n} 个
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="难度">
                <ToggleGroup type="single" value={conditions.difficulty} onValueChange={(v) => v && update({ difficulty: v as Conditions['difficulty'] })} className="rounded-lg bg-muted p-0.5" aria-label="难度">
                  {PICK_DIFFICULTY_OPTIONS.map((d) => (
                    <ToggleGroupItem key={d.value} value={d.value} className={segmentItem}>
                      {d.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field label="词频">
                <ToggleGroup type="single" value={conditions.frequency} onValueChange={(v) => v && update({ frequency: v as Conditions['frequency'] })} className="rounded-lg bg-muted p-0.5" aria-label="词频">
                  {PICK_FREQUENCY_OPTIONS.map((f) => (
                    <ToggleGroupItem key={f.value} value={f.value} className={segmentItem}>
                      {f.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              {hasSources && (
                <Field label="选词范围">
                  <ToggleGroup type="multiple" value={conditions.statuses} onValueChange={(v) => update({ statuses: v as PickStatus[] })} className="rounded-lg bg-muted p-0.5" aria-label="选词范围">
                    {PICK_STATUS_OPTIONS.map((s) => (
                      <ToggleGroupItem key={s.value} value={s.value} className={segmentItem}>
                        {s.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
              )}
              <div className="space-y-2">
                <Label htmlFor="repick-instruction">补充要求</Label>
                <Textarea
                  id="repick-instruction"
                  value={conditions.instruction}
                  onChange={(e) => update({ instruction: e.target.value })}
                  maxLength={INSTRUCTION_MAX}
                  rows={3}
                  placeholder="例如：多挑和看病有关的词组；不要动物名称"
                />
              </div>
            </>
          )}

          {step === 'picking' && <AiWorking title="正在挑选词汇" />}

          {step === 'result' && (
            <ul className="divide-y rounded-lg border">
              {rows.map((r) => (
                <li key={r.word}>
                  <label className={cn('flex cursor-default items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50', saving && 'opacity-60')}>
                    <Checkbox checked={checked.has(r.word.toLowerCase())} disabled={saving} onCheckedChange={() => toggle(r.word)} aria-label={`选择 ${r.word}`} />
                    <span className="font-medium">{r.word}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.meaning}</span>
                    {r.current && (
                      <Badge variant="outline" className="shrink-0 font-normal">
                        现有
                      </Badge>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4 sm:justify-between">
          {step === 'result' ? (
            <Button variant="ghost" onClick={() => setStep('form')} disabled={saving}>
              <SlidersHorizontal />
              修改条件
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            {step === 'result' ? (
              <Button onClick={save} disabled={saving || checked.size === 0}>
                {saving && <Loader2 className="animate-spin" />}
                换成选中的 {checked.size} 个
              </Button>
            ) : (
              <Button onClick={() => void pick()} disabled={step === 'picking'}>
                {step === 'picking' ? <Loader2 className="animate-spin" /> : <WandSparkles />}
                开始挑选
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
