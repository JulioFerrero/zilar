/**
 * The media examples of the hidden blocks catalog (T-1868): the four-photo
 * grid, the one-photo card and the file card from
 * `docs/design/mockups/blocks/PhoneContent.dc.html:52-66,144-160`. The media
 * ids are mock-only, so every tile falls back to the board's `#181818`
 * placeholder until the device can load it.
 */
import type { BlocksData } from '@zilar/protocol';
import { View } from 'react-native';

import { BlockCard } from '@/components/chat/blocks/block-card';
import { Text } from '@/components/ui/text';

type Example = { label: string; data: BlocksData; time: string };

const EXAMPLES: readonly Example[] = [
  {
    label: '20 · IMAGES · FOUR',
    time: '13:52',
    data: {
      fallback:
        'Four photos: hills at sunset, the city at night, the sea, and 3 more. Tap to view.',
      blocks: [
        {
          kind: 'images',
          items: ['dev-photo-sunset', 'dev-photo-city', 'dev-photo-sea', 'dev-photo-hills'],
          extra: 3,
        },
      ],
    },
  },
  {
    label: '20 · IMAGES · ONE',
    time: '13:53',
    data: {
      fallback: 'One photo: hills at sunset. Tap to view.',
      blocks: [{ kind: 'images', items: ['dev-photo-sunset'] }],
    },
  },
  {
    label: '24 · FILE',
    time: 'Sat 10:00',
    data: {
      fallback: 'File prices-october.csv, 12 KB, CSV, 31 rows.',
      blocks: [
        {
          kind: 'file',
          media: 'dev-file-prices',
          name: 'prices-october.csv',
          size: '12 KB',
          format: 'CSV',
          rows: '31',
        },
      ],
    },
  },
];

function Time({ children }: { children: string }) {
  return <Text className="font-mono text-[10px] text-[#8a8a8a]">{children}</Text>;
}

export function MediaBlockExamples() {
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
