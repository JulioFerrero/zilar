import { LinearGradient } from 'expo-linear-gradient';

import type { UiImage } from '@/lib/types';
import { imageGradient } from '@/lib/image-presets';

const FALLBACK_GRADIENT = ['#262626', '#1a1a1a'] as const;
const MAX_IMAGE_HEIGHT = 320;

/**
 * The legacy `image` field: a gradient placeholder sized to the image's aspect
 * ratio. T-1335 renders it edge to edge in the bubble (no border, no radius of
 * its own); the media bubble clips it to the bubble's corners.
 */
export function ImageMessage({ image }: { image: UiImage }) {
  const gradient = imageGradient(image.url) ?? FALLBACK_GRADIENT;
  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: '100%',
        aspectRatio: image.width / image.height,
        maxHeight: MAX_IMAGE_HEIGHT,
      }}
    />
  );
}
