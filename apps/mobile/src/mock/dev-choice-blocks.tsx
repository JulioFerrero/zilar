/**
 * The choice examples of the hidden blocks catalog (T-1796): buttons, poll,
 * pick one, quick form, rating and the alert rule, drawn from
 * `docs/design/mockups/blocks/PhoneChoices.dc.html`. Kept out of
 * `dev-blocks-screen.tsx` so that file stays a plain list. Without a respond
 * context every control is drawn disabled, as it is on own cards.
 */
import type { BlocksData } from '@zilar/protocol';
import { View } from 'react-native';

import { BlockCard } from '@/components/chat/blocks/block-card';
import { Text } from '@/components/ui/text';

type Example = { label: string; data: BlocksData; time: string };

const EXAMPLES: readonly Example[] = [
  {
    label: '13 · BUTTONS',
    time: '17:40',
    data: {
      fallback: 'Casa Paco has a table for 4 at 21:00. Book it?',
      blocks: [
        {
          kind: 'buttons',
          id: 'book-table',
          text: 'Casa Paco has a table for 4 at 21:00. Book it?',
          actions: [
            { id: 'book', label: 'Book it', style: 'light' },
            { id: 'another', label: 'Another time', style: 'dark' },
            { id: 'skip', label: 'Skip', style: 'dark' },
          ],
        },
      ],
    },
  },
  {
    label: '14 · POLL',
    time: 'closes 18:00',
    data: {
      fallback: 'Dinner on Friday? Sushi 3, Pizza 5, Tapas 1. 9 votes.',
      blocks: [
        {
          kind: 'poll',
          id: 'dinner',
          question: 'Dinner on Friday?',
          votes: 9,
          options: [
            { id: 'sushi', label: 'Sushi', votes: 3 },
            { id: 'pizza', label: 'Pizza', votes: 5 },
            { id: 'tapas', label: 'Tapas', votes: 1 },
          ],
        },
      ],
    },
  },
  {
    label: '15 · PICK ONE (SELECTED)',
    time: '12:02',
    data: {
      fallback: 'Which time works for the call? 18:30.',
      blocks: [
        {
          kind: 'choice',
          id: 'call-time',
          question: 'Which time works for the call?',
          options: ['17:00', '18:30', '20:00'],
          selected: 1,
        },
      ],
    },
  },
  {
    label: '15 · PICK ONE (OPEN)',
    time: '12:02',
    data: {
      fallback: 'Which time works for the call?',
      blocks: [
        {
          kind: 'choice',
          id: 'call-time-open',
          question: 'Which time works for the call?',
          options: ['17:00', '18:30', '20:00'],
        },
      ],
    },
  },
  {
    label: '16 · QUICK FORM',
    time: '17:38',
    data: {
      fallback: 'Reserve a table: Day Fri 17 Oct, Time 21:00, People 4.',
      blocks: [
        {
          kind: 'form',
          id: 'reserve',
          title: 'Reserve a table',
          submit: 'Send',
          fields: [
            { id: 'day', label: 'Day', kind: 'text', value: 'Fri 17 Oct' },
            { id: 'time', label: 'Time', kind: 'text', value: '21:00' },
            { id: 'people', label: 'People', kind: 'number', value: '4' },
          ],
        },
      ],
    },
  },
  {
    label: '17 · RATING (SELECTED)',
    time: '20:14',
    data: {
      fallback: 'How was this summary? 4 of 5.',
      blocks: [
        {
          kind: 'rating',
          id: 'summary',
          prompt: 'How was this summary?',
          max: 5,
          selected: 4,
        },
      ],
    },
  },
  {
    label: '17 · RATING (OPEN)',
    time: '20:14',
    data: {
      fallback: 'How was this summary?',
      blocks: [{ kind: 'rating', id: 'summary-open', prompt: 'How was this summary?', max: 5 }],
    },
  },
  {
    label: '18 · ALERT RULE (ON)',
    time: '09:01',
    data: {
      fallback: 'Tell me when BTC goes above. Price $90,000. Checked every 5 min · now $82,302',
      blocks: [
        {
          kind: 'alert',
          id: 'btc-alert',
          title: 'Tell me when BTC goes above',
          field: { label: 'Price', value: '$90,000' },
          on: true,
          note: 'Checked every 5 min · now $82,302',
        },
      ],
    },
  },
  {
    label: '18 · ALERT RULE (OFF)',
    time: '09:01',
    data: {
      fallback: 'Tell me when BTC goes above. Price $90,000.',
      blocks: [
        {
          kind: 'alert',
          id: 'btc-alert-off',
          title: 'Tell me when BTC goes above',
          field: { label: 'Price', value: '$90,000' },
          on: false,
          note: 'Paused · now $82,302',
        },
      ],
    },
  },
];

function Time({ children }: { children: string }) {
  return <Text className="font-mono text-[10px] text-[#8a8a8a]">{children}</Text>;
}

export function ChoiceBlockExamples() {
  return (
    <View className="gap-6">
      {EXAMPLES.map((example) => (
        <View key={example.label} className="gap-2">
          <Text className="font-mono text-[11px] tracking-[0.06em] text-[#8a8a8a]">
            {example.label}
          </Text>
          <BlockCard data={example.data} footer={<Time>{example.time}</Time>} />
        </View>
      ))}
    </View>
  );
}
