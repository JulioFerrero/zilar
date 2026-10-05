import { AVATAR_GRADIENTS } from '@zilar/chat-core';

const FALLBACK: readonly [string, string] = ['#c9dfc5', '#d8e8f0'];

function pair(index: number): readonly [string, string] {
  const gradient = AVATAR_GRADIENTS[index] ?? AVATAR_GRADIENTS[0];
  return gradient === undefined ? FALLBACK : [gradient.from, gradient.to];
}

/** Gradient placeholders used instead of image files: no external assets. */
export const IMAGE_GRADIENTS: Record<string, readonly [string, string]> = {
  sunset: pair(0),
  amber: pair(1),
  violet: pair(2),
  garden: pair(3),
  lagoon: pair(4),
  ocean: pair(5),
  blossom: pair(6),
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
