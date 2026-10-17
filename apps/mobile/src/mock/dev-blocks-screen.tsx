/**
 * Hidden mobile blocks catalog (T-1756): reachable only by the `zilar://dev/blocks`
 * URL, linked from nowhere. It renders one `BlockCard` per phone board example
 * with the boards' sample data so the lead can screenshot it next to the boards.
 * Stays unlinked in release builds; the route only loads it behind `__DEV__`.
 */
import type { BlocksData } from '@zilar/protocol';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { BlockCard } from '@/components/chat/blocks/block-card';
import { Text } from '@/components/ui/text';

type Example = { label: string; data: BlocksData; time: string };

// The prices rows shared by the "Prices" and "Morning briefing" boards.
const PRICE_ROWS = [
  { label: 'BTC', value: '$82,302', change: { direction: 'up', text: '2.1%' } },
  { label: 'Gold', value: '$4,152', change: { direction: 'down', text: '0.3%' } },
  { label: 'S&P 500', value: '7,744', change: { direction: 'up', text: '0.4%' } },
] as const;

// The countdown example counts to a target a little over two hours out from
// load, so the card ticks down while the catalog is open.
const COUNTDOWN_TARGET = new Date(Date.now() + 2 * 60 * 60 * 1000 + 14 * 60 * 1000 + 9 * 1000);

const EXAMPLES: readonly Example[] = [
  {
    label: '01 · FIGURES',
    time: '09:00',
    data: {
      title: 'Prices',
      icon: 'chart',
      meta: 'daily 09:00',
      fallback: 'BTC $82,302 up 2.1% · Gold $4,152 down 0.3% · S&P 500 7,744 up 0.4%',
      blocks: [{ kind: 'figure', rows: [...PRICE_ROWS] }],
    },
  },
  {
    label: '02 · BIG NUMBER + CHANGE',
    time: '09:00',
    data: {
      fallback: 'Bitcoin $82,302, up 2.1% today',
      blocks: [
        {
          kind: 'number',
          label: 'Bitcoin',
          value: '$82,302',
          code: 'BTC',
          change: { direction: 'up', text: '2.1% today' },
          points: [32, 30, 33, 26, 28, 22, 24, 17, 19, 13, 15, 8, 6],
        },
      ],
    },
  },
  {
    label: '08 · CHECKLIST',
    time: '18:12',
    data: {
      fallback:
        'Groceries: 2 of 5 done. Eggs and Milk bought; Tomatoes, Bread and Coffee beans left.',
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
    },
  },
  {
    label: '12 · STATUS LIST',
    time: '07:00',
    data: {
      fallback:
        'Services: chat.zilar.app up 99.98%, www.zilar.app up 100%, Nightly backup 2 h late, Desk egress down since 06:58.',
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
    },
  },
  {
    label: '19 · LINK CARD',
    time: '11:20',
    data: {
      fallback: 'github.com — JulioFerrero/zilar: A messenger you host yourself.',
      blocks: [
        {
          kind: 'link',
          url: 'https://github.com/JulioFerrero/zilar',
          site: 'github.com',
          title: 'JulioFerrero/zilar',
          description: 'A messenger you host yourself. Your friends and your AIs in one chat.',
        },
      ],
    },
  },
  {
    label: '25 · CALLOUT · success',
    time: '03:04',
    data: {
      fallback: 'Backup finished · 2.0 GB',
      blocks: [{ kind: 'callout', tone: 'success', text: 'Backup finished · 2.0 GB' }],
    },
  },
  {
    label: '25 · CALLOUT · warning',
    time: '19:40',
    data: {
      fallback: 'Daily limit almost used · $0.92 of $1.00',
      blocks: [
        { kind: 'callout', tone: 'warning', text: 'Daily limit almost used · $0.92 of $1.00' },
      ],
    },
  },
  {
    label: 'MORNING BRIEFING (TWO BLOCKS)',
    time: '08:00',
    data: {
      title: 'Morning briefing',
      icon: 'cloud-sun',
      meta: 'Fri 17 Oct',
      fallback: 'Morning briefing: prices and two tasks.',
      blocks: [
        { kind: 'figure', rows: [...PRICE_ROWS] },
        {
          kind: 'checklist',
          id: 'my-day',
          title: 'My day',
          items: [
            { id: 'bank', label: 'Call the bank', done: true },
            { id: 'parcel', label: 'Pick up the parcel', done: false },
          ],
        },
      ],
    },
  },
  {
    label: '03 · STAT TILES',
    time: '10:30',
    data: {
      title: 'chat.zilar.app',
      icon: 'activity',
      fallback: 'chat.zilar.app: CPU 23%, Memory 3.1/8 GB, Disk 41%, Uptime 12 d.',
      blocks: [
        {
          kind: 'stats',
          tiles: [
            { label: 'CPU', value: '23%', ratio: 0.23 },
            { label: 'Memory', value: '3.1/8 GB', ratio: 0.39 },
            { label: 'Disk', value: '41%', ratio: 0.41 },
            { label: 'Uptime', value: '12 d' },
          ],
        },
      ],
    },
  },
  {
    label: '04 · TABLE',
    time: 'Sun 20:00',
    data: {
      title: 'AI spend this week',
      fallback:
        'AI spend this week: Deepseek 142 turns, 1.2M tokens, $0.38; Claude 38, 410k, $1.12; GLM 61, 650k, $0.00. Total 241 turns, 2.3M tokens, $1.50.',
      blocks: [
        {
          kind: 'table',
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
    },
  },
  {
    label: '09 · PROGRESS',
    time: '03:02',
    data: {
      fallback: 'Backup: 70% uploaded, 1.4 of 2.0 GB, about 1 min left.',
      blocks: [
        {
          kind: 'progress',
          label: 'Uploading the backup',
          ratio: 0.7,
          detail: '1.4 / 2.0 GB',
          note: 'about 1 min left',
        },
      ],
    },
  },
  {
    label: '10 · TIMELINE',
    time: '07:15',
    data: {
      fallback: 'Parcel 4417: ordered Mon 10:02, shipped Tue 08:40, out for delivery, delivered.',
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
    },
  },
  {
    label: '11 · COUNTDOWN',
    time: '16:05',
    data: {
      fallback: 'Flight to Barcelona: boarding 18:40, gate K72.',
      blocks: [
        {
          kind: 'countdown',
          label: 'Flight to Barcelona',
          targetAt: COUNTDOWN_TARGET.toISOString(),
          note: 'Boarding 18:40 · Gate K72',
        },
      ],
    },
  },
  {
    label: '21 · PLACE',
    time: '20:31',
    data: {
      fallback: 'Casa Paco — Calle Mayor 12 · 650 m · 8 min walk.',
      blocks: [
        {
          kind: 'place',
          title: 'Casa Paco',
          subtitle: 'Calle Mayor 12 · 650 m · 8 min walk',
          url: 'https://www.google.com/maps/search/?api=1&query=Calle+Mayor+12',
        },
      ],
    },
  },
  {
    label: '22 · WEATHER',
    time: '08:00',
    data: {
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
    },
  },
  {
    label: '23 · EVENT',
    time: '17:42',
    data: {
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
    },
  },
  {
    label: '05 · BAR CHART',
    time: 'Sun 20:00',
    data: {
      fallback:
        'Messages per day: Mon 142, Tue 188, Wed 161, Thu 203, Fri 256, Sat 97, Sun 237. Total 1,284.',
      blocks: [
        {
          kind: 'bars',
          title: 'Messages per day',
          value: '1,284',
          series: [
            { label: 'M', value: 142 },
            { label: 'T', value: 188 },
            { label: 'W', value: 161 },
            { label: 'T', value: 203 },
            { label: 'F', value: 256 },
            { label: 'S', value: 97 },
            { label: 'S', value: 237, current: true },
          ],
        },
      ],
    },
  },
  {
    label: '06 · LINE CHART',
    time: '09:00',
    data: {
      fallback: 'Bitcoin $82,302, up 2.1% over the last 24 hours.',
      blocks: [
        {
          kind: 'line',
          title: 'BTC · 24 h',
          value: '$82,302',
          points: [
            79100, 79800, 79400, 80600, 80200, 81300, 80800, 81800, 81400, 82100, 81600, 82200,
            81900, 82300,
          ],
          min: 79100,
          max: 82300,
          labels: ['09:00', '21:00', 'now'],
        },
      ],
    },
  },
  {
    label: '07 · GAUGE',
    time: '14:00',
    data: {
      fallback: 'Daily limit: $0.62 of $1.00 used, 62 percent, resets at 00:00.',
      blocks: [
        {
          kind: 'gauge',
          label: 'Daily limit',
          ratio: 0.62,
          value: '$0.62 of $1.00',
          caption: 'resets at 00:00',
        },
      ],
    },
  },
];

function Time({ children }: { children: string }) {
  return <Text className="font-mono text-[10px] text-[#8a8a8a]">{children}</Text>;
}

export default function BlocksDevScreen() {
  return (
    <RequireAuth>
      <BlocksCatalog />
    </RequireAuth>
  );
}

function BlocksCatalog() {
  return (
    <SafeAreaView className="flex-1 bg-[#0a0a0a]">
      <ScrollView
        className="flex-1 px-3 pt-6"
        contentContainerStyle={{ paddingBottom: 48 }}
        testID="blocks-dev-screen"
      >
        <Text variant="h3" color="#ededed">
          Message blocks
        </Text>
        <Text className="mt-1 text-[13px] text-[#8a8a8a]">One card per phone board example.</Text>
        <View className="mt-6 gap-6">
          {EXAMPLES.map((example) => (
            <View key={example.label} className="gap-2">
              <Text className="font-mono text-[11px] tracking-[0.06em] text-[#8a8a8a]">
                {example.label}
              </Text>
              <BlockCard data={example.data} footer={<Time>{example.time}</Time>} />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
