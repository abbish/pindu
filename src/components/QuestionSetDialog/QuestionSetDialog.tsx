import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/InlineError';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useMaterialSettings } from '@/hooks/useMaterialSettings';
import { passageService } from '@/services/passageService';
import { DIFFICULTY_LABEL } from '@/utils/passage';
import type { QuestionDifficulty, QuestionSetSpec } from '@/types/passage';

export interface QuestionSetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  passageId: number;
  /** 短文的英语水平（决定默认题量与难度） */
  level: string;
  /** 已有题组数（默认名称“第 N 套”） */
  existingSets: number;
  /** 生成成功（关闭弹窗后仍在生成的，完成时也会回调） */
  onStarted: (jobId: string) => void;
}

type CountKey = 'cloze' | 'choice' | 'trueFalse' | 'open';

const TYPES: { key: CountKey; label: string; max: number }[] = [
  { key: 'cloze', label: '选词填空', max: 8 },
  { key: 'choice', label: '选择题', max: 6 },
  { key: 'trueFalse', label: '判断题', max: 5 },
  { key: 'open', label: '开放题', max: 2 },
];
const DIFFICULTIES: QuestionDifficulty[] = ['basic', 'standard', 'advanced'];

/** 默认题量与难度：按短文的英语水平 */
export function defaultSpec(level: string): QuestionSetSpec {
  if (level === 'a1') return { cloze: 4, choice: 2, trueFalse: 3, open: 1, difficulty: 'basic' };
  if (level === 'a2') return { cloze: 5, choice: 3, trueFalse: 2, open: 1, difficulty: 'standard' };
  return { cloze: 6, choice: 4, trueFalse: 2, open: 1, difficulty: 'standard' };
}

/**
 * 生成题组（Dialog 表单）：每种题型的数量、难度、题组名称 → AI 出一套题。
 * 生成中可以关闭弹窗，完成后题组出现在「阅读理解」页签。
 */
export const QuestionSetDialog: React.FC<QuestionSetDialogProps> = ({ isOpen, onClose, passageId, level, existingSets, onStarted }) => {
  const [spec, setSpec] = useState<QuestionSetSpec>(() => defaultSpec(level));
  const [name, setName] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materialSettings = useMaterialSettings();
  useEffect(() => {
    if (!isOpen) return;
    // 题量按短文水平；难度可在「设置 → 素材」固定
    const spec = defaultSpec(level);
    const difficulty = materialSettings?.questionDifficulty;
    setSpec(difficulty && difficulty !== 'auto' ? { ...spec, difficulty } : spec);
    setName('');
    setError(null);
  }, [isOpen, level, materialSettings]);

  const total = spec.cloze + spec.choice + spec.trueFalse + spec.open;

  /** 出题是后台任务：提交后关闭弹窗，进度在页面和顶栏任务按钮里 */
  const generate = async () => {
    setStarting(true);
    setError(null);
    const result = await passageService.startQuestionSetGeneration({ passageId, name: name.trim() || null, spec });
    setStarting(false);
    if (result.success) {
      onStarted(result.data);
      onClose();
    } else {
      setError(result.error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>生成题组</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col divide-y rounded-lg border">
            {TYPES.map((t) => (
              <div key={t.key} className="flex items-center gap-4 px-3 py-2.5">
                <div className="min-w-0 flex-1 text-sm font-medium">{t.label}</div>
                <Select value={String(spec[t.key])} onValueChange={(v) => setSpec((s) => ({ ...s, [t.key]: Number(v) }))} disabled={starting}>
                  <SelectTrigger className="w-24" aria-label={`${t.label}数量`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: t.max + 1 }, (_, n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n === 0 ? '0' : `${n} ${t.key === 'cloze' ? '空' : '道'}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label>难度</Label>
            <ToggleGroup
              type="single"
              value={spec.difficulty}
              onValueChange={(v) => v && setSpec((s) => ({ ...s, difficulty: v as QuestionDifficulty }))}
              className="rounded-lg bg-muted p-0.5"
              aria-label="难度"
              disabled={starting}
            >
              {DIFFICULTIES.map((d) => (
                <ToggleGroupItem key={d} value={d} className="h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm">
                  {DIFFICULTY_LABEL[d]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qs-name">题组名称</Label>
            <Input id="qs-name" value={name} maxLength={30} disabled={starting} onChange={(e) => setName(e.target.value)} placeholder={`第 ${existingSets + 1} 套`} />
          </div>

          {error && <InlineError title="无法生成题组">{error}</InlineError>}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground">{total === 0 ? '请至少选择一种题型' : `共 ${total} 题`}</span>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={generate} disabled={starting || total === 0}>
            {starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            生成题组
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
