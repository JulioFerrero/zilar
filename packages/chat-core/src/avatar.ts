export interface AvatarGradient {
  index: number;
  from: string;
  to: string;
}

/** The seven Telegram-like avatar gradients from `docs/design/ui-style.md` §2. */
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

function firstCharacter(value: string): string {
  const [character] = Array.from(value);
  return character ?? '';
}

/**
 * Up to two initials from a name: the first letters of the first two words.
 * Emoji are kept as a single grapheme, and empty names return an empty string.
 */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return '';
  }
  const first = firstCharacter(words[0]!);
  const second = words[1] === undefined ? '' : firstCharacter(words[1]);
  return (first + second).toUpperCase();
}
