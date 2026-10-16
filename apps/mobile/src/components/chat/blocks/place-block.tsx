import type { PlaceBlock as PlaceBlockData } from '@zilar/protocol';
import { Navigation } from 'lucide-react-native';
import { Linking, Pressable, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Text } from '@/components/ui/text';
import { safeLinkTarget } from '@/lib/links';

// The dark secondary key of the board (`PhoneContent.dc.html:90`), 40 px with a
// 12 px radius on the phone (README.md:33).
const KEY: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #1c1c1c, #121212)',
  borderWidth: 1,
  borderColor: '#2a2a2a',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px rgba(0,0,0,.6)',
};

/** The Directions key: it opens the place's link like `link-block.tsx`. */
function DirectionsKey({ url }: { url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Directions"
      onPress={() => {
        const target = safeLinkTarget(url);
        if (target !== undefined) {
          void Linking.openURL(target);
        }
      }}
      className="h-10 shrink-0 flex-row items-center justify-center gap-1.5 rounded-[12px] px-[14px] active:opacity-80"
      style={KEY}
    >
      <Navigation size={14} color="#d4d4d4" aria-hidden />
      <Text className="text-[14px] font-medium text-[#ededed]">Directions</Text>
    </Pressable>
  );
}

/**
 * 21 · PLACE: the title, the address line and a Directions key when there is a
 * link. The board's map image is an uploaded media id and is out of scope, so
 * the card is drawn without it.
 */
export function PlaceBlock({ block }: { block: PlaceBlockData }) {
  return (
    <View className="flex-row items-center gap-2.5">
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-medium" numberOfLines={1}>
          {block.title}
        </Text>
        {block.subtitle === undefined ? null : (
          <Text className="text-[13px] text-[#a1a1a1]" numberOfLines={2}>
            {block.subtitle}
          </Text>
        )}
      </View>
      {block.url === undefined ? null : <DirectionsKey url={block.url} />}
    </View>
  );
}
