import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Mic, Play, Square, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { MicProblem } from '@/components/MicProblem';
import { useRecorder } from '@/hooks/useRecorder';
import { loadMicPrefs, micOptions, saveMicPrefs, type MicPrefs, type SilenceWait } from '@/utils/microphone';
import { OptionSelect, type Option } from './promptProfileShared';

/** 跟随系统（下拉框不能用空字符串作值） */
const SYSTEM = 'system';
/** 测试录多久 */
const TEST_MS = 4000;

const WAITS: Option[] = [
  { value: 'short', label: '较快' },
  { value: 'normal', label: '适中' },
  { value: 'long', label: '较慢' },
];

/** 测试结果：按录到的最大音量（useRecorder 的音量轮廓，0–1）判断 */
type Verdict = 'silent' | 'quiet' | 'ok';
const verdictOf = (peaks: number[]): Verdict => {
  const max = peaks.reduce((m, v) => Math.max(m, v), 0);
  return max < 0.03 ? 'silent' : max < 0.12 ? 'quiet' : 'ok';
};

const VERDICT_TEXT: Record<Verdict, string> = {
  silent: '没有收到声音：看看麦克风有没有接好、选的是不是正在用的那个，或在系统设置里调大输入音量。',
  quiet: '声音偏小：靠近麦克风一点，或在系统设置里调大输入音量。',
  ok: '声音正常。',
};

/**
 * 「朗读与发音」里的麦克风（像会议软件的音频设置）：选用哪个麦克风、测试（实时音量 → 录几秒自动回放 → 判断声音大小）、
 * 说完后多久停止录音。跟读、单词跟读、说话输入都按这里的设置（useRecorder 读取）；偏好只存在本机。
 */
export const MicrophoneSection: React.FC = () => {
  const [prefs, setPrefs] = useState<MicPrefs>(loadMicPrefs);
  const [devices, setDevices] = useState<Option[]>([]);
  const recorder = useRecorder({ silenceStopMs: 0, maxMs: TEST_MS });
  const [testing, setTesting] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDevices(micOptions(await navigator.mediaDevices.enumerateDevices()));
    } catch {
      setDevices([]);
    }
  }, []);

  // 插拔麦克风时列表跟着变
  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener('devicechange', refresh);
    return () => md?.removeEventListener('devicechange', refresh);
  }, [refresh]);

  const stopPlayback = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(false);
  };
  useEffect(() => () => stopPlayback(), []);

  const play = (url: string) => {
    stopPlayback();
    const a = new Audio(url);
    audio.current = a;
    const done = () => {
      if (audio.current === a) stopPlayback();
    };
    a.onended = done;
    a.onerror = done;
    setPlaying(true);
    void a.play().catch(done);
  };

  // 录完：关麦克风、判断声音大小、自动回放；授权后才有麦克风的名字，顺便刷新列表
  useEffect(() => {
    if (!testing) return;
    setTesting(false);
    recorder.close();
    void refresh();
    const take = recorder.take;
    if (!take) return;
    const v = verdictOf(take.peaks);
    setVerdict(v);
    if (v !== 'silent') play(take.url);
  }, [recorder.ended]);

  const update = (patch: Partial<MicPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveMicPrefs(next);
  };

  const toggleTest = () => {
    if (recorder.state !== 'idle') return recorder.stop();
    stopPlayback();
    setVerdict(null);
    recorder.clear();
    setTesting(true);
    void recorder.start('test');
  };

  const recording = recorder.state === 'recording';
  const missing = prefs.deviceId !== '' && devices.length > 0 && !devices.some((d) => d.value === prefs.deviceId);
  const options: Option[] = [{ value: SYSTEM, label: '跟随系统' }, ...devices, ...(missing ? [{ value: prefs.deviceId, label: '已断开的麦克风' }] : [])];

  return (
    <SettingsSection title="麦克风">
      <SettingsRow label="麦克风" description={missing ? '选的麦克风现在没有连接，会先用系统默认的。' : undefined}>
        <OptionSelect
          label="麦克风"
          value={prefs.deviceId || SYSTEM}
          options={options}
          onChange={(v) => {
            update({ deviceId: v === SYSTEM ? '' : v });
            setVerdict(null);
          }}
          className="w-56"
        />
      </SettingsRow>
      <SettingsRow label="测试麦克风" description={`说一句话，录 ${TEST_MS / 1000} 秒后自动放给你听`} stacked>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={toggleTest} disabled={recorder.state === 'arming'}>
              {recorder.state === 'idle' ? <Mic /> : <Square className="fill-current" />}
              {recorder.state === 'idle' ? (verdict ? '再测一次' : '开始测试') : '停止'}
            </Button>
            {recording && (
              <>
                <Progress value={Math.min(100, recorder.level * 250)} className="h-2 flex-1" aria-label="输入音量" />
                <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{Math.max(0, Math.ceil((TEST_MS - recorder.elapsedMs) / 1000))} 秒</span>
              </>
            )}
            {!recording && recorder.take?.tag === 'test' && verdict !== 'silent' && (
              <Button variant="ghost" size="sm" onClick={() => (playing ? stopPlayback() : play(recorder.take!.url))}>
                {playing ? <Square className="fill-current" /> : <Play />}
                {playing ? '停止' : '听录音'}
              </Button>
            )}
          </div>
          {recorder.error ? (
            <MicProblem message={recorder.error} problem={recorder.problem} />
          ) : (
            verdict &&
            !recording && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground" role="status">
                {verdict === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />}
                {VERDICT_TEXT[verdict]}
              </div>
            )
          )}
        </div>
      </SettingsRow>
      <SettingsRow label="说完后停止录音" description="读得慢、句中停顿久的选「较慢」">
        <OptionSelect label="说完后停止录音" value={prefs.wait} options={WAITS} onChange={(v) => update({ wait: v as SilenceWait })} className="w-32" />
      </SettingsRow>
    </SettingsSection>
  );
};
