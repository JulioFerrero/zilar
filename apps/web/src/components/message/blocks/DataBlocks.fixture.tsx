import type { BlocksData } from '@zilar/protocol';
import { type ReactNode } from 'react';
import { BlockCard } from './BlockCard';

// Cosmos fixture (T-1770): the board's own 03 stat tiles and 04 table samples
// (`docs/design/mockups/blocks/WebNumbers.dc.html:110-147`), on the boards'
// `#0a0a0a` page.

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

// `WebNumbers.dc.html:110-127`.
const SERVERS: BlocksData = {
  fallback: 'chat.zilar.app: CPU 23%, Memory 3.1 / 8 GB, Disk 41%, Uptime 12 d',
  blocks: [
    {
      kind: 'stats',
      title: 'chat.zilar.app',
      tiles: [
        { label: 'CPU', value: '23%', ratio: 0.23 },
        { label: 'Memory', value: '3.1 / 8 GB', ratio: 0.39 },
        { label: 'Disk', value: '41%', ratio: 0.41 },
        { label: 'Uptime', value: '12 d' },
      ],
    },
  ],
};

// `WebNumbers.dc.html:129-147`.
const SPEND: BlocksData = {
  fallback:
    'AI spend this week: Deepseek 142 turns, 1.2M tokens, $0.38; Claude 38 turns, 410k tokens, $1.12; GLM 61 turns, 650k tokens, $0.00; total 241 turns, 2.3M tokens, $1.50',
  blocks: [
    {
      kind: 'table',
      title: 'AI spend this week',
      columns: ['AI', 'Turns', 'Tokens', 'Cost'],
      rows: [
        ['Deepseek', '142', '1.2M', '$0.38'],
        ['Claude', '38', '410k', '$1.12'],
        ['GLM', '61', '650k', '$0.00'],
        ['Total', '241', '2.3M', '$1.50'],
      ],
      total: true,
    },
  ],
};

export default {
  '03 · STAT TILES': (
    <div className="min-h-screen bg-[#0a0a0a] p-10">
      <Example label="03 · STAT TILES">
        <BlockCard data={SERVERS} footer={<Time at="10:30" />} />
      </Example>
    </div>
  ),
  '04 · TABLE': (
    <div className="min-h-screen bg-[#0a0a0a] p-10">
      <Example label="04 · TABLE">
        <BlockCard data={SPEND} footer={<Time at="Sun 20:00" />} />
      </Example>
    </div>
  ),
};
