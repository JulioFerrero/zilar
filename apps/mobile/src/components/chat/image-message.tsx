import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import type { UiImage } from '@/lib/types';
import { imageGradient } from '@/lib/image-presets';

const FALLBACK_GRADIENT = ['#c9dfc5', '#d8e8f0'] as const;
const IMAGE_WIDTH = 240;

/** Rounded gradient placeholder: mock images have no external assets. */
export function ImageMessage({ image }: { image: UiImage }) {
  const gradient = imageGradient(image.url) ?? FALLBACK_GRADIENT;
  return (
    <View className="overflow-hidden rounded-xl">
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: IMAGE_WIDTH, aspectRatio: image.width / image.height }}
      />
    </View>
  );
}
