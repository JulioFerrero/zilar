import type { BlocksData } from '@zilar/protocol';
import { type ReactNode } from 'react';
import { BlockCard } from './BlockCard';

// Cosmos fixture (T-1771): the board's 05 bars, 06 line and 07 gauge on the
// boards' `#0a0a0a` page, next to `docs/design/mockups/blocks/WebNumbers.dc.html`.

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

// `WebNumbers.dc.html:150-165`.
const MESSAGES: BlocksData = {
  fallback:
    'Messages per day: 1,284. Mon 142, Tue 188, Wed 161, Thu 203, Fri 256, Sat 97, Sun 237.',
  blocks: [
    {
      kind: 'bars',
      title: 'Messages per day',
      value: '1,284',
      series: [
        { label: 'Mon', value: 142 },
        { label: 'Tue', value: 188 },
        { label: 'Wed', value: 161 },
        { label: 'Thu', value: 203 },
        { label: 'Fri', value: 256 },
        { label: 'Sat', value: 97 },
        { label: 'Sun', value: 237, current: true },
      ],
    },
  ],
};

// `WebNumbers.dc.html:67-86`.
const BITCOIN: BlocksData = {
  fallback: 'Bitcoin, last 24 hours: $82,302, rising from 79,100 to 82,300.',
  blocks: [
    {
      kind: 'line',
      title: 'BTC · 24 h',
      value: '$82,302',
      points: [
        79100, 79500, 79300, 80000, 79900, 80400, 80100, 80800, 80600, 81300, 81100, 81700, 81600,
        82300,
      ],
      min: 79100,
      max: 82300,
      labels: ['09:00', '15:00', '21:00', '03:00', 'now'],
    },
  ],
};

// `WebNumbers.dc.html:90-106`.
const DAILY_LIMIT: BlocksData = {
  fallback: 'Daily limit: $0.62 of $1.00 used, 62 percent. Resets at 00:00.',
  blocks: [
    {
      kind: 'gauge',
      label: 'Daily limit',
      ratio: 0.62,
      value: '$0.62 of $1.00',
      caption: 'resets at 00:00',
      detail: 'across all chats',
    },
  ],
};

export default {
  '05 · BAR CHART': (
    <div className="min-h-screen bg-[#0a0a0a] p-10">
      <Example label="05 · BAR CHART">
        <BlockCard data={MESSAGES} footer={<Time at="Sun 20:00" />} />
      </Example>
    </div>
  ),
  '06 · LINE CHART': (
    <div className="min-h-screen bg-[#0a0a0a] p-10">
      <Example label="06 · LINE CHART">
        <BlockCard data={BITCOIN} footer={<Time at="09:00" />} />
      </Example>
    </div>
  ),
  '07 · GAUGE': (
    <div className="min-h-screen bg-[#0a0a0a] p-10">
      <Example label="07 · GAUGE">
        <BlockCard data={DAILY_LIMIT} footer={<Time at="00:00" />} />
      </Example>
    </div>
  ),
};
