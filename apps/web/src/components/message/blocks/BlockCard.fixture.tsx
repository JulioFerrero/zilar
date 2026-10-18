import type { BlocksData } from '@zilar/protocol';
import { type ReactNode } from 'react';
import { BlockCard } from './BlockCard';

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

const PRICES: BlocksData = {
  icon: 'activity',
  title: 'Prices',
  meta: 'daily 09:00',
  fallback: 'Prices: BTC $82,302 (up 2.1%), Gold $4,152 (down 0.3%), S&P 500 7,744 (up 0.4%)',
  blocks: [
    {
      kind: 'figure',
      rows: [
        { label: 'BTC', value: '$82,302', change: { direction: 'up', text: '2.1%' } },
        { label: 'Gold', value: '$4,152', change: { direction: 'down', text: '0.3%' } },
        { label: 'S&P 500', value: '7,744', change: { direction: 'up', text: '0.4%' } },
      ],
    },
  ],
};

const BITCOIN: BlocksData = {
  fallback: 'Bitcoin $82,302, up 2.1% today',
  blocks: [
    {
      kind: 'number',
      label: 'Bitcoin',
      value: '$82,302',
      code: 'BTC',
      change: { direction: 'up', text: '2.1% today' },
      points: [79.1, 79.6, 79.3, 80.2, 79.9, 80.9, 80.5, 81.4, 81.1, 81.9, 81.6, 82.1, 82.3],
    },
  ],
};

const GROCERIES: BlocksData = {
  fallback: 'Groceries: 2 of 5 done. Eggs and Milk done; Tomatoes, Bread and Coffee beans left.',
  blocks: [
    {
      kind: 'checklist',
      id: 'groceries',
      title: 'Groceries',
      items: [
        { id: 'eggs', label: 'Eggs', done: true, by: 'Ana' },
        { id: 'milk', label: 'Milk', done: true, by: 'you' },
        { id: 'tomatoes', label: 'Tomatoes', done: false },
        { id: 'bread', label: 'Bread', done: false },
        { id: 'coffee', label: 'Coffee beans', done: false },
      ],
    },
  ],
};

const SERVICES: BlocksData = {
  fallback:
    'Services: chat.zilar.app 99.98%, www.zilar.app 100%, Nightly backup 2 h late, Desk egress down since 06:58.',
  blocks: [
    {
      kind: 'status',
      title: 'Services',
      rows: [
        { label: 'chat.zilar.app', status: 'ok', value: '99.98%' },
        { label: 'www.zilar.app', status: 'ok', value: '100%' },
        { label: 'Nightly backup', status: 'warn', value: '2 h late' },
        { label: 'Desk egress', status: 'bad', value: 'since 06:58' },
      ],
    },
  ],
};

const LINK: BlocksData = {
  fallback: 'github.com/JulioFerrero/zilar — A messenger you host yourself.',
  blocks: [
    {
      kind: 'link',
      url: 'https://github.com/JulioFerrero/zilar',
      title: 'JulioFerrero/zilar',
      description: 'A messenger you host yourself. Your friends and your AIs in one chat.',
    },
  ],
};

const CALLOUT_SUCCESS: BlocksData = {
  fallback: 'Backup finished · 2.0 GB',
  blocks: [{ kind: 'callout', tone: 'success', text: 'Backup finished · 2.0 GB' }],
};

const CALLOUT_WARNING: BlocksData = {
  fallback: 'Daily limit almost used · $0.92 of $1.00',
  blocks: [{ kind: 'callout', tone: 'warning', text: 'Daily limit almost used · $0.92 of $1.00' }],
};

const MORNING_BRIEFING: BlocksData = {
  icon: 'activity',
  title: 'Morning briefing',
  meta: 'Fri 17 Oct',
  fallback:
    'Morning briefing Fri 17 Oct: BTC $82,302 (up 2.1%), Gold $4,152 (down 0.3%), S&P 500 7,744 (up 0.4%); call the bank done, pick up the parcel left.',
  blocks: [
    {
      kind: 'figure',
      rows: [
        { label: 'BTC', value: '$82,302', change: { direction: 'up', text: '2.1%' } },
        { label: 'Gold', value: '$4,152', change: { direction: 'down', text: '0.3%' } },
        { label: 'S&P 500', value: '7,744', change: { direction: 'up', text: '0.4%' } },
      ],
    },
    {
      kind: 'checklist',
      id: 'my-day',
      title: 'Today',
      items: [
        { id: 'bank', label: 'Call the bank', done: true },
        { id: 'parcel', label: 'Pick up the parcel', done: false },
      ],
    },
  ],
};

const UNKNOWN_KIND: BlocksData = {
  fallback: 'Backup is 70% done.',
  blocks: [{ kind: 'progress', label: 'Uploading the backup', ratio: 0.7 }],
};

export default {
  'All examples': (
    <div className="min-h-screen bg-[#0a0a0a] p-10">
      <div className="flex flex-wrap items-start gap-8">
        <Example label="01 · FIGURES">
          <BlockCard data={PRICES} footer={<Time at="09:00" />} />
        </Example>
        <Example label="02 · BIG NUMBER + CHANGE">
          <BlockCard data={BITCOIN} footer={<Time at="09:00" />} />
        </Example>
        <Example label="08 · CHECKLIST">
          <BlockCard data={GROCERIES} footer={<Time at="18:12" />} />
        </Example>
        <Example label="12 · STATUS LIST">
          <BlockCard data={SERVICES} footer={<Time at="07:00" />} />
        </Example>
        <Example label="19 · LINK CARD">
          <BlockCard data={LINK} footer={<Time at="11:20" />} />
        </Example>
        <Example label="25 · CALLOUT">
          <div className="flex flex-col gap-4">
            <BlockCard data={CALLOUT_SUCCESS} footer={<Time at="03:04" />} />
            <BlockCard data={CALLOUT_WARNING} footer={<Time at="19:40" />} />
          </div>
        </Example>
        <Example label="MORNING BRIEFING">
          <BlockCard data={MORNING_BRIEFING} footer={<Time at="08:00" />} />
        </Example>
        <Example label="UNKNOWN KIND · FALLBACK">
          <BlockCard data={UNKNOWN_KIND} footer={<Time at="03:02" />} />
        </Example>
      </div>
    </div>
  ),
};
