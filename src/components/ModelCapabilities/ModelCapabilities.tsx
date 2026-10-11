import React from 'react';
import { Brain, Coins, Image as ImageIcon, TextCursorInput } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AIModelConfig, CatalogCapabilities } from '@/types';

export interface ModelCapabilitiesProps {
  /** 能看图 */
  images?: boolean | null;
  /** 支持深度思考 */
  reasoning?: boolean | null;
  /** 可选的思考档（悬停时显示） */
  thinkingLevels?: string[];
  /** 上下文长度（token） */
  contextWindow?: number | null;
  /** 价格：美元 / 百万 token */
  costInput?: number | null;
  costOutput?: number | null;
  className?: string;
}

/** 1048576 → 1M，262144 → 262K */
export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_048_576).toFixed(1)}M`.replace('.0M', 'M');
  return `${Math.round(tokens / 1000)}K`;
}

const Item: React.FC<{ label: React.ReactNode; off?: boolean; children: React.ReactNode }> = ({ label, off, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className={cn('inline-flex items-center gap-0.5 text-muted-foreground', off && 'opacity-30')}>{children}</span>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

/**
 * 模型能力的一排小图标（看图 / 思考 / 上下文 / 价格），悬停看详情。
 * 每项位置固定，不具备的淡显，列表里上下对齐、一眼能比；不知道的（没有上下文、价格信息）留空位。
 */
export const ModelCapabilities: React.FC<ModelCapabilitiesProps> = ({ images, reasoning, thinkingLevels, contextWindow, costInput, costOutput, className }) => {
  const hasCost = costInput != null && costOutput != null && (costInput > 0 || costOutput > 0);
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2 [&_svg]:size-3.5', className)} aria-label="模型能力">
      <Item label={images ? '能看图片' : images === false ? '不能看图片' : '不清楚能不能看图片'} off={!images}>
        <ImageIcon />
      </Item>
      <Item label={reasoning ? (thinkingLevels?.length ? `深度思考：${thinkingLevels.join(' / ')}` : '深度思考') : '不支持深度思考'} off={!reasoning}>
        <Brain />
      </Item>
      {!!contextWindow && contextWindow > 0 ? (
        <Item label={`一次最多处理约 ${contextWindow.toLocaleString()} tokens`}>
          <TextCursorInput />
          <span className="w-8 text-xs tabular-nums">{formatContext(contextWindow)}</span>
        </Item>
      ) : (
        <span className="w-12" aria-hidden />
      )}
      {hasCost ? (
        <Item label={`每百万 tokens：输入 $${costInput}，输出 $${costOutput}`}>
          <Coins />
        </Item>
      ) : (
        <span className="w-3.5" aria-hidden />
      )}
    </span>
  );
};

/** 已配置模型的实际能力：用户设置优先，其次内置目录 */
export function capabilitiesOf(m: Pick<AIModelConfig, 'supportsImages' | 'reasoning' | 'contextWindow'> & { catalog?: CatalogCapabilities | null }): ModelCapabilitiesProps {
  return {
    images: m.supportsImages ?? m.catalog?.supportsImages ?? false,
    reasoning: m.reasoning ?? m.catalog?.reasoning ?? false,
    contextWindow: m.contextWindow ?? m.catalog?.contextWindow ?? null,
    costInput: m.catalog?.costInput ?? null,
    costOutput: m.catalog?.costOutput ?? null,
  };
}
