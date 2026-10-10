import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadMaterialSettings } from '@/hooks/useMaterialSettings';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { InlineError } from '@/components/InlineError';
import { videoService } from '@/services/videoService';
import { SuggestionChips, mergeSuggestions } from '@/components/SuggestionChips';

const MAX_TEXT = 500;

export interface AiPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: number;
  /** 写进哪个规划 */
  planId: number;
  /** 上次的要求 */
  requirements: string;
  /** 已经有片段：可以按意见修改 */
  hasSegments: boolean;
}

/** AI 规划切分：写要求与每段时长 → 后台任务；已有片段时可以只写意见，让 AI 在当前规划上改 */
export const AiPlanDialog: React.FC<AiPlanDialogProps> = ({ open, onOpenChange, videoId, planId, requirements, hasSegments }) => {
  const [mode, setMode] = useState<'new' | 'revise'>('new');
  const [text, setText] = useState(requirements);
  const [feedback, setFeedback] = useState('');
  const [minSec, setMinSec] = useState(30);
  const [maxSec, setMaxSec] = useState(120);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** AI 根据字幕给的要求建议：null 生成中 */
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  /** 已经写进要求里的建议（选中） */
  const picked = (suggestions ?? []).filter((s) => text.includes(s));
  /** 换一批：已选的留下，告诉 AI 给过哪些，新的一批接在后面 */
  const loadSuggestions = async (refresh: boolean) => {
    const shown = suggestions ?? [];
    const keep = shown.filter((s) => text.includes(s));
    setSuggestions(null);
    setSuggestError(null);
    const r = await videoService.suggestRequirements(videoId, refresh, refresh ? shown : []);
    if (r.success) setSuggestions(mergeSuggestions(keep, r.data));
    else {
      setSuggestions(shown);
      setSuggestError(r.error);
    }
  };

  // 第一次打开时生成（之后存在草稿里，直接读出来）
  useEffect(() => {
    if (open && suggestions === null && !suggestError) void loadSuggestions(false);
    // 只在打开时触发
  }, [open]);

  /** 点建议：没选的接到要求后面（可以组合几条），已选的从要求里去掉 */
  const toggleSuggestion = (s: string) =>
    setText((t) => {
      const cur = t.trim();
      if (cur.includes(s)) {
        return cur
          .split(s)
          .join('')
          .replace(/[，；;,]{2,}/g, '；')
          .replace(/^[，；;,\s]+|[，；;,\s]+$/g, '');
      }
      if (!cur) return s;
      return `${cur.replace(/[，。；,;]$/, '')}；${s}`.slice(0, MAX_TEXT);
    });

  useEffect(() => {
    if (!open) return;
    // 每段时长默认值来自「设置 → 素材」
    void loadMaterialSettings().then((st) => {
      if (st) {
        setMinSec(st.videoMinSeconds);
        setMaxSec(st.videoMaxSeconds);
      }
    });
    setText(requirements);
    setFeedback('');
    setError(null);
    setMode(hasSegments ? 'revise' : 'new');
  }, [open, requirements, hasSegments]);

  const valid = minSec >= 5 && maxSec >= minSec && maxSec <= 900 && (mode === 'new' || feedback.trim().length > 0);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await videoService.startPlan({
      videoId,
      planId,
      requirements: text.trim(),
      minSeconds: minSec,
      maxSeconds: maxSec,
      feedback: mode === 'revise' ? feedback.trim() : undefined,
    });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AI 规划切分</DialogTitle>
          <DialogDescription className="sr-only">按场景规划片段</DialogDescription>
        </DialogHeader>
        {hasSegments && (
          <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as 'new' | 'revise')} variant="outline" className="w-full">
            <ToggleGroupItem value="revise" className="flex-1">
              按意见修改当前规划
            </ToggleGroupItem>
            <ToggleGroupItem value="new" className="flex-1">
              重新规划
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        <div className="space-y-4">
          {mode === 'revise' ? (
            <div className="space-y-1.5">
              <Label htmlFor="plan-feedback">修改意见</Label>
              <Textarea id="plan-feedback" rows={3} maxLength={MAX_TEXT} value={feedback} placeholder="例如：第 3 段拆成两段" onChange={(e) => setFeedback(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="plan-req">要求</Label>
              <Textarea id="plan-req" rows={3} maxLength={MAX_TEXT} value={text} placeholder="例如：只要在餐厅里的对话" onChange={(e) => setText(e.target.value)} />
              <div className="flex items-start gap-1.5 pt-1 text-xs text-muted-foreground">
                <Sparkles className="mt-1 size-3.5 shrink-0" />
                <SuggestionChips
                  items={suggestions}
                  selected={picked}
                  onToggle={toggleSuggestion}
                  onMore={() => void loadSuggestions(true)}
                  error={suggestError}
                  loadingText="正在读字幕，想切分的建议…"
                />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-min">每段至少（秒）</Label>
              <Input id="plan-min" type="number" min={5} value={minSec} onChange={(e) => setMinSec(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-max">每段最多（秒）</Label>
              <Input id="plan-max" type="number" max={900} value={maxSec} onChange={(e) => setMaxSec(Number(e.target.value))} />
            </div>
          </div>
        </div>
        {error && <InlineError>{error}</InlineError>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={!valid || submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            开始规划
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
