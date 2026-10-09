import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleAlert,
  Loader2,
  Magnet,
  Merge,
  Pause,
  Play,
  Redo2,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageError } from '@/components/PageError';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { videoService } from '@/services/videoService';
import { jobService } from '@/services/jobService';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { isJobActive } from '@/types/job';
import { JobIndicator, jobErrorText } from '@/components/Jobs';
import type { NavigateFn } from '@/navigation';
import type { VideoDetail, VideoPlan, VideoPlanInfo, VideoSegment } from '@/types/video';
import { AiPlanDialog } from './AiPlanDialog';
import { PlanMenu, SubtitleMenu } from './EditorMenus';
import { AutoSplitDialog } from './AutoSplitDialog';
import { EditorBusyDialog } from './EditorBusyDialog';
import { SegmentPanel } from './SegmentPanel';
import { SubtitleOffsetControl } from './SubtitleOffsetControl';
import { tagService } from '@/services/tagService';
import {
  ISSUE_TEXT,
  addSegment,
  cueBoundaries,
  cuesIn,
  mergeWithNext,
  moveEdge,
  pushHistory,
  redo,
  removeSegment,
  segmentAt,
  segmentIssues,
  segmentThumb,
  splitAt,
  undo,
  type History,
} from './plan';
import { formatClock } from './time';
import { Timeline } from './Timeline';

export interface VideoEditorPageProps {
  videoId?: number;
  onNavigate?: NavigateFn;
}

const MIN_ZOOM = 2;
const MAX_ZOOM = 200;
/** 逐帧移动的步长（按 25fps 估） */
const FRAME_MS = 40;
const AUTOSAVE_MS = 800;

/** 每个视频上次在编辑的规划（本机） */
const LAST_PLAN_KEY = (videoId?: number) => `videoEditor.plan.${videoId}`;
const readLastPlan = (videoId?: number) => {
  try {
    return localStorage.getItem(LAST_PLAN_KEY(videoId));
  } catch {
    return null;
  }
};
const writeLastPlan = (videoId: number | undefined, planId: number) => {
  try {
    localStorage.setItem(LAST_PLAN_KEY(videoId), String(planId));
  } catch {
    // 存不了只是下次从第一个规划开始
  }
};
/** 吸附距离：屏幕上 8px 对应的时长 */
const SNAP_PX = 8;

type SaveState = 'saved' | 'saving' | 'error';

/** 输入框里按键不触发快捷键 */
const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.getAttribute('role') === 'combobox');
};

/**
 * 剪辑编辑器（整窗页面）：左侧片段列表、中间预览播放器（字幕叠加，可只播当前片段）、右侧片段属性；
 * 底部时间轴（刻度、缩略图、波形、字幕轨、片段轨），边界拖动默认吸附到字幕边界（按住 ⌥ 自由拖动）。
 * 规划草稿自动保存；撤销 / 重做；快捷键：空格 播放、J/K/L、←/→ 逐帧（⇧ 一秒）、I/O 入点出点、N 用入出点新建、S 拆分、M 合并、Delete 删除、⌘Z / ⇧⌘Z、+/- 缩放、Enter 播放当前片段。
 */
export const VideoEditorPage: React.FC<VideoEditorPageProps> = ({ videoId, onNavigate }) => {
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [history, setHistory] = useState<History | null>(null);
  /** 正在编辑的规划（一个视频可以有多个） */
  const [planId, setPlanId] = useState<number | null>(null);
  /** 拖动边界时的实时规划（松开后进撤销栈） */
  const [live, setLive] = useState<VideoPlan | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopSegment, setLoopSegment] = useState(true);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(20);
  const [rate, setRate] = useState(1);
  const [marks, setMarks] = useState<{ in: number | null; out: number | null }>({ in: null, out: null });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [autoSplitOpen, setAutoSplitOpen] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [aiPlanOpen, setAiPlanOpen] = useState(false);
  // 这个视频正在跑的规划 / 切分任务（离开编辑器再回来也能看到）
  const jobs = useJobs();
  const activeJob = (kind: string) =>
    jobs.find((j) => j.kind === kind && isJobActive(j) && (j.link?.params as { videoId?: number } | undefined)?.videoId === videoId);
  const planJob = activeJob('video_plan');
  const processJob = activeJob('video_process');
  // 翻译：整部（导入时自动启动或顶栏发起）与某一段（片段面板发起）可以同时进行
  const translateJobs = jobs.filter(
    (j) => j.kind === 'video_translate' && isJobActive(j) && (j.link?.params as { videoId?: number } | undefined)?.videoId === videoId
  );
  const rangeOf = (j: (typeof jobs)[number]) => j.link?.params as { startMs?: number | null; endMs?: number | null } | undefined;
  const wholeTranslateJob = translateJobs.find((j) => rangeOf(j)?.startMs == null);
  /** 规划 / 切分进行中：编辑器锁住，弹窗显示进度 */
  const busyJob = planJob ?? processJob;
  const locked = busyJob !== undefined;
  const [tagNames, setTagNames] = useState<string[]>([]);
  /** 连续编辑同一字段只记一次撤销 */
  const lastEditKey = useRef<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    if (!videoId) return;
    const [d, p] = await Promise.all([videoService.getVideo(videoId), videoService.getPeaks(videoId)]);
    if (!d.success) {
      setLoadError(d.error);
      return;
    }
    setDetail(d.data);
    setPeaks(p.success ? p.data : []);
    // 上次在编辑的规划，没有就第一个
    const remembered = Number(readLastPlan(videoId));
    const current = d.data.plans.find((x) => x.id === remembered) ?? d.data.plans[0];
    setPlanId(current.id);
    loaded.current = false;
    setHistory({ past: [], present: current.plan, future: [] });
    // 整段大约铺满两屏
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(2400 / Math.max(1, d.data.video.durationMs / 1000)))));
  }, [videoId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    tagService.getTags().then((r) => r.success && setTagNames(r.data.map((t) => t.name)));
  }, []);

  // 翻译每写回一块就刷新字幕，中文一段段出现
  const translatedChunks = translateJobs.reduce((n, j) => n + j.current, 0);
  useEffect(() => {
    if (translatedChunks > 0) void reloadCuesRef.current();
  }, [translatedChunks]);

  /** 重新读字幕与视频信息（翻译写回、改了纠偏之后） */
  const reloadCues = useCallback(async () => {
    if (!videoId) return;
    const result = await videoService.getVideo(videoId);
    if (result.success) setDetail((d) => (d ? { ...d, cues: result.data.cues, video: result.data.video } : d));
  }, [videoId]);
  const reloadCuesRef = useRef(reloadCues);
  reloadCuesRef.current = reloadCues;

  const changeOffset = async (offsetMs: number) => {
    if (!videoId) return;
    const result = await videoService.setSubtitleOffset(videoId, offsetMs);
    if (!result.success) {
      toast.showError('无法调整字幕时间', result.error);
      return;
    }
    await reloadCues();
  };

  // AI 规划结束：读回规划，替换到时间轴（进撤销栈）；切分结束：刷新已切出的短片
  useOnJobFinished(async (job) => {
    if ((job.link?.params as { videoId?: number } | undefined)?.videoId !== videoId) return;
    if (job.kind === 'video_translate') {
      if (job.status === 'failed') toast.showError('没有翻译完', jobErrorText(job));
      await reloadCues();
      const failed = (job.result as { failed?: number } | null)?.failed ?? 0;
      if (job.status === 'succeeded' && failed > 0) toast.showWarning(`有 ${failed} 句字幕没有翻译成`, '可以再点「翻译全部字幕」补上');
      return;
    }
    if (job.kind === 'video_process') {
      const result = videoId ? await videoService.getVideo(videoId) : null;
      if (result?.success) setDetail((d) => (d ? { ...d, clips: result.data.clips, video: result.data.video } : d));
      if (job.status === 'failed') toast.showError('切分没有完成', jobErrorText(job));
      else if (job.status === 'succeeded') toast.showSuccess(`已生成 ${(job.result as { created?: number } | null)?.created ?? 0} 段短片`);
      return;
    }
    if (job.kind !== 'video_plan') return;
    if (job.status === 'failed') {
      toast.showError('AI 没有完成规划', jobErrorText(job));
      return;
    }
    if (job.status !== 'succeeded' || !videoId) return;
    const result = await videoService.getVideo(videoId);
    const target = (job.link?.params as { planId?: number } | undefined)?.planId;
    const planned = result.success ? result.data.plans.find((x) => x.id === target) : undefined;
    if (!result.success || !planned) return;
    setDetail((d) => (d ? { ...d, plans: result.data.plans } : d));
    if (planned.id === planIdRef.current) {
      commit(planned.plan);
    } else {
      switchTo(planned.id, result.data.plans);
    }
    setSelectedId(planned.plan.segments[0]?.id ?? null);
    const count = planned.plan.segments.length;
    const failedParts = (job.result as { failedParts?: string[] } | null)?.failedParts ?? [];
    if (failedParts.length > 0) {
      toast.showWarning(`「${planned.name}」规划了 ${count} 段，有部分没有完成`, `${failedParts.join('、')} 保留了原来的片段，可以再规划一次`);
    } else {
      toast.showSuccess(`「${planned.name}」规划了 ${count} 段`, '不满意可以撤销');
    }
  });

  const plan = live ?? history?.present ?? null;
  const cues = detail?.cues ?? [];
  /** 还没整理的字幕：没断过句或没有中文 */
  const unpreparedTotal = useMemo(() => cues.filter((c) => c.en.trim() && (c.join == null || !c.zh.trim())).length, [cues]);
  const durationMs = detail?.video.durationMs ?? 0;
  const boundaries = useMemo(() => cueBoundaries(cues), [cues]);
  const selected = plan?.segments.find((s) => s.id === selectedId) ?? null;
  const currentCue = cues.find((c) => c.startMs <= playhead && playhead < c.endMs);

  // 自动保存（加载后的第一次不存）
  useEffect(() => {
    if (!history || !planId || locked) return;
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    setSaveState('saving');
    const present = history.present;
    const timer = window.setTimeout(async () => {
      const result = await videoService.savePlan(planId, present);
      setSaveState(result.success ? 'saved' : 'error');
      // 本地的规划列表也更新，切换回来是最新的
      if (result.success) setDetail((d) => (d ? { ...d, plans: d.plans.map((x) => (x.id === planId ? { ...x, plan: present } : x)) } : d));
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [history?.present, planId, locked]);

  const planIdRef = useRef(planId);
  planIdRef.current = planId;

  /** 切换到另一个规划：先把当前的改动存好，撤销记录按规划分开 */
  const switchTo = useCallback(
    (id: number, plans?: VideoPlanInfo[]) => {
      const list = plans ?? detail?.plans ?? [];
      const target = list.find((x) => x.id === id);
      if (!target) return;
      const currentId = planIdRef.current;
      if (history && currentId && currentId !== id && !locked) {
        void videoService.savePlan(currentId, history.present);
        setDetail((d) => (d ? { ...d, plans: d.plans.map((x) => (x.id === currentId ? { ...x, plan: history.present } : x)) } : d));
      }
      setPlanId(id);
      writeLastPlan(videoId, id);
      loaded.current = false;
      setLive(null);
      setSelectedId(null);
      setSaveState('saved');
      setHistory({ past: [], present: target.plan, future: [] });
    },
    [detail?.plans, history, locked, videoId]
  );

  /** 改规划；editKey 相同的连续编辑合并成一次撤销 */
  const commit = useCallback((next: VideoPlan, editKey: string | null = null) => {
    setHistory((h) => {
      if (!h) return h;
      if (editKey && editKey === lastEditKey.current) return { ...h, present: next };
      return pushHistory(h, next);
    });
    lastEditKey.current = editKey;
  }, []);

  // ── 播放 ──
  const seek = useCallback((ms: number) => {
    const v = videoRef.current;
    const t = Math.max(0, Math.min(ms, durationMs));
    if (v) v.currentTime = t / 1000;
    setPlayhead(t);
  }, [durationMs]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // 只播当前片段：在片段外或到了结尾时从片段开头播
      if (loopSegment && selected && (playhead < selected.startMs || playhead >= selected.endMs - 50)) seek(selected.startMs);
      void v.play();
    } else {
      v.pause();
    }
  }, [loopSegment, selected, playhead, seek]);

  const playSegment = useCallback((seg: VideoSegment) => {
    setSelectedId(seg.id);
    seek(seg.startMs);
    void videoRef.current?.play();
  }, [seek]);

  // 播放中用 requestAnimationFrame 更新播放头（timeupdate 太稀）
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime * 1000;
        if (loopSegment && selected && t >= selected.endMs) {
          v.pause();
          v.currentTime = selected.endMs / 1000;
          setPlayhead(selected.endMs);
          return;
        }
        setPlayhead(t);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, loopSegment, selected]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  // ── 编辑操作 ──
  const split = useCallback(() => {
    if (!plan) return;
    const { plan: next, rightId } = splitAt(plan, playhead);
    if (!rightId) {
      toast.showInfo('这里不能拆分', '把播放头放在一段里面（离两端至少 1 秒）');
      return;
    }
    commit(next);
    setSelectedId(rightId);
  }, [plan, playhead, commit, toast]);

  const remove = useCallback(() => {
    if (!plan || !selectedId) return;
    commit(removeSegment(plan, selectedId));
    setSelectedId(null);
  }, [plan, selectedId, commit]);

  const merge = useCallback(() => {
    if (!plan || !selectedId) return;
    const next = mergeWithNext(plan, selectedId);
    if (next === plan) toast.showInfo('后面没有可以合并的片段');
    else commit(next);
  }, [plan, selectedId, commit, toast]);

  const createFrom = useCallback(
    (start: number, end: number) => {
      if (!plan) return;
      const s = snap ? boundaries.reduce((b, x) => (Math.abs(x - start) < Math.abs(b - start) ? x : b), start) : start;
      const e = snap ? boundaries.reduce((b, x) => (Math.abs(x - end) < Math.abs(b - end) ? x : b), end) : end;
      const within = (SNAP_PX / zoom) * 1000;
      const added = addSegment(plan, Math.abs(s - start) <= within ? s : start, Math.abs(e - end) <= within ? e : end);
      if (!added) {
        toast.showInfo('这里放不下新的片段', '片段之间不能重叠，最短 1 秒');
        return;
      }
      commit(added.plan);
      setSelectedId(added.id);
    },
    [plan, snap, boundaries, zoom, commit, toast]
  );

  const dragBase = useRef<VideoPlan | null>(null);
  const onEdgeDrag = useCallback(
    (id: string, edge: 'start' | 'end', ms: number, done: boolean, free: boolean) => {
      if (!history) return;
      const base = dragBase.current ?? history.present;
      dragBase.current = base;
      const next = moveEdge(base, id, edge, ms, durationMs, snap && !free ? { boundaries, withinMs: (SNAP_PX / zoom) * 1000 } : undefined);
      seek(edge === 'start' ? next.segments.find((s) => s.id === id)!.startMs : next.segments.find((s) => s.id === id)!.endMs);
      if (done) {
        dragBase.current = null;
        setLive(null);
        commit(next);
      } else {
        setLive(next);
      }
    },
    [history, durationMs, snap, boundaries, zoom, seek, commit]
  );

  const updateSelected = (patch: Partial<VideoSegment>, field: string) => {
    if (!plan || !selectedId) return;
    commit({ ...plan, segments: plan.segments.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)) }, `${selectedId}:${field}`);
  };

  const zoomBy = useCallback((factor: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor))), []);

  // ── 快捷键 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || !history || locked) return;
      const mod = e.metaKey || e.ctrlKey;
      const v = videoRef.current;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setHistory(e.shiftKey ? redo(history) : undo(history));
        lastEditKey.current = null;
        return;
      }
      if (mod) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomBy(1.5);
        } else if (e.key === '-') {
          e.preventDefault();
          zoomBy(1 / 1.5);
        }
        return;
      }
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'j':
        case 'J':
          seek(playhead - 5000);
          break;
        case 'l':
        case 'L':
          seek(playhead + 5000);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          v?.pause();
          seek(playhead - (e.shiftKey ? 1000 : FRAME_MS));
          break;
        case 'ArrowRight':
          e.preventDefault();
          v?.pause();
          seek(playhead + (e.shiftKey ? 1000 : FRAME_MS));
          break;
        case 'i':
        case 'I':
          setMarks((m) => ({ ...m, in: playhead }));
          break;
        case 'o':
        case 'O':
          setMarks((m) => ({ ...m, out: playhead }));
          break;
        case 'n':
        case 'N':
          if (marks.in !== null && marks.out !== null) createFrom(marks.in, marks.out);
          else toast.showInfo('先用 I / O 设好入点和出点');
          break;
        case 's':
        case 'S':
          split();
          break;
        case 'm':
        case 'M':
          merge();
          break;
        case 'Delete':
        case 'Backspace':
          remove();
          break;
        case 'Enter':
          if (selected) playSegment(selected);
          break;
        case '=':
        case '+':
          zoomBy(1.5);
          break;
        case '-':
          zoomBy(1 / 1.5);
          break;
        case 'Escape':
          setSelectedId(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, locked, playhead, marks, selected, togglePlay, seek, split, merge, remove, createFrom, playSegment, zoomBy, toast]);

  const back = () => onNavigate?.('videos', { tab: 'sources' });

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-8 py-10">
        <PageError title="无法打开剪辑编辑器" message={loadError} onRetry={load} back={{ label: '返回视频库', onClick: back }} />
      </div>
    );
  }
  if (!detail || !plan || !history) {
    return (
      <div className="flex h-svh items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在打开视频…
      </div>
    );
  }

  const segments = plan.segments;
  const clipOf = (s: VideoSegment) => detail.clips.find((c) => c.startMs === s.startMs && c.endMs === s.endMs);
  const pendingCount = segments.filter((s) => !clipOf(s)).length;

  const startProcessing = async () => {
    // 先把最新的规划存好，任务按库里的规划切
    if (!planId) return;
    const saved = await videoService.savePlan(planId, plan);
    if (!saved.success) {
      toast.showError('无法开始切分', saved.error);
      return;
    }
    const started = await videoService.startProcessing(planId);
    if (!started.success) toast.showError('无法开始切分', started.error);
  };
  const allIssues = segments.map((s) => segmentIssues(s, cues));
  const problemCount = allIssues.filter((i) => i.length > 0).length;
  const totalMs = segments.reduce((sum, s) => sum + s.endMs - s.startMs, 0);
  const segmentUnderPlayhead = segmentAt(plan, playhead);
  const mediaSrc = detail.video.mediaUrl ?? undefined;
  const thumbOf = (s: VideoSegment) => segmentThumb(detail.thumbs, detail.thumbIntervalMs, s);
  /** 翻译字幕：不给片段时整部 */
  const translate = async (seg?: VideoSegment) => {
    const result = await videoService.startTranslate(detail.video.id, seg?.startMs, seg?.endMs);
    if (!result.success) toast.showError('无法翻译字幕', result.error);
  };
  const currentPlan = detail.plans.find((x) => x.id === planId);
  const cutCount = (p: VideoPlanInfo) => p.plan.segments.filter((sg) => clipOf(sg)).length;
  const createPlan = async (copy: boolean) => {
    if (planId && copy) await videoService.savePlan(planId, plan);
    const r = await videoService.createPlan(detail.video.id, copy && currentPlan ? `${currentPlan.name} 副本` : undefined, copy ? (planId ?? undefined) : undefined);
    if (!r.success) {
      toast.showError('无法新建规划', r.error);
      return;
    }
    const plans = [...detail.plans.map((x) => (x.id === planId ? { ...x, plan } : x)), r.data];
    setDetail({ ...detail, plans });
    switchTo(r.data.id, plans);
  };
  const renamePlan = async (name: string) => {
    if (!planId) return false;
    const r = await videoService.renamePlan(planId, name);
    if (!r.success) {
      toast.showError('无法改名', r.error);
      return false;
    }
    setDetail({ ...detail, plans: detail.plans.map((x) => (x.id === planId ? { ...x, name } : x)) });
    return true;
  };
  const deletePlan = async () => {
    if (!planId) return;
    const r = await videoService.deletePlan(planId);
    if (!r.success) {
      toast.showError('无法删除规划', r.error);
      return;
    }
    const plans = detail.plans.filter((x) => x.id !== planId);
    setDetail({ ...detail, plans });
    loaded.current = false;
    planIdRef.current = null;
    switchTo(plans[0].id, plans);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-svh flex-col bg-background text-foreground">
        {/* 顶栏 */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button variant="ghost" size="sm" onClick={back}>
            <ArrowLeft />
            视频库
          </Button>
          <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
          <div className="min-w-0 truncate font-medium">{detail.video.title}</div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {saveState === 'saving' ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                保存中
              </>
            ) : saveState === 'error' ? (
              <span className="text-destructive">没有保存上，稍后会再试</span>
            ) : (
              <>
                <Check className="size-3" />
                已自动保存
              </>
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {onNavigate && <JobIndicator onNavigate={onNavigate} />}
            {/* 按流程：① 字幕 → ② 规划 → ③ 开始切分 */}
            <SubtitleMenu job={wholeTranslateJob} pending={unpreparedTotal} onPrepare={() => translate()} />
            <PlanMenu
              plans={detail.plans}
              currentId={planId ?? 0}
              cutCount={cutCount}
              clipCount={detail.clips.length}
              disabled={locked}
              onSwitch={(id) => switchTo(id)}
              onCreate={createPlan}
              onRename={renamePlan}
              onDelete={deletePlan}
              onAiPlan={() => setAiPlanOpen(true)}
              onAutoSplit={() => setAutoSplitOpen(true)}
              onViewClips={() => onNavigate?.('videos', { tab: 'clips', videoId: detail.video.id })}
            />
            <Button size="sm" onClick={startProcessing} disabled={locked || pendingCount === 0 || saveState === 'saving'}>
              <Scissors />
              {pendingCount === 0 && segments.length > 0 ? '已全部切分' : `开始切分（${pendingCount} 段）`}
            </Button>
          </div>
        </header>

        {/* 主区：片段列表 · 播放器 · 片段属性 */}
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_360px]">
          <aside className="flex min-h-0 flex-col border-r">
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">
                {detail.plans.length > 1 && <span className="font-medium text-foreground">{currentPlan?.name} · </span>}
                {segments.length} 段 · 共 {formatClock(totalMs, false)}
              </span>
              {problemCount > 0 && (
                <span className="flex items-center gap-1 text-warning">
                  <AlertTriangle className="size-3" />
                  {problemCount}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              {segments.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">还没有片段</p>
              ) : (
                segments.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted', s.id === selectedId && 'bg-accent')}
                    onClick={() => {
                      setSelectedId(s.id);
                      seek(s.startMs);
                    }}
                    onDoubleClick={() => playSegment(s)}
                  >
                    <span className="relative aspect-video w-16 shrink-0 overflow-hidden rounded bg-muted">
                      {thumbOf(s) && <img src={thumbOf(s)} alt="" className="size-full object-cover" loading="lazy" />}
                      <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[10px] text-white tabular-nums">{i + 1}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.title || '未命名'}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {formatClock(s.startMs, false)} · {formatClock(s.endMs - s.startMs, false)}
                      </span>
                    </span>
                    {clipOf(s) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                        </TooltipTrigger>
                        <TooltipContent>已切出短片</TooltipContent>
                      </Tooltip>
                    )}
                    {allIssues[i].length > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                        </TooltipTrigger>
                        <TooltipContent>{allIssues[i].map((x) => ISSUE_TEXT[x]).join('、')}</TooltipContent>
                      </Tooltip>
                    )}
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col bg-black/95">
            <div className="relative min-h-0 flex-1">
              <video
                ref={videoRef}
                src={mediaSrc}
                className="absolute inset-0 size-full object-contain"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onSeeked={() => videoRef.current && setPlayhead(videoRef.current.currentTime * 1000)}
                onClick={togglePlay}
                onError={() => setMediaError(true)}
                onLoadedData={() => setMediaError(false)}
                preload="auto"
              />
              {mediaError && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">这个视频无法播放</div>
              )}
              {currentCue && (
                <div className="pointer-events-none absolute inset-x-6 bottom-5 text-center">
                  <span className="inline-block rounded bg-black/70 px-3 py-1 text-lg leading-snug text-white">
                    {currentCue.en}
                    {currentCue.zh && <span className="block text-sm text-white/80">{currentCue.zh}</span>}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 border-t border-white/10 bg-background px-3 py-1.5">
              <Button variant="ghost" size="icon" className="size-8" onClick={() => seek(playhead - 5000)} aria-label="后退 5 秒">
                <SkipBack />
              </Button>
              <Button variant="ghost" size="icon" className="size-8" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
                {playing ? <Pause /> : <Play />}
              </Button>
              <Button variant="ghost" size="icon" className="size-8" onClick={() => seek(playhead + 5000)} aria-label="前进 5 秒">
                <SkipForward />
              </Button>
              <span className="ml-2 text-sm tabular-nums">
                {formatClock(playhead)} <span className="text-muted-foreground">/ {formatClock(durationMs, false)}</span>
              </span>
              <div className="ml-auto flex items-center gap-1">
                <SubtitleOffsetControl
                  offsetMs={detail.video.subtitleOffsetMs}
                  cues={cues}
                  playheadMs={playhead}
                  hasClips={detail.clips.length > 0}
                  disabled={locked}
                  onChange={changeOffset}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Toggle size="sm" pressed={loopSegment} onPressedChange={setLoopSegment} aria-label="只播当前片段">
                      <Repeat />
                    </Toggle>
                  </TooltipTrigger>
                  <TooltipContent>只播当前片段（播到结尾自动停）</TooltipContent>
                </Tooltip>
                <Select value={String(rate)} onValueChange={(v) => setRate(Number(v))}>
                  <SelectTrigger size="sm" className="h-8 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0.5, 0.75, 1, 1.25, 1.5].map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r}x
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <aside className={cn('min-h-0 border-l', !selected && 'overflow-y-auto p-4')}>
            {selected ? (
              <SegmentPanel
                key={selected.id}
                index={segments.findIndex((s) => s.id === selected.id)}
                segment={selected}
                cues={cuesIn(cues, selected)}
                playheadMs={playhead}
                thumb={thumbOf(selected)}
                issues={segmentIssues(selected, cues)}
                cut={clipOf(selected) !== undefined}
                translating={translateJobs.some((j) => rangeOf(j)?.startMs === selected.startMs && rangeOf(j)?.endMs === selected.endMs)}
                wholeTranslating={wholeTranslateJob !== undefined}
                tagNames={tagNames}
                onChange={updateSelected}
                onPlay={() => playSegment(selected)}
                onSeek={seek}
                onTranslate={() => translate(selected)}
                onSplit={split}
                onMerge={merge}
                onDelete={remove}
              />
            ) : (
              <div className="space-y-4 text-sm">
                <div className="font-medium text-muted-foreground">没有选中片段</div>
                <div className="space-y-1.5 rounded-lg border p-3 text-xs text-muted-foreground">
                  <div>入点：{marks.in === null ? '未设（按 I）' : formatClock(marks.in)}</div>
                  <div>出点：{marks.out === null ? '未设（按 O）' : formatClock(marks.out)}</div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1 w-full"
                    disabled={marks.in === null || marks.out === null}
                    onClick={() => marks.in !== null && marks.out !== null && createFrom(marks.in, marks.out)}
                  >
                    用入点和出点新建片段（N）
                  </Button>
                </div>
                <ShortcutHelp />
              </div>
            )}
          </aside>
        </div>

        {/* 工具栏 */}
        <div className="flex shrink-0 items-center gap-1 border-t px-3 py-1.5">
          <ToolButton label="拆分（S）" onClick={split} disabled={!segmentUnderPlayhead}>
            <Scissors />
          </ToolButton>
          <ToolButton label="和后一段合并（M）" onClick={merge} disabled={!selected}>
            <Merge />
          </ToolButton>
          <ToolButton label="删除片段（Delete）" onClick={remove} disabled={!selected}>
            <Trash2 />
          </ToolButton>
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
          <ToolButton label="撤销（⌘Z）" onClick={() => setHistory(undo(history))} disabled={history.past.length === 0}>
            <Undo2 />
          </ToolButton>
          <ToolButton label="重做（⇧⌘Z）" onClick={() => setHistory(redo(history))} disabled={history.future.length === 0}>
            <Redo2 />
          </ToolButton>
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle size="sm" pressed={snap} onPressedChange={setSnap} aria-label="吸附到字幕">
                <Magnet />
                吸附
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>拖动边界时对齐到字幕的开始 / 结束（按住 ⌥ 临时关闭）</TooltipContent>
          </Tooltip>
          <div className="ml-auto flex w-56 items-center gap-2">
            <ZoomOut className="size-4 text-muted-foreground" />
            <Slider
              value={[Math.log(zoom)]}
              min={Math.log(MIN_ZOOM)}
              max={Math.log(MAX_ZOOM)}
              step={0.01}
              onValueChange={([v]) => setZoom(Math.exp(v))}
              aria-label="时间轴缩放"
            />
            <ZoomIn className="size-4 text-muted-foreground" />
          </div>
        </div>

        {/* 时间轴 */}
        <div className="shrink-0 border-t bg-muted/20 py-1">
          <Timeline
            durationMs={durationMs}
            zoom={zoom}
            cues={cues}
            segments={segments}
            selectedId={selectedId}
            playheadMs={playhead}
            thumbs={detail.thumbs}
            thumbIntervalMs={detail.thumbIntervalMs}
            peaks={peaks}
            following={playing}
            onSeek={seek}
            onSelect={setSelectedId}
            onEdgeDrag={onEdgeDrag}
            onCreate={createFrom}
          />
        </div>
      </div>

      <EditorBusyDialog job={busyJob} onStop={(job) => jobService.cancel(job.id)} onBackground={back} />
      <AiPlanDialog
        open={aiPlanOpen}
        onOpenChange={setAiPlanOpen}
        videoId={detail.video.id}
        planId={planId ?? 0}
        requirements={plan.requirements}
        hasSegments={segments.length > 0}
      />
      <AutoSplitDialog
        open={autoSplitOpen}
        onOpenChange={setAutoSplitOpen}
        cues={cues}
        durationMs={durationMs}
        hasSegments={segments.length > 0}
        onApply={(next) => {
          commit({ ...plan, segments: next });
          setSelectedId(next[0]?.id ?? null);
        }}
      />
    </TooltipProvider>
  );
};

const ToolButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ label, onClick, disabled, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClick} disabled={disabled} aria-label={label}>
          {children}
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

const SHORTCUTS: [string, string][] = [
  ['空格 / K', '播放 / 暂停'],
  ['J / L', '后退 / 前进 5 秒'],
  ['← / →', '逐帧（⇧ 一秒）'],
  ['I / O / N', '入点 / 出点 / 新建'],
  ['S', '在播放头拆分'],
  ['M', '和后一段合并'],
  ['Delete', '删除片段'],
  ['Enter', '播放选中的片段'],
  ['⌘Z / ⇧⌘Z', '撤销 / 重做'],
  ['+ / -', '缩放时间轴'],
];

const ShortcutHelp: React.FC = () => (
  <div className="space-y-1">
    <div className="text-xs font-medium text-muted-foreground">快捷键</div>
    {SHORTCUTS.map(([key, what]) => (
      <div key={key} className="flex justify-between gap-2 text-xs">
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[11px]">{key}</kbd>
        <span className="text-muted-foreground">{what}</span>
      </div>
    ))}
  </div>
);
