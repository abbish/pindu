import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/InlineError';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { passageService } from '@/services/passageService';
import { DIFFICULTY_LABEL } from '@/utils/passage';
import type { QuestionDifficulty, QuestionSet, QuestionSetSpec } from '@/types/passage';

export interface QuestionSetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  passageId: number;
  /** 短文的英语水平（决定默认题量与难度） */
  level: string;
  /** 已有题组数（默认名称“第 N 套”） */
  existingSets: number;
  /** 生成成功（关闭弹窗后仍在生成的，完成时也会回调） */
  onGenerated: (set: QuestionSet) => void;
}

type CountKey = 'cloze' | 'choice' | 'trueFalse' | 'open';

const TYPES: { key: CountKey; label: string; description: string; max: number }[] = [
  { key: 'cloze', label: '选词填空', description: '在原文里挖空，从词库里选词填回（听力模式不考）', max: 8 },
  { key: 'choice', label: '选择题', description: '细节、主旨、推断或猜词义', max: 6 },
  { key: 'trueFalse', label: '判断题', description: '判断一句话与原文是否相符', max: 5 },
  { key: 'open', label: '开放题', description: '用英文回答，AI 按评分要点打分并写评语', max: 2 },
];
const DIFFICULTIES: QuestionDifficulty[] = ['basic', 'standard', 'advanced'];

/** 默认题量与难度：按短文的英语水平 */
export function defaultSpec(level: string): QuestionSetSpec {
  if (level === 'a1') return { cloze: 4, choice: 2, trueFalse: 3, open: 1, difficulty: 'basic' };
  if (level === 'a2') return { cloze: 5, choice: 3, trueFalse: 2, open: 1, difficulty: 'standard' };
  return { cloze: 6, choice: 4, trueFalse: 2, open: 1, difficulty: 'standard' };
}

/**
 * 生成阅读理解题（Dialog 表单）：每种题型的数量、难度、题组名称 → AI 出一套题（15–40 秒）。
 * 生成中可以关闭弹窗，完成后题组出现在「阅读理解」页签。
 */
export const QuestionSetDialog: React.FC<QuestionSetDialogProps> = ({ isOpen, onClose, passageId, level, existingSets, onGenerated }) => {
  const [spec, setSpec] = useState<QuestionSetSpec>(() => defaultSpec(level));
  const [name, setName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && !generating) {
      setSpec(defaultSpec(level));
      setName('');
      setError(null);
    }
    // 只在打开时重置；生成中重新打开保持进度
  }, [isOpen, level]);

  const total = spec.cloze + spec.choice + spec.trueFalse + spec.open;

  const generate = async () => {
    setGenerating(true);
    setError(null);
    const result = await passageService.generateQuestionSet({ passageId, name: name.trim() || null, spec });
    setGenerating(false);
    if (result.success) {
      onGenerated(result.data);
      onClose();
    } else {
      setError(result.error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>生成阅读理解题</DialogTitle>
          <DialogDescription>AI 根据这篇短文出一套题。一篇短文可以有多套题，每套可以选不同的题型和难度。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col divide-y rounded-lg border">
            {TYPES.map((t) => (
              <div key={t.key} className="flex items-center gap-4 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                </div>
                <Select value={String(spec[t.key])} onValueChange={(v) => setSpec((s) => ({ ...s, [t.key]: Number(v) }))} disabled={generating}>
                  <SelectTrigger className="w-24" aria-label={`${t.label}数量`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: t.max + 1 }, (_, n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n === 0 ? '不出' : `${n} ${t.key === 'cloze' ? '空' : '道'}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>难度</Label>
              <p className="mt-1 text-xs text-muted-foreground">基础考原文细节；提高加入推断与猜词义</p>
            </div>
            <ToggleGroup
              type="single"
              value={spec.difficulty}
              onValueChange={(v) => v && setSpec((s) => ({ ...s, difficulty: v as QuestionDifficulty }))}
              className="rounded-lg bg-muted p-0.5"
              aria-label="难度"
              disabled={generating}
            >
              {DIFFICULTIES.map((d) => (
                <ToggleGroupItem key={d} value={d} className="h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm">
                  {DIFFICULTY_LABEL[d]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qs-name">名称</Label>
            <Input id="qs-name" value={name} maxLength={30} disabled={generating} onChange={(e) => setName(e.target.value)} placeholder={`第 ${existingSets + 1} 套`} />
          </div>

          {generating && (
            <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" />
              AI 正在出题，通常需要 15–40 秒。可以先关闭窗口，生成好后会出现在「阅读理解」里。
            </p>
          )}
          {error && <InlineError title="无法生成题目">{error}</InlineError>}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground">{total === 0 ? '至少选一种题型' : `共 ${total} 题`}</span>
          <Button variant="outline" onClick={onClose}>
            {generating ? '关闭' : '取消'}
          </Button>
          <Button onClick={generate} disabled={generating || total === 0}>
            {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
            生成题目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
