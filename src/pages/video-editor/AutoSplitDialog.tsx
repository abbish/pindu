import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { loadMaterialSettings } from '@/hooks/useMaterialSettings';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Cue, VideoSegment } from '@/types/video';
import { autoSplit } from './plan';

export interface AutoSplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cues: Cue[];
  durationMs: number;
  /** 已经有片段：提示会替换 */
  hasSegments: boolean;
  onApply: (segments: VideoSegment[]) => void;
}

/** 不用 AI 的自动切分：按字幕之间的停顿与每段时长范围，替换当前全部片段（可撤销） */
export const AutoSplitDialog: React.FC<AutoSplitDialogProps> = ({ open, onOpenChange, cues, durationMs, hasSegments, onApply }) => {
  const [minSec, setMinSec] = useState(30);
  const [maxSec, setMaxSec] = useState(120);
  // 每段时长默认值来自「设置 → 素材」
  useEffect(() => {
    if (!open) return;
    void loadMaterialSettings().then((st) => {
      if (st) {
        setMinSec(st.videoMinSeconds);
        setMaxSec(st.videoMaxSeconds);
      }
    });
  }, [open]);
  const valid = minSec >= 5 && maxSec >= minSec && maxSec <= 900;
  const preview = valid ? autoSplit(cues, durationMs, { minMs: minSec * 1000, maxMs: maxSec * 1000 }).length : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>按字幕自动切分</DialogTitle>
          <DialogDescription className="sr-only">在对话停顿处切开</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="split-min">每段至少（秒）</Label>
            <Input id="split-min" type="number" min={5} value={minSec} onChange={(e) => setMinSec(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="split-max">每段最多（秒）</Label>
            <Input id="split-max" type="number" min={5} max={900} value={maxSec} onChange={(e) => setMaxSec(Number(e.target.value))} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {valid ? `切成 ${preview} 段${hasSegments ? '，替换现有片段' : ''}` : '时长需在 5–900 秒之间'}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!valid || preview === 0}
            onClick={() => {
              onApply(autoSplit(cues, durationMs, { minMs: minSec * 1000, maxMs: maxSec * 1000 }));
              onOpenChange(false);
            }}
          >
            切分
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
