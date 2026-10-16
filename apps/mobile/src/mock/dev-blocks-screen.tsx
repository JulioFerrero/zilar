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
