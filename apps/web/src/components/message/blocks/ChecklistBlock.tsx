import { checklistCount } from '@zilar/chat-core';
import type { ChecklistBlock as ChecklistBlockData } from '@zilar/protocol';
import { Check, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';

// The tick recipe of the boards (`Main.dc.html:26-28`): a raised light box when
// done, a recessed well when not. The payload is read-only in this task (T-1755):
// the box shows the tick, and nothing is a control.
const BOX_ON = {
  background: 'linear-gradient(180deg,#ffffff,#d4d4d4)',
  boxShadow: 'inset 0 1px 0 #fff, 0 1px 2px rgba(0,0,0,.8)',
};
const BOX_OFF = {
  background: '#0c0c0c',
  border: '1px solid #2a2a2a',
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,.9)',
};

/**
 * 08 · CHECKLIST: the ticks everyone sees, read-only in this task. `showHeading`
 * hides the block's own title row when the card already draws a header.
 */
export function ChecklistBlock({
  block,
  showHeading,
}: {
  block: ChecklistBlockData;
  showHeading: boolean;
}) {
  const { done, total } = checklistCount(block);
  return (
    <>
      {showHeading && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
          <span className="shrink-0 font-mono text-[12px] text-[#8a8a8a]">
            {done} of {total}
          </span>
        </div>
      )}
      <div className="flex flex-col">
        {block.items.map((item) => (
          <div key={item.id} className="flex min-h-[28px] items-center gap-2.5">
            <input
              type="checkbox"
              checked={item.done}
              readOnly
              tabIndex={-1}
              aria-label={item.label}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className="flex size-[18px] shrink-0 items-center justify-center rounded-[6px]"
              style={item.done ? BOX_ON : BOX_OFF}
            >
              {item.done && <Check className="size-3 text-[#0a0a0a]" strokeWidth={3.2} />}
            </span>
            <span
              className={cn('min-w-0 flex-1 truncate', item.done && 'text-[#8a8a8a] line-through')}
            >
              {item.label}
            </span>
            {item.by !== undefined && (
              <span className="shrink-0 text-[12px] text-[#8a8a8a]">{item.by}</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
