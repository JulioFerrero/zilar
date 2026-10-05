import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import type { UiImage } from '@/lib/types';
import { imageGradient } from '@/lib/image-presets';

const FALLBACK_GRADIENT = ['#262626', '#1a1a1a'] as const;
const IMAGE_WIDTH = 240;

/** Rounded gradient placeholder with the `--edge` key border (ui-style.md §5). */
export function ImageMessage({ image }: { image: UiImage }) {
  const gradient = imageGradient(image.url) ?? FALLBACK_GRADIENT;
  return (
    <View className="overflow-hidden rounded-xl border border-edge">
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: IMAGE_WIDTH, aspectRatio: image.width / image.height }}
      />
    </View>
  );
}
