import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SpeakButton } from '@/components/SpeakButton';
import { useQuickSay } from '@/components/SayText';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import type { SoundStat } from '@/types/pronunciation';
import { MINIMAL_PAIRS, soundLabel } from '@/utils/pronunciation';

type Speak = ReturnType<typeof useAudioPlayer>['speak'];

/** 一个词：听 · 读一读（读完标色、给档） */
const DrillWord: React.FC<{ word: string; planId: number; speak: Speak }> = ({ word, planId, speak }) => {
  const say = useQuickSay(word, { planId });
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2">
      <div className="flex items-center gap-2">
        {say.marked('min-w-0 flex-1 font-mono text-lg font-semibold')}
        <SpeakButton variant="outline" size="icon" className="size-8" label={`听 ${word}`} {...speak(word)} />
        {say.button}
      </div>
      {say.verdict}
    </div>
  );
};

/**
 * 专项练音（计划统计「发音」里常读不准的音）：读错过的词 + 只差这个音的成对词（think / sink），
 * 先听再读，读完本机评估。结果记进这个计划的发音统计，不进复习安排。
 */
export const SoundDrillDialog: React.FC<{ sound: SoundStat | null; planId: number; onClose: () => void }> = ({ sound, planId, onClose }) => {
  const audio = useAudioPlayer();
  const pairs = sound ? (MINIMAL_PAIRS[sound.ipa] ?? []) : [];
  return (
    <Dialog open={sound !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>练一练 {sound ? soundLabel(sound.ipa) : ''}</DialogTitle>
          <DialogDescription>先听，再读</DialogDescription>
        </DialogHeader>
        {sound && (
          <div className="flex flex-col gap-4">
            {sound.words.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">读错过的词</h3>
                <div className="grid grid-cols-2 gap-2">
                  {sound.words.map((w) => (
                    <DrillWord key={w} word={w} planId={planId} speak={audio.speak} />
                  ))}
                </div>
              </section>
            )}
            {pairs.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">听出、读出区别</h3>
                <div className="flex flex-col gap-2">
                  {pairs.map(([a, b]) => (
                    <div key={`${a}-${b}`} className="grid grid-cols-2 gap-2">
                      <DrillWord word={a} planId={planId} speak={audio.speak} />
                      <DrillWord word={b} planId={planId} speak={audio.speak} />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
