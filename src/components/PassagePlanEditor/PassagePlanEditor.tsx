import React from 'react';
import { Check, FileText, Loader2, RotateCw, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { PassageLength, PassagePlanItem } from '@/types/passage';

/** 规划里的一篇（加上“是否生成”） */
export interface EditablePlanItem extends PassagePlanItem {
  include: boolean;
}

/** 逐篇生成的状态 */
export type PlanItemStatus = { state: 'skipped' } | { state: 'waiting' } | { state: 'running' } | { state: 'done'; passageId: number } | { state: 'failed'; error: string };

export interface PassagePlanEditorProps {
  items: EditablePlanItem[];
  note: string;
  onChange: (items: EditablePlanItem[]) => void;
  /** 重新规划（带调整意见） */
  onReplan: (feedback: string) => void;
  /** 生成中 / 生成后的逐篇状态（null = 还在编辑） */
  statuses: PlanItemStatus[] | null;
  onOpen: (passageId: number) => void;
  onRetry: (index: number) => void;
  disabled?: boolean;
}

const LENGTHS: { value: PassageLength; label: string }[] = [
  { value: 'short', label: '短' },
  { value: 'standard', label: '标准' },
  { value: 'long', label: '长' },
];
const segmentItem = 'h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm';
const FEEDBACK_EXAMPLES = ['合成一篇', '拆成两篇', '情节再有趣一点', '换一个主角'];

/**
 * 内容规划（新建短文最后一步）：AI 的说明 + 每篇的标题、构思、篇幅与用词（可改、可不生成），
 * 写一句调整意见重新规划；确认后逐篇生成，显示每篇的状态。
 */
export const PassagePlanEditor: React.FC<PassagePlanEditorProps> = ({ items, note, onChange, onReplan, statuses, onOpen, onRetry, disabled }) => {
  const [feedback, setFeedback] = React.useState('');
  const update = (i: number, patch: Partial<EditablePlanItem>) => onChange(items.map((item, j) => (j === i ? { ...item, ...patch } : item)));
  const locked = disabled || statuses !== null;

  return (
    <div className="flex flex-col gap-4">
      {note && (
        <div className="flex items-start gap-3 rounded-xl border bg-accent/40 px-5 py-4">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">AI 的规划：{items.length} 篇</div>
            <p className="text-sm text-muted-foreground select-text">{note}</p>
          </div>
        </div>
      )}

      {items.map((item, i) => {
        const status = statuses?.[i];
        return (
          <Card key={i} className={cn('gap-3 px-5 py-4', !item.include && 'opacity-60')}>
            <div className="flex items-center gap-3">
              <Checkbox checked={item.include} onCheckedChange={(v) => update(i, { include: v === true })} disabled={locked} aria-label={`生成第 ${i + 1} 篇`} />
              <span className="shrink-0 text-sm text-muted-foreground">第 {i + 1} 篇</span>
              <Input value={item.title} onChange={(e) => update(i, { title: e.target.value })} disabled={locked} aria-label="标题" className="h-8 flex-1 font-medium" />
              <ToggleGroup type="single" value={item.length} onValueChange={(v) => v && update(i, { length: v as PassageLength })} disabled={locked} className="rounded-lg bg-muted p-0.5" aria-label="篇幅">
                {LENGTHS.map((l) => (
                  <ToggleGroupItem key={l.value} value={l.value} className={segmentItem}>
                    {l.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {status && (
                <span className="flex shrink-0 items-center gap-1.5 text-sm">
                  {status.state === 'skipped' && <span className="text-muted-foreground">不生成</span>}
                  {status.state === 'waiting' && <span className="text-muted-foreground">等待</span>}
                  {status.state === 'running' && (
                    <>
                      <Loader2 className="size-4 animate-spin text-primary" />
                      正在写…
                    </>
                  )}
                  {status.state === 'done' && (
                    <>
                      <Check className="size-4 text-success" />
                      <Button variant="outline" size="sm" className="h-7" onClick={() => onOpen(status.passageId)}>
                        <FileText />
                        打开
                      </Button>
                    </>
                  )}
                  {status.state === 'failed' && (
                    <>
                      <X className="size-4 text-destructive" />
                      <Button variant="outline" size="sm" className="h-7" onClick={() => onRetry(i)}>
                        <RotateCw />
                        重试
                      </Button>
                    </>
                  )}
                </span>
              )}
            </div>
            {status?.state === 'failed' && <p className="text-sm text-destructive">无法生成：{status.error}</p>}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">故事构思</Label>
              <Textarea value={item.idea} onChange={(e) => update(i, { idea: e.target.value })} disabled={locked} rows={4} className="resize-none text-sm" />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-muted-foreground">用到的词（{item.words.length}）</span>
              {item.words.map((w) => (
                <Badge key={w.word} variant={w.required ? 'default' : 'secondary'} className={cn('font-normal', w.required && 'bg-accent text-accent-foreground')} title={w.required ? '必用词' : 'AI 按场景挑选'}>
                  {w.word}
                </Badge>
              ))}
            </div>
          </Card>
        );
      })}

      {statuses === null && (
        <Card className="gap-3 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">不满意？让 AI 重新规划</h2>
            <p className="text-xs text-muted-foreground">写一句你想怎么调整，也可以直接改上面的标题和构思。</p>
          </div>
          <div className="flex gap-2">
            <Input
              value={feedback}
              maxLength={200}
              disabled={disabled}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && feedback.trim() && onReplan(feedback.trim())}
              placeholder="例如：合成一篇，主角换成一只小狗"
              aria-label="调整意见"
            />
            <Button variant="outline" onClick={() => onReplan(feedback.trim())} disabled={disabled}>
              <RotateCw />
              重新规划
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FEEDBACK_EXAMPLES.map((ex) => (
              <Button key={ex} variant="secondary" size="sm" className="h-7 rounded-full px-3 text-xs font-normal" disabled={disabled} onClick={() => setFeedback(ex)}>
                {ex}
              </Button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
