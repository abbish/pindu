import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Play, Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { MicProblem } from '@/components/MicProblem';
import { apiClient } from '@/api/client';
import { cn } from '@/lib/utils';
import { levelOf, meterOf, openMicInput, type MicInput } from '@/utils/micInput';
import { canChooseSpeaker } from '@/utils/audioOutput';
import { trackPlayback } from '@/utils/playbackTail';
import { makeTestSound, TEST_SOUND_STEP_MS } from '@/utils/testSound';
import { loadMicPrefs, MIC_GAIN_MAX, MIC_GAIN_MIN, MIC_PROBLEM_TEXT, micOptions, micProblemKind, saveMicPrefs, type MicPrefs, type MicProblemKind, type SilenceWait } from '@/utils/microphone';
import { OptionSelect, type Option } from './promptProfileShared';

/** 跟随系统（下拉框不能用空字符串作值） */
const SYSTEM = 'system';
/** 音量条格数 */
const BLOCKS = 10;

const WAITS: Option[] = [
  { value: 'short', label: '较快' },
  { value: 'normal', label: '适中' },
  { value: 'long', label: '较慢' },
];

/** 音量条（像会议软件的输入 / 输出指示）：level 0–1 */
const LevelMeter: React.FC<{ level: number; icon: React.ReactNode; active: boolean }> = ({ level, icon, active }) => {
  const lit = Math.round(Math.min(1, level) * BLOCKS);
  return (
    <div className="flex w-[21rem] items-center gap-2" aria-hidden>
      <span className={cn('[&_svg]:size-4', active ? 'text-primary' : 'text-muted-foreground')}>{icon}</span>
      <div className="flex flex-1 gap-1">
        {Array.from({ length: BLOCKS }, (_, i) => (
          <span key={i} className={cn('h-2.5 flex-1 rounded-sm transition-colors duration-75', i < lit ? 'bg-primary' : 'bg-muted')} />
        ))}
      </div>
    </div>
  );
};

/** 测试麦克风最多录多久（之后音量条照常动，只是不再录） */
const MIC_RECORD_MS = 30_000;

/** 设备下拉框 + 测试按钮（测试中是「停止」）；`extra` 放在测试按钮左边（听录音） */
const DeviceRow: React.FC<{ label: string; value: string; options: Option[]; disabled?: boolean; onChange: (v: string) => void; testing: boolean; onTest: () => void; extra?: React.ReactNode }> = ({ label, value, options, disabled, onChange, testing, onTest, extra }) => (
  <SettingsRow label={label}>
    <div className="flex items-center gap-2">
      {extra}
      <OptionSelect label={label} value={value} options={options} onChange={onChange} disabled={disabled} className="w-64" />
      <Button variant="outline" className="w-20" onClick={onTest}>
        {testing ? '停止' : '测试'}
      </Button>
    </div>
  </SettingsRow>
);

/**
 * 「朗读与发音」里的扬声器与麦克风（照会议软件的音频设置）：
 * 扬声器——选设备（系统支持时）、测试（放一段铃声，输出音量条跟着动）、音量（朗读、原声、视频、听自己的录音都按它）；
 * 麦克风——选设备、测试（实时输入音量条，边看边调增益）、增益、说完后多久停止录音。
 * 偏好只存在本机（utils/microphone）；录音按它（utils/micInput、useRecorder），放音按它（utils/audioOutput）。
 */
export const AudioDevices: React.FC = () => {
  const [prefs, setPrefs] = useState<MicPrefs>(loadMicPrefs);
  const [inputs, setInputs] = useState<Option[]>([]);
  const [outputs, setOutputs] = useState<Option[]>([]);
  const speakerChoice = useMemo(canChooseSpeaker, []);

  const refresh = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(micOptions(devices));
      setOutputs(micOptions(devices, 'audiooutput'));
    } catch {
      setInputs([]);
      setOutputs([]);
    }
  }, []);

  // 插拔设备时列表跟着变
  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener('devicechange', refresh);
    return () => md?.removeEventListener('devicechange', refresh);
  }, [refresh]);

  const update = (patch: Partial<MicPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveMicPrefs(next);
  };

  // ---------- 扬声器测试：循环放铃声，音量条按播放位置取铃声的响度 × 音量 ----------
  const sound = useMemo(makeTestSound, []);
  const speaker = useRef<HTMLAudioElement | null>(null);
  const [outLevel, setOutLevel] = useState(0);
  const speakerFrame = useRef(0);
  const stopSpeaker = useCallback(() => {
    cancelAnimationFrame(speakerFrame.current);
    const a = speaker.current;
    speaker.current = null;
    if (a) {
      a.pause();
      URL.revokeObjectURL(a.src);
    }
    setOutLevel(0);
  }, []);
  useEffect(() => stopSpeaker, [stopSpeaker]);
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const toggleSpeaker = () => {
    if (speaker.current) {
      stopSpeaker();
      setSpeakerTesting(false);
      return;
    }
    const a = new Audio(URL.createObjectURL(new Blob([sound.wav], { type: 'audio/wav' })));
    a.loop = true;
    trackPlayback(a);
    speaker.current = a;
    setSpeakerTesting(true);
    const tick = () => {
      if (speaker.current !== a) return;
      const i = Math.floor((a.currentTime * 1000) / TEST_SOUND_STEP_MS);
      setOutLevel(a.paused ? 0 : (sound.envelope[i] ?? 0) * a.volume);
      speakerFrame.current = requestAnimationFrame(tick);
    };
    void a
      .play()
      .then(() => (speakerFrame.current = requestAnimationFrame(tick)))
      .catch(() => {
        stopSpeaker();
        setSpeakerTesting(false);
      });
  };

  // ---------- 麦克风测试：实时输入音量，同时录下来，停止后放给你听 ----------
  const mic = useRef<MicInput | null>(null);
  const micFrame = useRef(0);
  /** 每次开始 / 停止加一：打开麦克风期间停了，拿到的立即关掉 */
  const micGeneration = useRef(0);
  const [micTesting, setMicTesting] = useState(false);
  const [inLevel, setInLevel] = useState(0);
  const [problem, setProblem] = useState<MicProblemKind | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  /** 停止录音后要不要马上放（换麦克风、离开页面时不放） */
  const playAfter = useRef(false);
  const [take, setTake] = useState<string | null>(null);
  /** 离开页面后录音才收尾：不再生成录音地址（没人释放） */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  const replay = useRef<HTMLAudioElement | null>(null);
  const [replaying, setReplaying] = useState(false);
  useEffect(() => () => void (take && URL.revokeObjectURL(take)), [take]);

  const stopReplay = useCallback(() => {
    replay.current?.pause();
    replay.current = null;
    setReplaying(false);
  }, []);
  const playTake = useCallback(
    (url: string) => {
      stopReplay();
      const a = new Audio(url);
      trackPlayback(a);
      replay.current = a;
      const done = () => {
        if (replay.current === a) stopReplay();
      };
      a.onended = done;
      a.onerror = done;
      setReplaying(true);
      void a.play().catch(done);
    },
    [stopReplay]
  );

  const stopMic = useCallback((play = false) => {
    micGeneration.current += 1;
    cancelAnimationFrame(micFrame.current);
    playAfter.current = play;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current = null;
    mic.current?.close();
    mic.current = null;
    setMicTesting(false);
    setInLevel(0);
  }, []);
  useEffect(
    () => () => {
      stopMic();
      stopReplay();
    },
    [stopMic, stopReplay]
  );
  const startMic = useCallback(async () => {
    stopMic();
    stopReplay();
    const mine = micGeneration.current;
    setProblem(null);
    setMicTesting(true);
    try {
      const input = await openMicInput();
      if (mine !== micGeneration.current) return input.close();
      mic.current = input;
      // 授权后才有设备的名字
      void refresh();
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(input.stream);
      } catch (e) {
        stopMic();
        throw e;
      }
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => {
        if (chunks.length === 0 || !mounted.current) return;
        const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
        setTake(url);
        if (playAfter.current) playTake(url);
      };
      rec.start(100);
      recorder.current = rec;
      const begun = performance.now();
      const buffer = new Float32Array(input.analyser.fftSize);
      const tick = () => {
        setInLevel(meterOf(levelOf(input.analyser, buffer)));
        if (rec.state === 'recording' && performance.now() - begun > MIC_RECORD_MS) rec.stop();
        micFrame.current = requestAnimationFrame(tick);
      };
      micFrame.current = requestAnimationFrame(tick);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      apiClient.log('WARN', 'recorder', `测试时打不开麦克风：${name || '未知原因'}`, e instanceof Error ? e.message : String(e));
      if (mine !== micGeneration.current) return;
      setMicTesting(false);
      setProblem(micProblemKind(name));
    }
  }, [refresh, stopMic, stopReplay, playTake]);

  const withMissing = (list: Option[], id: string, name: string): Option[] => {
    const missing = id !== '' && list.length > 0 && !list.some((d) => d.value === id);
    return [{ value: SYSTEM, label: '跟随系统' }, ...list, ...(missing ? [{ value: id, label: `已断开的${name}` }] : [])];
  };

  return (
    <>
      <SettingsSection title="扬声器">
        <DeviceRow
          label="扬声器"
          value={speakerChoice ? prefs.speakerId || SYSTEM : SYSTEM}
          options={speakerChoice ? withMissing(outputs, prefs.speakerId, '扬声器') : [{ value: SYSTEM, label: '跟随系统' }]}
          disabled={!speakerChoice}
          onChange={(v) => {
            const id = v === SYSTEM ? '' : v;
            update({ speakerId: id });
            const a = speaker.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
            void a?.setSinkId?.(id).catch(() => undefined);
          }}
          testing={speakerTesting}
          onTest={toggleSpeaker}
        />
        <SettingsRow label="输出">
          <LevelMeter level={outLevel} icon={<Volume2 />} active={speakerTesting} />
        </SettingsRow>
        <SettingsRow label="音量">
          <div className="flex w-[21rem] items-center gap-3">
            <Slider
              aria-label="音量"
              min={0}
              max={100}
              step={5}
              value={[Math.round(prefs.volume * 100)]}
              onValueChange={([v]) => {
                update({ volume: v / 100 });
                if (speaker.current) speaker.current.volume = v / 100;
              }}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm text-muted-foreground tabular-nums">{Math.round(prefs.volume * 100)}%</span>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="麦克风">
        <DeviceRow
          label="麦克风"
          value={prefs.deviceId || SYSTEM}
          options={withMissing(inputs, prefs.deviceId, '麦克风')}
          onChange={(v) => {
            update({ deviceId: v === SYSTEM ? '' : v });
            // 测试中（含正在打开）换了麦克风：换成新的接着测
            if (micTesting) void startMic();
          }}
          testing={micTesting}
          onTest={() => (micTesting ? stopMic(true) : void startMic())}
          extra={
            take && !micTesting ? (
              <Button variant="ghost" size="icon" onClick={() => (replaying ? stopReplay() : playTake(take))} aria-label={replaying ? '停止' : '听录音'} title={replaying ? '停止' : '听录音'}>
                {replaying ? <Square className="fill-current" /> : <Play />}
              </Button>
            ) : null
          }
        />
        <SettingsRow label="输入">
          <LevelMeter level={inLevel} icon={<Mic />} active={micTesting} />
        </SettingsRow>
        <SettingsRow label="增益">
          <div className="flex w-[21rem] items-center gap-3">
            <Slider
              aria-label="增益"
              min={MIC_GAIN_MIN}
              max={MIC_GAIN_MAX}
              step={0.5}
              value={[prefs.gain]}
              onValueChange={([g]) => {
                update({ gain: g });
                mic.current?.setGain(g);
              }}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm text-muted-foreground tabular-nums">×{prefs.gain}</span>
          </div>
        </SettingsRow>
        {problem && (
          <div className="px-4 py-3">
            <MicProblem message={MIC_PROBLEM_TEXT[problem]} problem={problem} />
          </div>
        )}
        <SettingsRow label="说完后停止录音">
          <OptionSelect label="说完后停止录音" value={prefs.wait} options={WAITS} onChange={(v) => update({ wait: v as SilenceWait })} className="w-32" />
        </SettingsRow>
      </SettingsSection>
    </>
  );
};
