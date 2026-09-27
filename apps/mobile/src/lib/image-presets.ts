import { AVATAR_GRADIENTS } from './avatar';

/** Gradient placeholders used instead of image files: no external assets. */
export const IMAGE_GRADIENTS: Record<string, readonly [string, string]> = {
  sunset: AVATAR_GRADIENTS[0],
  amber: AVATAR_GRADIENTS[1],
  violet: AVATAR_GRADIENTS[2],
  garden: AVATAR_GRADIENTS[3],
  lagoon: AVATAR_GRADIENTS[4],
  ocean: AVATAR_GRADIENTS[5],
  blossom: AVATAR_GRADIENTS[6],
};

export function gradientImage(preset: keyof typeof IMAGE_GRADIENTS): string {
  return `gradient:${preset}`;
}

export function imageGradient(url: string): readonly [string, string] | undefined {
  const [scheme, preset] = url.split(':');
  if (scheme !== 'gradient' || !preset) {
    return undefined;
  }
  return IMAGE_GRADIENTS[preset];
}
