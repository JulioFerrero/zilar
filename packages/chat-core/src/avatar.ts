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

// `Array.from` yields a valid pair as one string, so `length === 1` in the surrogate range means there is no pair;
// `String.prototype.normalize` throws on lone surrogates, so this runs first.
function wellFormed(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return character.length === 1 && code >= 0xd800 && code <= 0xdfff ? '\uFFFD' : character;
  }).join('');
}

// A name's orb seed: NFC, trimmed, inner whitespace collapsed and lowercased, so `'  Ana  María '` and `'ana maría'` draw the same ball.
export function nameSeed(name: string): string {
  return wellFormed(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface AvatarPersonInput {
  name: string;
  id?: string | undefined;
  userId?: string | undefined;
  avatarUrl?: string | undefined;
  image?: string | null | undefined;
}

export interface AvatarChatInput {
  id: string;
  title: string;
  avatarUrl?: string | undefined;
}

export type AvatarIdentityInput = AvatarPersonInput | AvatarChatInput;

export interface AvatarIdentity {
  name: string;
  seed: string;
  avatarUrl?: string | undefined;
}

function isChat(input: AvatarIdentityInput): input is AvatarChatInput {
  return 'title' in input;
}

// The orb's colour and light come from the normalized display name, so the same name draws the same ball on every screen; the id is only the fallback.
export function avatarIdentity(input: AvatarIdentityInput): AvatarIdentity {
  const raw = isChat(input) ? input.title : input.name;
  const id = (isChat(input) ? input.id : (input.userId ?? input.id)) ?? '';
  const name = raw.trim() === '' ? id : raw.trim();
  const avatarUrl = isChat(input) ? input.avatarUrl : (input.avatarUrl ?? input.image ?? undefined);
  return {
    name,
    seed: nameSeed(raw) || id,
    ...(avatarUrl === undefined || avatarUrl === '' ? {} : { avatarUrl }),
  };
}
