import React, { useEffect, useState } from 'react';
import { Copy, FilePlus2, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

export type NewPlanStart = 'ai' | 'auto' | 'copy' | 'blank';

export interface NewPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 默认名字（规划 N） */
  defaultName: string;
  /** 当前规划有片段时才能复制 */
  canCopy: boolean;
  onConfirm: (name: string, start: NewPlanStart) => void;
}

const STARTS: { value: NewPlanStart; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'ai', label: 'AI 规划', icon: Sparkles },
  { value: 'auto', label: '按字幕自动切分', icon: Wand2 },
  { value: 'copy', label: '复制当前规划', icon: Copy },
  { value: 'blank', label: '自己划片段', icon: FilePlus2 },
];

/** 新建规划：起名字 + 选怎么开始，确认后直接进入下一步（AI 规划 / 自动切分的对话框，或复制、空白） */
export const NewPlanDialog: React.FC<NewPlanDialogProps> = ({ open, onOpenChange, defaultName, canCopy, onConfirm }) => {
  const [name, setName] = useState('');
  const [start, setStart] = useState<NewPlanStart>('ai');

  useEffect(() => {
    if (!open) return;
    setName('');
    setStart('ai');
  }, [open]);

  const confirm = () => onConfirm(name.trim() || defaultName, start);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建规划</DialogTitle>
          <DialogDescription className="sr-only">起名字并选择怎么开始</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">名字</Label>
            <Input id="plan-name" value={name} maxLength={30} placeholder={defaultName} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirm()} />
          </div>
          <RadioGroup value={start} onValueChange={(v) => setStart(v as NewPlanStart)} className="grid grid-cols-2 gap-2">
            {STARTS.map(({ value, label, icon: Icon }) => {
              const disabled = value === 'copy' && !canCopy;
              return (
                <Label
                  key={value}
                  htmlFor={`start-${value}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent',
                    disabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <RadioGroupItem id={`start-${value}`} value={value} disabled={disabled} className="sr-only" />
                  <Icon className="size-4 shrink-0" />
                  {label}
                </Label>
              );
            })}
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={confirm}>{start === 'ai' || start === 'auto' ? '下一步' : '新建'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
