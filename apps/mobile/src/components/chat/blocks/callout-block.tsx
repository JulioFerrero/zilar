import { calloutTone, type BlockTone } from '@zilar/chat-core';
import type { CalloutBlock as CalloutBlockData } from '@zilar/protocol';
import { Check, Info, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';

// The tone's glyph and colour; the circle behind it carries the soft ring.
const LOOK: Record<BlockTone, { icon: LucideIcon; color: string; ring: string }> = {
  positive: { icon: Check, color: '#4ade80', ring: 'rgba(34,197,94,.14)' },
  warning: { icon: TriangleAlert, color: '#fbbf24', ring: 'rgba(251,191,36,.14)' },
  negative: { icon: TriangleAlert, color: '#ef4444', ring: 'rgba(239,68,68,.14)' },
  info: { icon: Info, color: '#60a5fa', ring: 'rgba(96,165,250,.14)' },
  neutral: { icon: Info, color: '#a1a1a1', ring: 'rgba(161,161,161,.14)' },
};

/** 25 · CALLOUT: a tone icon in its tinted circle, then the line. */
export function CalloutBlock({ block }: { block: CalloutBlockData }) {
  const look = LOOK[calloutTone(block.tone)];
  const Icon = look.icon;
  return (
    <View className="flex-row items-center gap-3">
      <View
        className="h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: look.ring }}
      >
        <Icon size={16} color={look.color} aria-hidden />
      </View>
      <Text className="flex-1" numberOfLines={3}>
        {block.text}
      </Text>
    </View>
  );
}
