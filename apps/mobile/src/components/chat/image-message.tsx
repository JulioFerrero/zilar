import { LinearGradient } from 'expo-linear-gradient';

import { mediaFrame } from '@/components/chat/media-frame';
import type { UiImage } from '@/lib/types';
import { imageGradient } from '@/lib/image-presets';

const FALLBACK_GRADIENT = ['#262626', '#1a1a1a'] as const;

/** A gradient placeholder sized to the image's aspect ratio. */
export function ImageMessage({ image }: { image: UiImage }) {
  const gradient = imageGradient(image.url) ?? FALLBACK_GRADIENT;
  const { width, height } = mediaFrame(image.width / image.height);
  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width, height }}
    />
  );
}
