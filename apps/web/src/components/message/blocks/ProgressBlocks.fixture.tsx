import type { BlocksData } from '@zilar/protocol';
import { type ReactNode } from 'react';
import { BlockCard } from './BlockCard';

// Cosmos fixture (T-1772): the progress, timeline and countdown samples of the
// board `docs/design/mockups/blocks/WebProgress.dc.html` on its `#0a0a0a` page.

/** The boards' `.time` (mono 10, `#8a8a8a`) as a plain footer. */
function Time({ at }: { at: string }) {
  return <span className="font-mono text-[10px] text-[#8a8a8a]">{at}</span>;
}

function Example({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="pl-1 font-mono text-[11px] tracking-[.06em] text-[#8a8a8a]">{label}</span>
      {children}
    </div>
  );
}

// `WebProgress.dc.html:63-77`.
const BACKUP: BlocksData = {
  fallback: 'Uploading the backup: 70% · 1.4 / 2.0 GB · about 1 min left',
  blocks: [
    {
      kind: 'progress',
      label: 'Uploading the backup',
      ratio: 0.7,
      detail: '1.4 / 2.0 GB',
      note: 'about 1 min left',
    },
  ],
};

// `WebProgress.dc.html:79-96`. The target is computed from now, so the tiles tick.
const FLIGHT: BlocksData = {
  fallback: 'Flight to Barcelona: boarding 18:40 · Gate K72',
  blocks: [
    {
      kind: 'countdown',
      label: 'Flight to Barcelona',
      targetAt: new Date(Date.now() + (2 * 60 * 60 + 14 * 60 + 9) * 1000).toISOString(),
      note: 'Boarding 18:40 · Gate K72',
    },
  ],
};

// A target already reached shows the muted word instead of the tiles.
const DEPARTED: BlocksData = {
  fallback: 'Boarding: started · Gate K72',
  blocks: [
    {
      kind: 'countdown',
      label: 'Boarding',
      targetAt: new Date(Date.now() - 60_000).toISOString(),
      note: 'Gate K72',
    },
  ],
};

// `WebProgress.dc.html:101-127`.
const PARCEL: BlocksData = {
  fallback:
    'Parcel 4417: ordered Mon 10:02, shipped Tue 08:40, out for delivery 07:15 (arrives 12:00 to 14:00), delivered.',
  blocks: [
    {
      kind: 'timeline',
      title: 'Parcel 4417',
      steps: [
        { label: 'Ordered', at: 'Mon 10:02', state: 'done' },
        { label: 'Shipped', at: 'Tue 08:40', state: 'done' },
        {
          label: 'Out for delivery',
          at: '07:15',
          detail: 'Arrives 12:00 to 14:00',
          state: 'current',
        },
        { label: 'Delivered', state: 'todo' },
      ],
    },
  ],
};

export default {
  'All examples': (
    <div className="min-h-screen bg-[#0a0a0a] p-10">
      <div className="flex flex-wrap items-start gap-8">
        <Example label="09 · PROGRESS">
          <BlockCard data={BACKUP} footer={<Time at="03:02" />} />
        </Example>
        <Example label="11 · COUNTDOWN">
          <BlockCard data={FLIGHT} footer={<Time at="16:05" />} />
        </Example>
        <Example label="11 · COUNTDOWN · PAST">
          <BlockCard data={DEPARTED} footer={<Time at="18:41" />} />
        </Example>
        <Example label="10 · TIMELINE">
          <BlockCard data={PARCEL} footer={<Time at="07:15" />} />
        </Example>
      </div>
    </div>
  ),
};
