import { ballAvatarSvg } from '@zilar/ball-avatar';

import { graphemes } from './text';

export interface AvatarGradient {
  index: number;
  from: string;
  to: string;
}

/** The seven messenger-style avatar gradients from `docs/design/ui-style.md` §2. */
export const AVATAR_GRADIENTS: readonly AvatarGradient[] = [
  { index: 0, from: '#ff885e', to: '#ff516a' },
  { index: 1, from: '#ffcd6a', to: '#ffa85c' },
  { index: 2, from: '#82b1ff', to: '#665fff' },
  { index: 3, from: '#a0de7e', to: '#54cb68' },
  { index: 4, from: '#53edd6', to: '#28c9b7' },
  { index: 5, from: '#72d5fd', to: '#2a9ef1' },
  { index: 6, from: '#e0a2f3', to: '#d669ed' },
];

function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Picks one of the seven gradients deterministically from an id. */
export function avatarGradient(id: string): AvatarGradient {
  const index = hashId(id) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index] ?? AVATAR_GRADIENTS[0]!;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function firstLetterOrDigit(word: string): string {
  for (const grapheme of graphemes(word)) {
    if (LETTER_OR_DIGIT.test(grapheme)) {
      return grapheme;
    }
  }
  return '';
}

/**
 * Up to two initials from a name: the first letter or digit of the first two
 * words that contain one. Emoji and other symbols never count, so a name with
 * no letters or digits returns an empty string.
 */
export function initials(name: string): string {
  const characters = name
    .trim()
    .split(/\s+/)
    .map(firstLetterOrDigit)
    .filter((character) => character.length > 0);
  return ((characters[0] ?? '') + (characters[1] ?? '')).toUpperCase();
}

/** The glossy 3D ball avatar SVG for a seed, scalable to any box. */
export function avatarSvg(seed: string): string {
  return ballAvatarSvg(seed);
}

/** The ball avatar as an SVG `data:` URI, ready for an image source. */
export function avatarDataUri(seed: string): string {
  return 'data:image/svg+xml,' + encodeURIComponent(avatarSvg(seed));
}
