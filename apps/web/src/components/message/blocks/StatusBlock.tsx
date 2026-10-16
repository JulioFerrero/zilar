import { statusTone, type BlockTone } from '@zilar/chat-core';
import type { StatusBlock as StatusBlockData } from '@zilar/protocol';
import { Activity } from 'lucide-react';

// The dot colours of the boards (`WebProgress.dc.html:32-35`): green, amber and
// red, each with a soft ring; the tone picks the pair.
const DOT: Record<BlockTone, { color: string; ring: string }> = {
  positive: { color: '#22c55e', ring: 'rgba(34,197,94,.14)' },
  warning: { color: '#fbbf24', ring: 'rgba(251,191,36,.14)' },
  negative: { color: '#ef4444', ring: 'rgba(239,68,68,.14)' },
  neutral: { color: '#a1a1a1', ring: 'rgba(161,161,161,.14)' },
  info: { color: '#ededed', ring: 'rgba(237,237,237,.12)' },
};

// The board shows a word only in the dot's accessible label, never on screen.
const DOT_LABEL: Record<StatusBlockData['rows'][number]['status'], string> = {
  ok: 'Up',
  warn: 'Late',
  bad: 'Down',
};

/** 12 · STATUS LIST: a dot with a soft ring plus a value, never a word. */
export function StatusBlock({ block }: { block: StatusBlockData }) {
  return (
    <>
      <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
        <Activity className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{block.title}</span>
      </div>
      <div className="flex flex-col">
        {block.rows.map((row, index) => {
          // A newer server may add a status word (expand/contract); an unknown
          // one falls back to the neutral dot instead of leaving `dot` undefined
          // and throwing on `dot.color`.
          const dot = DOT[statusTone(row.status)] ?? DOT.neutral;
          return (
            <div
              key={`${row.label}-${index}`}
              className={
                index < block.rows.length - 1
                  ? 'flex min-h-[28px] items-center gap-2.5 border-b border-[#1c1c1c]'
                  : 'flex min-h-[28px] items-center gap-2.5'
              }
            >
              <span
                role="img"
                aria-label={DOT_LABEL[row.status]}
                className="size-2 shrink-0 rounded-full"
                style={{ background: dot.color, boxShadow: `0 0 0 3px ${dot.ring}` }}
              />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.value !== undefined && (
                <span className="shrink-0 font-mono text-[12px] text-[#a1a1a1]">{row.value}</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
