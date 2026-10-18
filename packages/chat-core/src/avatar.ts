import { ballAvatarSvg, ballParams, ballSvg, type BallParams } from '@zilar/ball-avatar';
import { normalizeJid } from '@zilar/protocol';

import { graphemes } from './text';

export interface AvatarGradient {
  index: number;
  from: string;
  to: string;
}

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

export function initials(name: string): string {
  const characters = name
    .trim()
    .split(/\s+/)
    .map(firstLetterOrDigit)
    .filter((character) => character.length > 0);
  return ((characters[0] ?? '') + (characters[1] ?? '')).toUpperCase();
}

export function avatarSvg(seed: string): string {
  return ballAvatarSvg(normalizeJid(seed));
}

export function avatarDataUri(seed: string): string {
  return 'data:image/svg+xml,' + encodeURIComponent(avatarSvg(seed));
}

export function orbParamsFor(seed: string): BallParams {
  return ballParams(normalizeJid(seed));
}

export function orbSvg(params: BallParams, idSeed: string): string {
  return ballSvg(params, normalizeJid(idSeed));
}

export function orbDataUri(params: BallParams, idSeed: string): string {
  return 'data:image/svg+xml,' + encodeURIComponent(orbSvg(params, idSeed));
}
