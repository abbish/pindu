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

const Item: React.FC<{ label: React.ReactNode; children: React.ReactNode }> = ({ label, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex items-center gap-0.5 text-muted-foreground">{children}</span>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

/** 模型能力的一排小图标（看图 / 思考 / 上下文 / 价格），只显示具备的；悬停看详情 */
export const ModelCapabilities: React.FC<ModelCapabilitiesProps> = ({ images, reasoning, thinkingLevels, contextWindow, costInput, costOutput, className }) => {
  const hasCost = costInput != null && costOutput != null && (costInput > 0 || costOutput > 0);
  if (!images && !reasoning && !contextWindow && !hasCost) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2 [&_svg]:size-3.5', className)} aria-label="模型能力">
      {images && (
        <Item label="能看图片">
          <ImageIcon />
        </Item>
      )}
      {reasoning && (
        <Item label={thinkingLevels?.length ? `深度思考：${thinkingLevels.join(' / ')}` : '深度思考'}>
          <Brain />
        </Item>
      )}
      {!!contextWindow && contextWindow > 0 && (
        <Item label={`一次最多处理约 ${contextWindow.toLocaleString()} tokens`}>
          <TextCursorInput />
          <span className="text-xs tabular-nums">{formatContext(contextWindow)}</span>
        </Item>
      )}
      {hasCost && (
        <Item label={`每百万 tokens：输入 $${costInput}，输出 $${costOutput}`}>
          <Coins />
        </Item>
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
