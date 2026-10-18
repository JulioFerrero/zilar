// effect-plain: a presentational control; the block card owns the request.
import type { ChecklistBlock as ChecklistBlockData } from '@zilar/protocol';
import { Check, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useBlockRespond } from './BlockRespond';

const BOX_ON = {
  background: 'linear-gradient(180deg,#ffffff,#d4d4d4)',
  boxShadow: 'inset 0 1px 0 #fff, 0 1px 2px rgba(0,0,0,.8)',
};
const BOX_OFF = {
  background: '#0c0c0c',
  border: '1px solid #2a2a2a',
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,.9)',
};

export function ChecklistBlock({
  block,
  showHeading,
}: {
  block: ChecklistBlockData;
  showHeading: boolean;
}) {
  const respond = useBlockRespond();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [seenBlock, setSeenBlock] = useState(block);

  if (block !== seenBlock) {
    setSeenBlock(block);
    setOverrides({});
  }

  const toggleItem = (item: ChecklistBlockData['items'][number]): void => {
    if (respond === null) {
      return;
    }
    const done = !(overrides[item.id] ?? item.done);
    setOverrides((current) => ({ ...current, [item.id]: done }));
    void respond.answer(block.id, { done }, item.id).then((data) => {
      if (data === null) {
        setOverrides((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      }
    });
  };

  const doneCount = block.items.filter((item) => overrides[item.id] ?? item.done).length;
  return (
    <>
      {showHeading && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
          <span className="shrink-0 font-mono text-[12px] text-[#8a8a8a]">
            {doneCount} of {block.items.length}
          </span>
        </div>
      )}
      <div className="flex flex-col">
        {block.items.map((item) => {
          const done = overrides[item.id] ?? item.done;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={done}
              aria-label={item.label}
              disabled={respond === null}
              aria-disabled={respond === null}
              onClick={() => toggleItem(item)}
              className="flex min-h-[28px] w-full items-center gap-2.5 rounded-[6px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ededed]/50 disabled:cursor-default"
            >
              <span
                aria-hidden="true"
                className="flex size-[18px] shrink-0 items-center justify-center rounded-[6px]"
                style={done ? BOX_ON : BOX_OFF}
              >
                {done && <Check className="size-3 text-[#0a0a0a]" strokeWidth={3.2} />}
              </span>
              <span
                className={cn('min-w-0 flex-1 truncate', done && 'text-[#8a8a8a] line-through')}
              >
                {item.label}
              </span>
              {item.by !== undefined && (
                <span className="shrink-0 text-[12px] text-[#8a8a8a]">{item.by}</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
