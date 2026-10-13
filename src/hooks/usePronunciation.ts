import { useCallback, useEffect, useRef, useState } from 'react';
import { useJob } from '@/hooks/useJobs';
import { pronunciationService } from '@/services/pronunciationService';
import type { Assessment, PronunciationContext, PronunciationSettings } from '@/types/pronunciation';
import { promptProfileService } from '@/services/promptProfileService';
import { recordingToPcmBase64 } from '@/utils/audioPcm';
import { strictnessFor } from '@/utils/pronunciation';

/** 模型状态与设置在页面间共用：下载好以后不用每次再查 */
let cached: { ready: boolean; settings: PronunciationSettings; modelBytes: number } | null = null;
let cachedLearner: string | undefined;
/** 同一时间很多个一起挂载时（练一练的一组词）只查一次 */
let loading: { at: number; status: ReturnType<typeof pronunciationService.status>; profile: ReturnType<typeof promptProfileService.getProfile> } | null = null;
/** 设置里改了开关 / 宽严、下载或删除了模型后调用：下次挂载重新查 */
export function invalidatePronunciationCache() {
  loading = null;
  cached = null;
}
const fresh = () => {
  if (!loading || Date.now() - loading.at > 3000) {
    loading = { at: Date.now(), status: pronunciationService.status(), profile: promptProfileService.getProfile() };
  }
  return loading;
};

/**
 * 本机发音评估（单词「看 · 说」、句子跟读共用）：
 * - `ready` 评估模型是否已下载（null = 还在查）；`download()` 开始下载，`downloading` 是下载任务；
 * - `settings` 开关与严格程度（设置 → 朗读与发音）；`enabled` 开着；`strictness` 按设置与学习者换算，
 *   `showScore` 小学生只看三档、不看分数；
 * - `assess(url, text)` 把一段录音（MediaRecorder 的地址）交给本机评估，结果在 `result`，读不出时 `error`。
 * 文字变化时调用 `reset()` 清掉上一次的结果。
 */
export function usePronunciation(context?: PronunciationContext) {
  const [ready, setReady] = useState<boolean | null>(cached?.ready ?? null);
  const [settings, setSettings] = useState<PronunciationSettings | null>(cached?.settings ?? null);
  const [learner, setLearner] = useState<string | undefined>(cachedLearner);
  const [downloadJob, setDownloadJob] = useState<string | null>(null);
  const downloading = useJob(downloadJob);
  const [assessing, setAssessing] = useState(false);
  const [result, setResult] = useState<Assessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const { status, profile } = fresh();
    void status.then((r) => {
      if (!r.success) return;
      cached = { ready: r.data.ready, settings: r.data.settings, modelBytes: r.data.modelBytes };
      setReady(r.data.ready);
      setSettings(r.data.settings);
      if (r.data.downloadJob) setDownloadJob(r.data.downloadJob);
    });
    void profile.then((r) => {
      if (!r.success) return;
      cachedLearner = r.data.learner;
      setLearner(r.data.learner);
    });
  }, []);

  useEffect(() => {
    if (downloading?.status === 'succeeded') {
      if (cached) cached.ready = true;
      setReady(true);
      setDownloadJob(null);
    } else if (downloading?.status === 'failed') {
      setError('评估模型没有下载成功，请检查网络后再试');
      setDownloadJob(null);
    }
  }, [downloading?.status]);

  const download = useCallback(async () => {
    setError(null);
    const r = await pronunciationService.startDownload();
    if (r.success) setDownloadJob(r.data);
    else setError(r.error);
  }, []);

  const reset = useCallback(() => {
    seq.current += 1;
    setResult(null);
    setError(null);
    setAssessing(false);
  }, []);

  /** 评估一段录音；返回结果（没听到声音、不能评分时为 null） */
  const assess = useCallback(async (url: string, text: string): Promise<Assessment | null> => {
    const mine = ++seq.current;
    setAssessing(true);
    setError(null);
    try {
      const audio = await recordingToPcmBase64(url);
      const r = await pronunciationService.assess({ text, audio, context: contextRef.current });
      if (mine !== seq.current) return null;
      if (!r.success) {
        setResult(null);
        setError(r.code === 'NOT_FOUND' ? '需要先下载评估模型' : r.error);
        if (r.code === 'NOT_FOUND') {
          if (cached) cached.ready = false;
          setReady(false);
        }
        return null;
      }
      if (!r.data.voiced || r.data.score === null) {
        setResult(null);
        setError(r.data.voiced ? '这句还不能评估' : '没有听到声音，再读一遍');
        return null;
      }
      setResult(r.data);
      return r.data;
    } catch {
      if (mine === seq.current) setError('录音读不出来，再读一遍');
      return null;
    } finally {
      if (mine === seq.current) setAssessing(false);
    }
  }, []);

  const enabled = settings?.enabled ?? false;
  const strictness = strictnessFor(learner, settings?.strictness);
  const showScore = learner !== undefined && learner !== 'primary';
  const modelBytes = cached?.modelBytes ?? 0;
  return { ready, settings, modelBytes, enabled, strictness, showScore, downloading, download, assessing, result, error, assess, reset };
}
