import type { BlocksData } from '@zilar/protocol';
import { type ReactNode } from 'react';
import { BlockCard } from './BlockCard';

// Cosmos fixture (T-1773): the content-group board
// `docs/design/mockups/blocks/WebContent.dc.html` (21 place, 22 weather, 23
// event), so the lead can screenshot it next to the mockup.

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

// `WebContent.dc.html:138-159`.
const WEATHER: BlocksData = {
  fallback:
    'Weather in Madrid: clear, 18°, high 22°, low 11°. 10:00 19°, 12:00 21°, 14:00 22°, 16:00 21°, 18:00 18°.',
  blocks: [
    {
      kind: 'weather',
      place: 'Madrid',
      condition: 'Clear',
      high: '22°',
      low: '11°',
      temp: '18°',
      hourly: [
        { at: '10:00', condition: 'Clear', temp: '19°' },
        { at: '12:00', condition: 'Clear', temp: '21°' },
        { at: '14:00', condition: 'Cloudy', temp: '22°' },
        { at: '16:00', condition: 'Cloudy', temp: '21°' },
        { at: '18:00', condition: 'Clear', temp: '18°' },
      ],
    },
  ],
};

// `WebContent.dc.html:162-182`. Its calendar and map keys are not drawn: the
// calendar is interactive (Wave 2) and `map` is an uploaded image, out of scope.
const EVENT: BlocksData = {
  fallback: 'Dinner at Casa Paco, Fri 21:00 – 23:00, 4 people.',
  blocks: [
    {
      kind: 'event',
      title: 'Dinner at Casa Paco',
      startAt: '2026-10-17T21:00:00+02:00',
      endAt: '2026-10-17T23:00:00+02:00',
      detail: '4 people',
    },
  ],
};

// `WebContent.dc.html:53-83`, drawn without the map image.
const PLACE: BlocksData = {
  fallback: 'Casa Paco — Calle Mayor 12 · 650 m · 8 min walk.',
  blocks: [
    {
      kind: 'place',
      title: 'Casa Paco',
      subtitle: 'Calle Mayor 12 · 650 m · 8 min walk',
      url: 'https://www.google.com/maps/search/?api=1&query=Calle+Mayor+12',
    },
  ],
};

export default {
  'Content blocks': (
    <div className="min-h-screen bg-[#0a0a0a] p-10">
      <div className="flex flex-wrap items-start gap-8">
        <Example label="22 · WEATHER">
          <BlockCard data={WEATHER} footer={<Time at="08:00" />} />
        </Example>
        <Example label="23 · EVENT">
          <BlockCard data={EVENT} footer={<Time at="17:42" />} />
        </Example>
        <Example label="21 · PLACE">
          <BlockCard data={PLACE} footer={<Time at="20:31" />} />
        </Example>
      </div>
    </div>
  ),
};
