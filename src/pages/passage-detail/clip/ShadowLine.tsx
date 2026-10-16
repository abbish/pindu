import React from 'react';
import { Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { locateWords, markedPieces } from '@/utils/shadowing';
import type { ShadowResult } from './useShadowing';

/** 比原声慢多少算「几乎同步」 */
const IN_SYNC_MS = 400;

export interface ShadowLineProps {
  text: string;
  result: ShadowResult;
  replaying: boolean;
  onReplay: () => void;
}

/**
 * 影子跟读一句的结果（台词下面）：跟上了几个词、比原声慢多少，没说出来的词标出来；可以听自己的录音。
 */
export const ShadowLine: React.FC<ShadowLineProps> = ({ text, result, replaying, onReplay }) => {
  const total = result.words.length;
  const said = result.words.filter((w) => w.said).length;
  const missed = total > 0 && said < total;
  return (
    <div className="mt-1.5 space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        {total > 0 ? (
          <>
            <span className={cn(said === total ? 'text-success' : said === 0 ? 'text-destructive' : 'text-foreground')}>{said === 0 ? '没跟上' : `跟上 ${said}/${total} 个词`}</span>
            {result.lagMs !== null && <span>· {result.lagMs <= IN_SYNC_MS ? '几乎同步' : `慢了 ${(result.lagMs / 1000).toFixed(1)} 秒`}</span>}
          </>
        ) : (
          <span>已录下</span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto h-7 px-2" onClick={onReplay}>
          {replaying ? <Square /> : <Play />}
          听我的
        </Button>
      </div>
      {missed && (
        <p className="leading-relaxed">
          {markedPieces(text, locateWords(text, result.words.map((w) => w.word)), result.words.map((w) => w.said)).map((p, i) => (
            <span key={i} className={cn(p.mark === false && 'text-destructive underline decoration-wavy underline-offset-4', p.mark === true && 'text-muted-foreground')}>
              {p.text}
            </span>
          ))}
        </p>
      )}
    </div>
  );
};
