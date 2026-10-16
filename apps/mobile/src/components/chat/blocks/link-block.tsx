import { linkHost } from '@zilar/chat-core';
import type { LinkBlock as LinkBlockData } from '@zilar/protocol';
import { Link } from 'lucide-react-native';
import { Linking, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { iconKey } from '@/lib/depth';
import { safeLinkTarget } from '@/lib/links';

/**
 * 19 · LINK CARD: one https link inside an inner `#101010` tile, opened with
 * `Linking.openURL` (as `link-preview-card.tsx` does). The site is the payload's
 * `site` or the link's own host; the key is the shared icon-key recipe.
 */
export function LinkBlock({ block }: { block: LinkBlockData }) {
  const host = block.site ?? linkHost(block.url);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={block.url}
      onPress={() => {
        const target = safeLinkTarget(block.url);
        if (target !== undefined) {
          void Linking.openURL(target);
        }
      }}
      className="flex-row gap-3 rounded-[12px] border border-[#1f1f1f] bg-[#101010] p-2.5 active:opacity-80"
    >
      <View className="min-w-0 flex-1 justify-center gap-1">
        {host === '' ? null : (
          <Text className="font-mono text-[11px] text-[#8a8a8a]" numberOfLines={1}>
            {host}
          </Text>
        )}
        <Text className="font-medium" numberOfLines={2}>
          {block.title}
        </Text>
        {block.description === undefined ? null : (
          <Text className="text-[13px] leading-[18px] text-[#a1a1a1]" numberOfLines={3}>
            {block.description}
          </Text>
        )}
      </View>
      <View
        className="h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[12px]"
        style={iconKey}
      >
        <Link size={20} color="#d4d4d4" aria-hidden />
      </View>
    </Pressable>
  );
}
