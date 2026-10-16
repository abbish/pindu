import React from 'react';
import { ChevronLeft, ChevronRight, Languages, Mic, Square } from 'lucide-react';
import { IconToggle } from '@/components/IconToggle';
import { SpeakButton } from '@/components/SpeakButton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SentenceStrip, type SentenceStripProps } from './SentenceStrip';

/** 跟读卡片的底部控制条要的东西 */
export interface PracticeControls {
  /** 原声在播（只听，不跟读）：正常 / 慢速 */
  playing: 'normal' | 'slow' | null;
  onPlay: (slow: boolean) => void;
  onStopPlay: () => void;
  /** 正在跟读 */
  flowing: boolean;
  /** 正在评分 / 评估：跟读按钮变灰 */
  assessing: boolean;
  /** 「停止」：录音时是读完了（去评分），其余时候是不练了 */
  onStop: () => void;
  onSay: () => void;
  /** 跟读按钮的说明 */
  sayTip: string;
  /** 译文开关 */
  showZh: boolean;
  onShowZh: (on: boolean) => void;
  /** 练习设置（⚙），没有可设的时候不给 */
  settings?: React.ReactNode;
}

export interface PracticeCardProps {
  /** 顶部：第几句 / 第几段 */
  position: string;
  strip: SentenceStripProps['items'];
  stripCurrent: number;
  onPick: (index: number) => void;
  /** 顶部右边的状态（正在播原声 / 准备… / 正在评估…） */
  status?: string;
  controls: PracticeControls;
  /** 上一句 / 上一段 */
  prevLabel: string;
  nextLabel: string;
  onPrev?: () => void;
  onNext?: () => void;
  children: React.ReactNode;
}

export const NavButton: React.FC<{ label: string; onClick?: () => void; children: React.ReactNode }> = ({ label, onClick, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={label} disabled={!onClick} onClick={onClick}>
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

/** 控制条上的图标按钮，悬停有说明 */
export const BarIcon: React.FC<{ label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ label, onClick, disabled, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={label} disabled={disabled} onClick={onClick}>
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

export interface CardShellProps {
  /** 顶部：第几句 / 第几段 */
  position: string;
  strip: SentenceStripProps['items'];
  stripCurrent: number;
  onPick: (index: number) => void;
  /** 顶部右边的状态 */
  status?: string;
  /** 底部固定的控制条 */
  footer: React.ReactNode;
  children: React.ReactNode;
}

/** 练习卡片的外壳（跟读、精听共用）：顶部固定进度与状态，中间滚动放内容，底部固定控制条 */
export const CardShell: React.FC<CardShellProps> = ({ position, strip, stripCurrent, onPick, status, footer, children }) => (
  <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5 text-sm text-muted-foreground">
      <span className="shrink-0 tabular-nums">{position}</span>
      <div className="min-w-0 flex-1">
        <SentenceStrip items={strip} current={stripCurrent} onPick={onPick} />
      </div>
      {status && (
        <span className="shrink-0 text-xs" aria-live="polite">
          {status}
        </span>
      )}
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
    <div className="flex shrink-0 items-center gap-1 border-t px-2 py-2">{footer}</div>
  </div>
);

/**
 * 跟读卡片（逐句、影子共用）：外壳见 CardShell，底部控制条
 * （‹ 上一句 · 原声 · 慢速 · 译文 · 设置 · 跟读 · 下一句 ›；除了跟读都是图标，悬停有说明）。只有「跟读」一个按钮管跟读：练的时候是「停止」，评分时变灰。
 */
export const PracticeCard: React.FC<PracticeCardProps> = ({ position, strip, stripCurrent, onPick, status, controls: c, prevLabel, nextLabel, onPrev, onNext, children }) => (
  <CardShell
    position={position}
    strip={strip}
    stripCurrent={stripCurrent}
    onPick={onPick}
    status={status}
    footer={
      <>
        <NavButton label={prevLabel} onClick={onPrev}>
          <ChevronLeft />
        </NavButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <SpeakButton variant="ghost" size="icon" className="size-8" label="原声" status={c.playing === 'normal' ? 'playing' : 'idle'} onClick={() => (c.playing === 'normal' ? c.onStopPlay() : c.onPlay(false))} />
          </TooltipTrigger>
          <TooltipContent>{c.playing === 'normal' ? '停止' : '听原声'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <SpeakButton variant="ghost" size="icon" className="size-8" label="慢速" slow status={c.playing === 'slow' ? 'playing' : 'idle'} onClick={() => (c.playing === 'slow' ? c.onStopPlay() : c.onPlay(true))} />
          </TooltipTrigger>
          <TooltipContent>{c.playing === 'slow' ? '停止' : '慢速听'}</TooltipContent>
        </Tooltip>
        <IconToggle label="译文" pressed={c.showZh} onPressedChange={c.onShowZh}>
          <Languages />
        </IconToggle>
        {c.settings}
        <div className="ml-auto">
          {c.flowing && c.assessing ? (
            <Button size="sm" disabled>
              <Mic />
              跟读
            </Button>
          ) : c.flowing ? (
            <Button size="sm" variant="outline" onClick={c.onStop}>
              <Square className="fill-current" />
              停止
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" onClick={c.onSay}>
                  <Mic />
                  跟读
                </Button>
              </TooltipTrigger>
              <TooltipContent>{c.sayTip}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <NavButton label={nextLabel} onClick={onNext}>
          <ChevronRight />
        </NavButton>
      </>
    }
  >
    {children}
  </CardShell>
);
