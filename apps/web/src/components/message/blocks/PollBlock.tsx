// effect-plain: a presentational control; the block card owns the request.
import type { PollBlock as PollBlockData } from '@zilar/protocol';
import { ChartColumn, Check } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useBlockRespond } from './BlockRespond';

const TRACK_STYLE = {
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.05)',
};
const FILL_LIGHT = 'linear-gradient(180deg,#f5f5f5,#b5b5b5)';

function countsOf(block: PollBlockData): Record<string, number> {
  return Object.fromEntries(block.options.map((option) => [option.id, option.votes ?? 0]));
}

function totalOf(block: PollBlockData, counts: Record<string, number>): number {
  return block.votes ?? Object.values(counts).reduce((sum, count) => sum + count, 0);
}

/** One tap's new selection: a single option toggles itself off; `multiple` toggles a set. */
function toggle(mine: readonly string[], optionId: string, multiple: boolean): string[] {
  if (!multiple) {
    return mine.length === 1 && mine[0] === optionId ? [] : [optionId];
  }
  return mine.includes(optionId) ? mine.filter((id) => id !== optionId) : [...mine, optionId];
}

/**
 * 14 · POLL: the question header with the vote count, then one tappable row per
 * option with a 6 px track. The viewer's options carry the light fill and a
 * check; the rest stay dim. Taps answer with `optionIds`; the count moves at
 * once and the room correction replaces it with the recorded total.
 */
export function PollBlock({
  block,
  initialSelection,
}: {
  block: PollBlockData;
  /** The options a fixture starts with as the viewer's; a live card starts clean. */
  initialSelection?: readonly string[];
}) {
  const respond = useBlockRespond();
  const [counts, setCounts] = useState(() => countsOf(block));
  const [total, setTotal] = useState(() => totalOf(block, countsOf(block)));
  const [mine, setMine] = useState<string[]>(() => [...(initialSelection ?? [])]);
  const [seenBlock, setSeenBlock] = useState(block);
  const [busy, setBusy] = useState(false);

  // React's prop-sync pattern: the room correction replaces the recorded counts;
  // the viewer's own pick stays local (the protocol has no viewer field).
  if (block !== seenBlock) {
    setSeenBlock(block);
    const next = countsOf(block);
    setCounts(next);
    setTotal(totalOf(block, next));
  }

  const tap = (optionId: string): void => {
    if (respond === null || busy) {
      return;
    }
    const next = toggle(mine, optionId, block.multiple === true);
    const nextCounts = { ...counts };
    for (const id of next) {
      if (!mine.includes(id)) {
        nextCounts[id] = (nextCounts[id] ?? 0) + 1;
      }
    }
    for (const id of mine) {
      if (!next.includes(id)) {
        nextCounts[id] = Math.max(0, (nextCounts[id] ?? 0) - 1);
      }
    }
    const previous = { mine, counts, total };
    setMine(next);
    setCounts(nextCounts);
    setTotal(Math.max(0, total + next.length - mine.length));
    setBusy(true);
    void respond.answer(block.id, { optionIds: next }).then((data) => {
      setBusy(false);
      if (data === null) {
        setMine(previous.mine);
        setCounts(previous.counts);
        setTotal(previous.total);
      }
    });
  };

  return (
    <>
      <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
        <ChartColumn className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{block.question}</span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-[#8a8a8a]">
          {total} {total === 1 ? 'vote' : 'votes'}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {block.options.map((option) => {
          const chosen = mine.includes(option.id);
          const count = counts[option.id] ?? 0;
          const width = `${Math.round((count / Math.max(total, 1)) * 100)}%`;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={chosen}
              disabled={respond === null || busy}
              aria-disabled={respond === null || busy}
              onClick={() => tap(option.id)}
              className="flex w-full flex-col gap-1.5 rounded-[6px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-[#ededed]">
                  <span className="truncate">{option.label}</span>
                  {chosen && (
                    <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-[#ededed]">
                      <Check
                        role="img"
                        aria-label="Your vote"
                        className="size-2.5 text-[#0a0a0a]"
                        strokeWidth={3}
                      />
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-[13px] tabular-nums',
                    chosen ? 'text-[#ededed]' : 'text-[#a1a1a1]',
                  )}
                >
                  {count}
                </span>
              </span>
              <span
                className="block h-1.5 overflow-hidden rounded-full bg-[#0c0c0c]"
                style={TRACK_STYLE}
              >
                <span
                  className="block h-full rounded-full"
                  style={{ width, background: chosen ? FILL_LIGHT : '#3a3a3a' }}
                />
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
